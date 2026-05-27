const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("../salesforce/auth.service");
const { runSoqlQuery } = require("../salesforce/client.service");
const {
  buildSupplierAccountsQuery,
} = require("../salesforce/queries/user.query");
const {
  buildVendorCasesAggregateQuery,
  buildVendorCasesByTypeTierAggregateQuery,
  buildVendorSignedCasesAggregateQuery,
  buildVendorCaseNumbersByTypeQuery,
} = require("../salesforce/queries/vendorPerformance.query");
const { evaluateCategoryRules } = require("./vendor.categoryRules.service");
const { mapSupplierAccount } = require("../salesforce/mappers/users.mapper");
const {
  VendorProfile,
  VendorTortAssignment,
  Product,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
} = require("../../models");

const CATEGORY = {
  NEW_REVIEW: "new_review",
  TOP_VENDORS: "top_vendors",
  UNDER_REVIEW: "under_review",
};

const CATEGORY_SOURCE = {
  AUTO: "auto",
  MANUAL: "manual",
};

const PERFORMANCE_WINDOW_DAYS = 90;

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function hasSalesforceInvalidField(error, fieldName) {
  const details = error?.response?.data;
  if (!Array.isArray(details)) return false;

  return details.some(
    (item) =>
      item?.errorCode === "INVALID_FIELD" &&
      String(item?.message || "").includes(fieldName),
  );
}

function isWithinLastDays(value, days) {
  const parsed = safeDate(value);
  if (!parsed) return false;

  const limitDate = new Date();
  limitDate.setUTCDate(limitDate.getUTCDate() - Number(days));
  return parsed >= limitDate;
}

function parseAggregateCount(row) {
  const rawValue = row?.totalCases ?? row?.expr0 ?? row?.["expr0"] ?? 0;
  return Number(rawValue) || 0;
}

function buildOwnerCountMap(rows = []) {
  const byOwner = new Map();

  rows.forEach((row) => {
    const ownerId = row?.OwnerId;
    if (!ownerId) return;

    byOwner.set(ownerId, parseAggregateCount(row));
  });

  return byOwner;
}

function buildVendorMetricsMap(rows = []) {
  const byOwner = new Map();

  rows.forEach((row) => {
    const ownerId = row?.OwnerId;
    const type = String(row?.Type || "Unknown").trim() || "Unknown";
    const count = parseAggregateCount(row);

    if (!ownerId) return;

    if (!byOwner.has(ownerId)) {
      byOwner.set(ownerId, {
        total: 0,
        byType: {},
      });
    }

    const current = byOwner.get(ownerId);
    current.byType[type] = (current.byType[type] || 0) + count;
    current.total += count;
  });

  return byOwner;
}

function buildVendorTypeTierMetricsMap(rows = []) {
  const byOwner = new Map();

  rows.forEach((row) => {
    const ownerId = row?.OwnerId;
    const type = String(row?.Type || "Unknown").trim() || "Unknown";
    const tier = String(row?.Tier__c || "No Tier").trim() || "No Tier";
    const count = parseAggregateCount(row);

    if (!ownerId) return;

    if (!byOwner.has(ownerId)) {
      byOwner.set(ownerId, {});
    }

    const current = byOwner.get(ownerId);
    if (!current[type]) current[type] = {};
    current[type][tier] = (current[type][tier] || 0) + count;
  });

  return byOwner;
}

function resolveAutoCategory({
  vendor,
  existingProfile,
  score,
  isTopVendor,
  isNewReview,
}) {
  if (!vendor.active) return CATEGORY.UNDER_REVIEW;
  if (isNewReview) return CATEGORY.NEW_REVIEW;
  if (isTopVendor && score > 0) return CATEGORY.TOP_VENDORS;

  const manuallyForcedUnderReview =
    existingProfile?.category_source === CATEGORY_SOURCE.MANUAL &&
    existingProfile?.manual_category === CATEGORY.UNDER_REVIEW;

  if (manuallyForcedUnderReview) return CATEGORY.UNDER_REVIEW;

  return CATEGORY.UNDER_REVIEW;
}

async function ensureVendorTortAssignments(
  transaction,
  vendorProfileId,
  ownerMetrics,
  productMap,
) {
  const tortTypes = Object.keys(ownerMetrics?.byType || {}).filter(Boolean);

  for (const tortType of tortTypes) {
    const normalizedTortType = String(tortType || "")
      .trim()
      .toLowerCase();
    const product = productMap.get(normalizedTortType);

    if (!product) {
      logger.warn(
        `VendorService → ensureVendorTortAssignments() skipped type without product match: ${tortType}`,
      );
      continue;
    }

    const existing = await VendorTortAssignment.findOne({
      where: {
        vendor_id: vendorProfileId,
        product_id: product.id,
      },
      transaction,
    });

    if (!existing) {
      await VendorTortAssignment.create(
        {
          vendor_id: vendorProfileId,
          product_id: product.id,
          status: "active",
          notes: "Auto-created from Salesforce case volume sync",
        },
        { transaction },
      );
    }
  }
}

async function syncVendorsFromSalesforce() {
  logger.info("VendorService → syncVendorsFromSalesforce() started");

  const sf = await authenticateSalesforce();
  const supplierRaw = await runSoqlQuery(sf, buildSupplierAccountsQuery());
  const supplierVendors = supplierRaw.map(mapSupplierAccount).filter(Boolean);

  const ownerIds = supplierVendors.map((item) => item.id).filter(Boolean);
  const cases90Query = buildVendorCasesAggregateQuery(
    ownerIds,
    PERFORMANCE_WINDOW_DAYS,
  );
  const casesByTypeTier90Query = buildVendorCasesByTypeTierAggregateQuery(
    ownerIds,
    PERFORMANCE_WINDOW_DAYS,
  );
  const signedCases90Query = buildVendorSignedCasesAggregateQuery(
    ownerIds,
    PERFORMANCE_WINDOW_DAYS,
  );
  const casesForSnapshotQuery = buildVendorCaseNumbersByTypeQuery(
    ownerIds,
    PERFORMANCE_WINDOW_DAYS,
  );

  const [aggregate90Rows, aggregateTypeTier90Rows, signedCases90Rows] =
    await Promise.all([
      cases90Query ? runSoqlQuery(sf, cases90Query) : Promise.resolve([]),
      casesByTypeTier90Query
        ? runSoqlQuery(sf, casesByTypeTier90Query)
        : Promise.resolve([]),
      signedCases90Query
        ? runSoqlQuery(sf, signedCases90Query)
        : Promise.resolve([]),
    ]);

  let snapshotCaseRows = [];
  if (casesForSnapshotQuery) {
    try {
      snapshotCaseRows = await runSoqlQuery(sf, casesForSnapshotQuery);
    } catch (error) {
      if (hasSalesforceInvalidField(error, "Substatus__c")) {
        logger.warn(
          "VendorService → syncVendorsFromSalesforce() fallback: Substatus__c not available, retrying with Sub_Status__c",
        );

        const fallbackLegacyFieldQuery = buildVendorCaseNumbersByTypeQuery(
          ownerIds,
          PERFORMANCE_WINDOW_DAYS,
          { customSubStatusField: "Sub_Status__c" },
        );

        try {
          snapshotCaseRows = fallbackLegacyFieldQuery
            ? await runSoqlQuery(sf, fallbackLegacyFieldQuery)
            : [];
        } catch (legacyError) {
          if (hasSalesforceInvalidField(legacyError, "Sub_Status__c")) {
            logger.warn(
              "VendorService → syncVendorsFromSalesforce() fallback: custom sub status fields not available, retrying without custom sub status field",
            );

            const fallbackQuery = buildVendorCaseNumbersByTypeQuery(
              ownerIds,
              PERFORMANCE_WINDOW_DAYS,
              { includeCustomSubStatus: false },
            );

            snapshotCaseRows = fallbackQuery
              ? await runSoqlQuery(sf, fallbackQuery)
              : [];
          } else {
            throw legacyError;
          }
        }
      } else if (hasSalesforceInvalidField(error, "Sub_Status__c")) {
        logger.warn(
          "VendorService → syncVendorsFromSalesforce() fallback: Sub_Status__c not available, retrying without custom sub status field",
        );

        const fallbackQuery = buildVendorCaseNumbersByTypeQuery(
          ownerIds,
          PERFORMANCE_WINDOW_DAYS,
          { includeCustomSubStatus: false },
        );

        snapshotCaseRows = fallbackQuery
          ? await runSoqlQuery(sf, fallbackQuery)
          : [];
      } else {
        throw error;
      }
    }
  }

  const metrics90 = buildVendorMetricsMap(aggregate90Rows);
  const metricsByTypeTier90 = buildVendorTypeTierMetricsMap(
    aggregateTypeTier90Rows,
  );
  const signedCases90 = buildOwnerCountMap(signedCases90Rows);
  const products = await Product.findAll({
    where: { status: 1 },
    attributes: ["id", "name"],
  });
  const productMap = new Map(
    products.map((item) => [
      String(item.name || "")
        .trim()
        .toLowerCase(),
      item,
    ]),
  );

  const existingProfiles = await VendorProfile.findAll({
    where: {
      salesforce_user_id: {
        [Op.in]: ownerIds,
      },
    },
  });
  const existingMap = new Map(
    existingProfiles.map((item) => [item.salesforce_user_id, item]),
  );

  const scored = supplierVendors.map((vendor) => {
    const m90 = metrics90.get(vendor.id) || { total: 0, byType: {} };
    const mTypeTier90 = metricsByTypeTier90.get(vendor.id) || {};
    const signed90 = signedCases90.get(vendor.id) || 0;
    const acceptanceRatePercent =
      m90.total > 0 ? Number(((signed90 / m90.total) * 100).toFixed(2)) : 0;
    const performanceScore = acceptanceRatePercent;

    return {
      vendor,
      metrics90: m90,
      metricsTypeTier90: mTypeTier90,
      signed90,
      acceptanceRatePercent,
      performanceScore,
      existingProfile: existingMap.get(vendor.id) || null,
    };
  });

  const topCandidates = scored
    .filter((item) => item.vendor.active)
    .sort((a, b) => {
      if (b.performanceScore !== a.performanceScore) {
        return b.performanceScore - a.performanceScore;
      }
      if (b.signed90 !== a.signed90) {
        return b.signed90 - a.signed90;
      }
      return b.metrics90.total - a.metrics90.total;
    })
    .slice(0, 20);

  const topOwnerIdSet = new Set(topCandidates.map((item) => item.vendor.id));

  const now = new Date();
  const profileIdBySalesforceUserId = new Map();

  await sequelize.transaction(async (transaction) => {
    for (const item of scored) {
      const {
        vendor,
        metrics90: m90,
        metricsTypeTier90: mTypeTier90,
        signed90,
        acceptanceRatePercent,
        performanceScore,
      } = item;

      const isNewReview =
        isWithinLastDays(vendor.approvalAfter, 14) ||
        isWithinLastDays(item.existingProfile?.first_seen_at, 14);

      const autoCategory = resolveAutoCategory({
        vendor,
        existingProfile: item.existingProfile,
        score: performanceScore,
        isTopVendor: topOwnerIdSet.has(vendor.id),
        isNewReview,
      });

      const finalCategory =
        item.existingProfile?.category_source === CATEGORY_SOURCE.MANUAL &&
        item.existingProfile?.manual_category
          ? item.existingProfile.manual_category
          : autoCategory;

      const payload = {
        salesforce_user_id: vendor.id,
        username: vendor.username,
        account: vendor.account,
        supplier: vendor.supplier,
        country: vendor.country,
        supplier_segment: vendor.supplierSegment,
        active: vendor.active,
        approval_after: safeDate(vendor.approvalAfter),
        first_seen_at: item.existingProfile?.first_seen_at || now,
        last_synced_at: now,
        computed_category: autoCategory,
        category_source:
          item.existingProfile?.category_source || CATEGORY_SOURCE.AUTO,
        manual_category: item.existingProfile?.manual_category || null,
        performance_score: performanceScore,
        metrics_json: {
          totals: {
            last90Days: m90.total,
            signedAcceptedLast90Days: signed90,
            acceptanceRatePercent,
            avgPerDay90Days: Number(
              (m90.total / PERFORMANCE_WINDOW_DAYS).toFixed(2),
            ),
          },
          byType: {
            last90Days: m90.byType,
          },
          byTypeTier: {
            last90Days: mTypeTier90,
          },
          quality: {
            supplierSegment: vendor.supplierSegment || null,
          },
          category: {
            auto: autoCategory,
            final: finalCategory,
            isTop20Candidate: topOwnerIdSet.has(vendor.id),
            isNewReview,
          },
        },
      };

      if (item.existingProfile) {
        await item.existingProfile.update(payload, { transaction });
        profileIdBySalesforceUserId.set(vendor.id, item.existingProfile.id);
        await ensureVendorTortAssignments(
          transaction,
          item.existingProfile.id,
          m90,
          productMap,
        );
      } else {
        const created = await VendorProfile.create(payload, { transaction });
        profileIdBySalesforceUserId.set(vendor.id, created.id);
        await ensureVendorTortAssignments(
          transaction,
          created.id,
          m90,
          productMap,
        );
      }
    }

    const vendorIds = [...profileIdBySalesforceUserId.values()].filter(Boolean);
    if (vendorIds.length) {
      await VendorCaseSnapshot.destroy({
        where: {
          vendor_id: {
            [Op.in]: vendorIds,
          },
        },
        transaction,
      });

      const snapshotsPayload = snapshotCaseRows
        .map((row) => {
          const vendorId = profileIdBySalesforceUserId.get(row?.OwnerId);
          const caseId = String(row?.Id || "").trim();
          const caseNumber = String(row?.CaseNumber || "").trim();

          if (!vendorId || !caseId || !caseNumber) return null;

          return {
            vendor_id: vendorId,
            salesforce_case_id: caseId,
            case_number: caseNumber,
            case_type: String(row?.Type || "Unknown").trim() || "Unknown",
            case_created_at: safeDate(row?.CreatedDate),
            signed_date: row?.Signed_Date__c
              ? safeDate(row.Signed_Date__c)
              : null,
            sub_status:
              String(
                row?.Substatus__c || row?.Sub_Status__c || row?.Status || "",
              ).trim() || null,
          };
        })
        .filter(Boolean);

      if (snapshotsPayload.length) {
        await VendorCaseSnapshot.bulkCreate(snapshotsPayload, {
          transaction,
        });
      }
    }
  });

  logger.success(
    `VendorService → syncVendorsFromSalesforce() success | synced: ${supplierVendors.length}`,
  );

  return {
    synced: supplierVendors.length,
    topVendorCandidates: topOwnerIdSet.size,
  };
}

async function syncVendorsAndEvaluateRules(options = {}) {
  const { failOnRulesError = false } = options;
  const syncResult = await syncVendorsFromSalesforce();

  try {
    const rulesResult = await evaluateCategoryRules();

    return {
      ...syncResult,
      rules: rulesResult,
    };
  } catch (error) {
    logger.error(
      `VendorService → syncVendorsAndEvaluateRules() rules evaluation failed: ${error.message}`,
      {
        stack: error.stack,
      },
    );

    if (failOnRulesError) {
      throw error;
    }

    return {
      ...syncResult,
      rules: null,
      warnings: [
        "Vendor sync completed, but category rules evaluation failed.",
      ],
    };
  }
}

function toPublicVendor(row) {
  const manualCategory = row.manual_category || null;
  const category =
    row.category_source === CATEGORY_SOURCE.MANUAL && manualCategory
      ? manualCategory
      : row.computed_category;

  return {
    id: row.id,
    salesforceUserId: row.salesforce_user_id,
    username: row.username,
    account: row.account,
    supplier: row.supplier,
    country: row.country,
    supplierSegment: row.supplier_segment,
    active: Boolean(row.active),
    approvalAfter: row.approval_after,
    firstSeenAt: row.first_seen_at,
    lastSyncedAt: row.last_synced_at,
    performanceScore: Number(row.performance_score || 0),
    category,
    computedCategory: row.computed_category,
    manualCategory,
    categorySource: row.category_source,
    metrics: row.metrics_json || null,
    alertFlags: row.alert_flags || null,
    consecutiveMissedWeeks: Number(row.consecutive_missed_weeks || 0),
    tortAssignments: (row.tortAssignments || []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product?.name || null,
      status: item.status,
      notes: item.notes,
      assignedBy: item.assigned_by,
      updatedAt: item.updated_at,
    })),
  };
}

function toNumberSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBooleanFlag(value) {
  return Boolean(value);
}

function normalizeTierKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "No Tier";

  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }

  return raw;
}

function normalizeTextKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toPublicAlertFlags(flags = {}) {
  return {
    fraudRisk: toBooleanFlag(flags.fraud_risk),
    fraudRatePercent: toNumberSafe(flags.fraud_rate_pct),
    accepted28Days: toNumberSafe(flags.accepted_28_days),
    acceptedDays28: toNumberSafe(flags.accepted_days_28),
    conversionRatePercent: toNumberSafe(flags.conversion_rate_pct),
    acceptedAvgPerDay: toNumberSafe(flags.accepted_avg_per_day),
    topUnderperformWeeks: toNumberSafe(flags.top_underperform_weeks),
    trendingToNewReview: toBooleanFlag(flags.trending_to_new_review),
    trendingToUnderReview: toBooleanFlag(flags.trending_to_under_review),
    consecutiveMissedWeeks: toNumberSafe(flags.consecutive_missed_weeks),
    lastTopCheckWeek: flags.last_top_check_week || null,
  };
}

function buildNormalizedTypeTierMap(source = {}) {
  const normalized = {};

  Object.entries(source || {}).forEach(([typeName, tiers]) => {
    const mergedTiers = {};

    Object.entries(tiers || {}).forEach(([tierName, count]) => {
      const normalizedTier = normalizeTierKey(tierName);
      mergedTiers[normalizedTier] =
        (mergedTiers[normalizedTier] || 0) + toNumberSafe(count);
    });

    normalized[normalizeTextKey(typeName)] = mergedTiers;
  });

  return normalized;
}

function buildPublicTypeTierMap(source = {}) {
  const output = {};

  Object.entries(source || {}).forEach(([typeName, tiers]) => {
    if (!output[typeName]) output[typeName] = {};

    Object.entries(tiers || {}).forEach(([tierName, count]) => {
      const normalizedTier = normalizeTierKey(tierName);
      output[typeName][normalizedTier] =
        (output[typeName][normalizedTier] || 0) + toNumberSafe(count);
    });
  });

  return output;
}

function toVendorBase(vendor) {
  return {
    id: vendor.id,
    salesforceUserId: vendor.salesforceUserId,
    username: vendor.username,
    account: vendor.account,
    supplier: vendor.supplier,
    country: vendor.country,
    supplierSegment: vendor.supplierSegment,
    active: vendor.active,
    approvalAfter: vendor.approvalAfter,
    firstSeenAt: vendor.firstSeenAt,
    lastSyncedAt: vendor.lastSyncedAt,
  };
}

function buildPerformancePayload(vendor) {
  const totals = vendor.metrics?.totals || {};
  const inflow90 = toNumberSafe(totals.last90Days);
  const accepted90 = toNumberSafe(totals.signedAcceptedLast90Days);

  return {
    score: toNumberSafe(vendor.performanceScore),
    kpis: {
      inflowLast90Days: inflow90,
      acceptedLast90Days: accepted90,
      rejectedOrUnsignedLast90Days: Math.max(inflow90 - accepted90, 0),
      conversionRateLast90DaysPercent: toNumberSafe(
        totals.acceptanceRatePercent,
      ),
      avgInflowPerDayLast90Days: toNumberSafe(totals.avgPerDay90Days),
    },
  };
}

function buildCategoryPayload(vendor) {
  const categoryInfo = vendor.metrics?.category || {};

  return {
    current: vendor.category,
    source: vendor.categorySource,
    computed: vendor.computedCategory,
    manual: vendor.manualCategory,
    isNewReview: toBooleanFlag(categoryInfo.isNewReview),
    isTop20Candidate: toBooleanFlag(categoryInfo.isTop20Candidate),
    consecutiveMissedWeeks: toNumberSafe(vendor.consecutiveMissedWeeks),
    alerts: toPublicAlertFlags(vendor.alertFlags || {}),
  };
}

function buildAssignmentsPayload(vendor) {
  const items = (vendor.tortAssignments || []).map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    status: item.status,
    notes: item.notes,
    assignedBy: item.assignedBy,
    updatedAt: item.updatedAt,
  }));

  return {
    summary: {
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      inactive: items.filter((item) => item.status === "inactive").length,
      paused: items.filter((item) => item.status === "paused").length,
    },
    items,
  };
}

function buildGoalStatsMap(rows = []) {
  const byVendorId = new Map();

  rows.forEach((row) => {
    const vendorId = Number(row.vendor_id);
    const totalWeeks = toNumberSafe(row.dataValues?.totalWeeks);
    const metWeeks = toNumberSafe(row.dataValues?.metWeeks);

    byVendorId.set(vendorId, {
      totalWeeks,
      metWeeks,
      rate: totalWeeks > 0 ? Number((metWeeks / totalWeeks).toFixed(4)) : null,
    });
  });

  return byVendorId;
}

function buildInflowPayload(vendor, caseEntriesByTypeLast90Days = {}) {
  const byType90 = vendor.metrics?.byType?.last90Days || {};
  const byTypeTier90 = buildPublicTypeTierMap(
    vendor.metrics?.byTypeTier?.last90Days || {},
  );
  const topType90 =
    Object.entries(byType90).sort((a, b) => b[1] - a[1])[0] || null;

  const payload = {
    last90Days: {
      byType: byType90,
      byTypeTier: byTypeTier90,
      topType: topType90
        ? { type: topType90[0], inflow: toNumberSafe(topType90[1]) }
        : null,
    },
  };

  if (Object.keys(caseEntriesByTypeLast90Days).length > 0) {
    payload.last90Days.cases = {
      caseEntriesByType: caseEntriesByTypeLast90Days,
    };
  }

  return payload;
}

function buildCaseEntriesByTypeMap(rows = []) {
  const byType = {};

  rows.forEach((row) => {
    const type =
      String(row?.Type || row?.case_type || "Unknown").trim() || "Unknown";
    const caseNumber = String(row?.CaseNumber || row?.case_number || "").trim();
    const caseId = String(row?.Id || row?.salesforce_case_id || "").trim();

    if (!caseNumber || !caseId) return;
    if (!byType[type]) byType[type] = [];

    byType[type].push({
      caseNumber,
      caseId,
    });
  });

  return byType;
}

function buildVendorInsights(
  vendor,
  caseEntriesByTypeLast90Days = {},
  extras = {},
) {
  const {
    weeklyGoals = [],
    topReward = null,
    categoryLogs = [],
    goalStats = {
      totalWeeks: 0,
      metWeeks: 0,
      rate: null,
    },
  } = extras;

  const goalsByTortMap = new Map();

  weeklyGoals.forEach((g) => {
    const productId = g.product_id;
    const productName = g.product?.name || null;
    const key = `${productId}:${productName || ""}`;

    if (!goalsByTortMap.has(key)) {
      goalsByTortMap.set(key, {
        productId,
        productName,
        weeks: [],
      });
    }

    goalsByTortMap.get(key).weeks.push({
      id: g.id,
      weekStart: g.week_start,
      weekEnd: g.week_end,
      weeklyTarget: g.weekly_target,
      actualInflow: g.actual_inflow,
      goalMet: Boolean(g.goal_met),
    });
  });

  const goalsByTort = Array.from(goalsByTortMap.values());

  return {
    vendor: toVendorBase(vendor),
    performance: buildPerformancePayload(vendor),
    category: buildCategoryPayload(vendor),
    inflow: buildInflowPayload(vendor, caseEntriesByTypeLast90Days),
    assignments: buildAssignmentsPayload(vendor),
    goalStats,
    goals: {
      byTort: goalsByTort,
    },
    rewards: topReward
      ? {
          bonusAccess: Boolean(topReward.bonus_access),
          net7: Boolean(topReward.net_7),
          replacementFlexibility: Boolean(topReward.replacement_flexibility),
          active: Boolean(topReward.active),
        }
      : null,
    categoryLogs: categoryLogs.map((l) => ({
      id: l.id,
      fromCategory: l.from_category,
      toCategory: l.to_category,
      reason: l.reason,
      triggeredBy: l.triggered_by,
      createdAt: l.created_at,
    })),
  };
}

async function listVendors(filters = {}) {
  const where = {
    active: true,
  };

  if (filters.category) {
    where[Op.or] = [
      {
        category_source: CATEGORY_SOURCE.MANUAL,
        manual_category: filters.category,
      },
      {
        category_source: CATEGORY_SOURCE.AUTO,
        computed_category: filters.category,
      },
    ];
  }

  if (filters.search) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { supplier: { [Op.like]: `%${filters.search}%` } },
          { account: { [Op.like]: `%${filters.search}%` } },
          { username: { [Op.like]: `%${filters.search}%` } },
        ],
      },
    ];
  }

  const include = [
    {
      model: VendorTortAssignment,
      as: "tortAssignments",
      required: Boolean(filters.productId),
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name"],
        },
      ],
      where: filters.productId
        ? {
            product_id: Number(filters.productId),
          }
        : undefined,
    },
  ];

  const rows = await VendorProfile.findAll({
    where,
    include,
    order: [
      ["performance_score", "DESC"],
      ["supplier", "ASC"],
    ],
  });

  const vendorIds = rows.map((row) => Number(row.id)).filter(Boolean);
  const goalStatsRows = vendorIds.length
    ? await VendorWeeklyGoal.findAll({
        where: {
          vendor_id: {
            [Op.in]: vendorIds,
          },
        },
        attributes: [
          "vendor_id",
          [sequelize.fn("COUNT", sequelize.col("id")), "totalWeeks"],
          [
            sequelize.fn(
              "SUM",
              sequelize.literal("CASE WHEN goal_met = 1 THEN 1 ELSE 0 END"),
            ),
            "metWeeks",
          ],
        ],
        group: ["vendor_id"],
        raw: false,
      })
    : [];
  const goalStatsMap = buildGoalStatsMap(goalStatsRows);

  const items = rows.map((row) => {
    const vendor = toPublicVendor(row);
    return {
      vendor: toVendorBase(vendor),
      performance: buildPerformancePayload(vendor),
      category: buildCategoryPayload(vendor),
      inflow: buildInflowPayload(vendor),
      assignments: buildAssignmentsPayload(vendor),
      goalStats: goalStatsMap.get(Number(row.id)) || {
        totalWeeks: 0,
        metWeeks: 0,
        rate: null,
      },
    };
  });
  const activeCount = items.filter((item) => item.vendor.active).length;

  const categoryCount = {
    new_review: 0,
    top_vendors: 0,
    under_review: 0,
  };

  items.forEach((item) => {
    const category = item.category.current;
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });

  return {
    summary: {
      total: items.length,
      active: activeCount,
      categories: categoryCount,
    },
    vendors: items,
  };
}

async function setVendorCategory(vendorId, category) {
  const profile = await VendorProfile.findByPk(vendorId);
  if (!profile) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  await profile.update({
    category_source: CATEGORY_SOURCE.MANUAL,
    manual_category: category,
  });

  return toPublicVendor(profile);
}

async function assignVendorToTort({
  vendorId,
  productId,
  status = "active",
  notes = null,
  assignedBy = null,
}) {
  const profile = await VendorProfile.findByPk(vendorId);
  if (!profile) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const product = await Product.findByPk(productId);
  if (!product) {
    const error = new Error("Product not found");
    error.status = 404;
    throw error;
  }

  const [record] = await VendorTortAssignment.findOrCreate({
    where: {
      vendor_id: vendorId,
      product_id: productId,
    },
    defaults: {
      vendor_id: vendorId,
      product_id: productId,
      status,
      notes,
      assigned_by: assignedBy,
    },
  });

  await record.update({
    status,
    notes,
    assigned_by: assignedBy,
  });

  return {
    id: record.id,
    vendorId: record.vendor_id,
    productId: record.product_id,
    productName: product.name,
    status: record.status,
    notes: record.notes,
    assignedBy: record.assigned_by,
  };
}

async function getVendorInsightsById(vendorId) {
  const row = await VendorProfile.findByPk(vendorId, {
    include: [
      {
        model: VendorTortAssignment,
        as: "tortAssignments",
        include: [
          {
            model: Product,
            as: "product",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        model: VendorCaseSnapshot,
        as: "caseSnapshots",
        attributes: ["salesforce_case_id", "case_number", "case_type"],
      },
      {
        model: VendorWeeklyGoal,
        as: "weeklyGoals",
        separate: true,
        order: [["week_start", "DESC"]],
        limit: 12,
        include: [
          {
            model: Product,
            as: "product",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        model: VendorCategoryLog,
        as: "categoryLogs",
        separate: true,
        order: [["created_at", "DESC"]],
        limit: 10,
        attributes: [
          "id",
          "from_category",
          "to_category",
          "reason",
          "triggered_by",
          "created_at",
        ],
      },
      {
        model: VendorTopReward,
        as: "topReward",
        required: false,
      },
    ],
  });

  if (!row) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const vendor = toPublicVendor(row);
  const caseRows = row.caseSnapshots || [];
  const caseEntriesByTypeLast90Days = buildCaseEntriesByTypeMap(caseRows);
  const goalStatsRows = await VendorWeeklyGoal.findAll({
    where: {
      vendor_id: Number(vendorId),
    },
    attributes: [
      "vendor_id",
      [sequelize.fn("COUNT", sequelize.col("id")), "totalWeeks"],
      [
        sequelize.fn(
          "SUM",
          sequelize.literal("CASE WHEN goal_met = 1 THEN 1 ELSE 0 END"),
        ),
        "metWeeks",
      ],
    ],
    group: ["vendor_id"],
    raw: false,
  });
  const goalStats = buildGoalStatsMap(goalStatsRows).get(Number(vendorId)) || {
    totalWeeks: 0,
    metWeeks: 0,
    rate: null,
  };

  return buildVendorInsights(vendor, caseEntriesByTypeLast90Days, {
    weeklyGoals: row.weeklyGoals || [],
    topReward: row.topReward || null,
    categoryLogs: row.categoryLogs || [],
    goalStats,
  });
}

async function updateVendorTopRewards(
  vendorId,
  { bonusAccess, net7, replacementFlexibility },
) {
  const profile = await VendorProfile.findByPk(vendorId);
  if (!profile) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const finalCategory =
    profile.category_source === CATEGORY_SOURCE.MANUAL &&
    profile.manual_category
      ? profile.manual_category
      : profile.computed_category;

  if (finalCategory !== CATEGORY.TOP_VENDORS) {
    const error = new Error(
      "Rewards can only be assigned to vendors in top_vendors category",
    );
    error.status = 400;
    throw error;
  }

  const [reward] = await VendorTopReward.findOrCreate({
    where: { vendor_id: vendorId },
    defaults: {
      vendor_id: vendorId,
      bonus_access: false,
      net_7: false,
      replacement_flexibility: false,
      active: true,
    },
  });

  await reward.update({
    bonus_access: Boolean(bonusAccess),
    net_7: Boolean(net7),
    replacement_flexibility: Boolean(replacementFlexibility),
    active: true,
  });

  return {
    vendorId,
    bonusAccess: Boolean(reward.bonus_access),
    net7: Boolean(reward.net_7),
    replacementFlexibility: Boolean(reward.replacement_flexibility),
    active: Boolean(reward.active),
  };
}

module.exports = {
  syncVendorsFromSalesforce,
  syncVendorsAndEvaluateRules,
  listVendors,
  getVendorInsightsById,
  setVendorCategory,
  assignVendorToTort,
  updateVendorTopRewards,
};
