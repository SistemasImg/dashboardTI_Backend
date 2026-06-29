const { Op } = require("sequelize");
const {
  getUsBusinessDaysWindowStartDate,
} = require("../../utils/usBusinessDays");
const {
  Vendor,
  VendorCountry,
  VendorProfile,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTortAssignment,
  Product,
} = require("../../models");

const RANGE_DAYS_MAP = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

const GOAL_OVERVIEW_WEEKS = 4;

const ALLOWED_CATEGORIES = new Set([
  "top_vendors",
  "new_vendor",
  "under_review",
  "critical_vendor",
]);

const ALLOWED_SORT_DIR = new Set(["asc", "desc"]);

const VENDORS_SORTERS = {
  inflow: (a, b) => b.inflow - a.inflow,
  accepted: (a, b) => b.accepted - a.accepted,
  rejectedOrUnsigned: (a, b) => b.rejectedOrUnsigned - a.rejectedOrUnsigned,
  conversionRate: (a, b) => b.conversionRate - a.conversionRate,
  goalRate: (a, b) => b.goalStats.rate - a.goalStats.rate,
  category: (a, b) => String(a.category).localeCompare(String(b.category)),
  supplier: (a, b) => String(a.supplier).localeCompare(String(b.supplier)),
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.floor(parsed);
}

function toDateOnlyIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().split("T")[0];
}

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function isDateInRange(value, fromDate, toDate) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= fromDate && date <= toDate;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveCurrentCategory(profile) {
  if (profile.category_source === "manual" && profile.manual_category) {
    return profile.manual_category;
  }
  return profile.computed_category;
}

function isAcceptedCaseSnapshot(row) {
  return normalizeText(row?.sub_status) === "accepted";
}

function getProfileVendorInfo(profile) {
  return profile?.vendorInfo || null;
}

function getProfileDisplayInfo(profile) {
  const vendorInfo = getProfileVendorInfo(profile);
  const metrics = profile?.metrics_json || {};
  const salesforceInfo = metrics.salesforce || {};
  const vendorFreshness = metrics.vendorFreshness || {};

  return {
    supplier: vendorInfo?.contact_name || profile?.supplier || null,
    account: vendorInfo?.name || profile?.account || null,
    supplierSegment:
      vendorInfo?.supplier_segment || profile?.supplier_segment || null,
    active: vendorInfo
      ? vendorInfo.status === "active"
      : Boolean(profile?.active),
    country: vendorInfo?.countryInfo?.name || profile?.country || null,
    isNewVendor: Boolean(vendorFreshness.isNewVendor),
    newVendorWindowDays: Number(vendorFreshness.windowDays || 30),
    contactCreatedAt: salesforceInfo.contactCreatedAt || null,
    accountCreatedAt: salesforceInfo.accountCreatedAt || null,
    accountLastModifiedAt: salesforceInfo.accountLastModifiedAt || null,
  };
}

function parseFilters(raw = {}) {
  const hasFrom =
    raw.from !== undefined && raw.from !== null && raw.from !== "";
  const hasTo = raw.to !== undefined && raw.to !== null && raw.to !== "";
  const hasStartDate =
    raw.startDate !== undefined &&
    raw.startDate !== null &&
    raw.startDate !== "";
  const hasEndDate =
    raw.endDate !== undefined && raw.endDate !== null && raw.endDate !== "";
  const hasRange =
    raw.range !== undefined &&
    raw.range !== null &&
    String(raw.range).trim() !== "";
  const daysInput =
    raw.days !== undefined && raw.days !== null ? raw.days : raw.lastDays;

  let range = "90d";

  let fromDate;
  let toDate;

  // Date precedence:
  // 1) from + to
  // 2) startDate + endDate
  // 3) range
  // 4) days / lastDays
  // 5) default 90d
  if (hasFrom || hasTo) {
    if (!(hasFrom && hasTo)) {
      const error = new Error("from and to must be provided together");
      error.status = 400;
      throw error;
    }

    fromDate = startOfUtcDay(raw.from);
    toDate = endOfUtcDay(raw.to);
    range = "custom";

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      const error = new Error("Invalid from/to dates");
      error.status = 400;
      throw error;
    }
  } else if (hasStartDate || hasEndDate) {
    if (!(hasStartDate && hasEndDate)) {
      const error = new Error(
        "startDate and endDate must be provided together",
      );
      error.status = 400;
      throw error;
    }

    fromDate = startOfUtcDay(raw.startDate);
    toDate = endOfUtcDay(raw.endDate);
    range = "custom";

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      const error = new Error("Invalid startDate/endDate");
      error.status = 400;
      throw error;
    }
  } else if (hasRange) {
    range = String(raw.range).toLowerCase();
    if (range === "30" || range === "60" || range === "90") {
      range = `${range}d`;
    }

    const days = RANGE_DAYS_MAP[range];
    if (!days) {
      const error = new Error("range must be one of 30d, 60d, 90d");
      error.status = 400;
      throw error;
    }

    toDate = endOfUtcDay(new Date());
    fromDate = startOfUtcDay(new Date());
    fromDate.setUTCDate(fromDate.getUTCDate() - days + 1);
  } else if (daysInput !== undefined && daysInput !== null) {
    const days = toPositiveInteger(daysInput);
    if (!days) {
      const error = new Error("days or lastDays must be a positive integer");
      error.status = 400;
      throw error;
    }

    toDate = endOfUtcDay(new Date());
    fromDate = startOfUtcDay(new Date());
    fromDate.setUTCDate(fromDate.getUTCDate() - days + 1);
    range = `${days}d`;
  } else {
    toDate = endOfUtcDay(new Date());
    fromDate = startOfUtcDay(getUsBusinessDaysWindowStartDate(90));
  }

  if (fromDate > toDate) {
    const error = new Error("from must be before or equal to to");
    error.status = 400;
    throw error;
  }

  const category = raw.category ? String(raw.category).toLowerCase() : null;
  if (category && !ALLOWED_CATEGORIES.has(category)) {
    const error = new Error(
      "category must be one of top_vendors, new_vendor, under_review, critical_vendor",
    );
    error.status = 400;
    throw error;
  }

  const sortDir = raw.sortDir ? String(raw.sortDir).toLowerCase() : "desc";
  if (!ALLOWED_SORT_DIR.has(sortDir)) {
    const error = new Error("sortDir must be asc or desc");
    error.status = 400;
    throw error;
  }

  const limit = Math.min(Math.max(toNumber(raw.limit, 50), 1), 500);

  return {
    range,
    fromDate,
    toDate,
    category,
    supplierSegment: raw.supplierSegment || null,
    productId: raw.productId ? toNumber(raw.productId, null) : null,
    type: raw.type || null,
    vendorId: raw.vendorId ? toNumber(raw.vendorId, null) : null,
    sortBy: raw.sortBy ? String(raw.sortBy) : null,
    sortDir,
    limit,
  };
}

async function loadProducts() {
  const products = await Product.findAll({ attributes: ["id", "name"] });

  const byId = new Map();
  const byNormalizedName = new Map();

  for (const product of products) {
    byId.set(Number(product.id), product);
    byNormalizedName.set(normalizeText(product.name), product);
  }

  return { byId, byNormalizedName };
}

function resolveTypeFilter(filters, productsIndex) {
  if (filters.productId) {
    const product = productsIndex.byId.get(Number(filters.productId));
    return {
      productIds: product ? [Number(product.id)] : [],
      typeNames: product ? [normalizeText(product.name)] : [],
    };
  }

  if (filters.type) {
    const typeValue = normalizeText(filters.type);
    const product = productsIndex.byNormalizedName.get(typeValue);

    if (product) {
      return {
        productIds: [Number(product.id)],
        typeNames: [normalizeText(product.name)],
      };
    }

    return {
      productIds: [],
      typeNames: [typeValue],
    };
  }

  return {
    productIds: [],
    typeNames: [],
  };
}

async function loadFilteredProfiles(filters, typeFilter) {
  const where = {};
  const vendorWhere = {
    status: "active",
  };

  if (filters.vendorId) {
    where.id = filters.vendorId;
  }

  if (filters.supplierSegment) {
    vendorWhere.supplier_segment = filters.supplierSegment;
  }

  if (filters.category) {
    where[Op.or] = [
      {
        category_source: "manual",
        manual_category: filters.category,
      },
      {
        category_source: "auto",
        computed_category: filters.category,
      },
    ];
  }

  const includeAssignments = {
    model: VendorTortAssignment,
    as: "tortAssignments",
    required: Boolean(typeFilter.productIds.length),
    include: [
      {
        model: Product,
        as: "product",
        attributes: ["id", "name"],
      },
    ],
    where: typeFilter.productIds.length
      ? {
          product_id: {
            [Op.in]: typeFilter.productIds,
          },
        }
      : undefined,
  };

  return VendorProfile.findAll({
    where,
    include: [
      {
        model: Vendor,
        as: "vendorInfo",
        required: true,
        where: vendorWhere,
        attributes: [
          "id",
          "salesforce_id",
          "name",
          "contact_name",
          "email",
          "country_id",
          "status",
          "supplier_segment",
        ],
        include: [
          {
            model: VendorCountry,
            as: "countryInfo",
            attributes: ["id", "name", "status"],
            required: false,
          },
        ],
      },
      includeAssignments,
    ],
    attributes: [
      "id",
      "supplier",
      "account",
      "country",
      "supplier_segment",
      "active",
      "metrics_json",
      "computed_category",
      "category_source",
      "manual_category",
    ],
  });
}

function typeFilterAllowsCase(typeFilter, caseType) {
  if (!typeFilter.typeNames.length) return true;
  return typeFilter.typeNames.includes(normalizeText(caseType));
}

function getSnapshotTypeName(row) {
  return (
    String(row?.caseProduct?.name || row?.product?.name || "Unknown").trim() ||
    "Unknown"
  );
}

function buildVendorMetricsFromSnapshots(snapshots, typeFilter) {
  const byVendorId = new Map();

  snapshots.forEach((row) => {
    const typeName = getSnapshotTypeName(row);
    if (!typeFilterAllowsCase(typeFilter, typeName)) return;

    const vendorId = Number(row.vendor_id);
    if (!byVendorId.has(vendorId)) {
      byVendorId.set(vendorId, {
        inflow: 0,
        accepted: 0,
        outflow: 0,
        byType: {},
      });
    }

    const entry = byVendorId.get(vendorId);
    const countsAsInflow = isDateInRange(
      row.case_created_at,
      typeFilter.fromDate,
      typeFilter.toDate,
    );
    const countsAsAccepted = countsAsInflow && isAcceptedCaseSnapshot(row);
    const countsAsOutflow =
      countsAsAccepted &&
      isDateInRange(row.sent_date_2, typeFilter.fromDate, typeFilter.toDate);

    if (countsAsInflow) entry.inflow += 1;
    if (countsAsAccepted) entry.accepted += 1;
    if (countsAsOutflow) entry.outflow += 1;

    if (!entry.byType[typeName]) {
      entry.byType[typeName] = {
        inflow: 0,
        accepted: 0,
        outflow: 0,
        vendorIds: new Set(),
      };
    }

    if (countsAsInflow) entry.byType[typeName].inflow += 1;
    if (countsAsAccepted) entry.byType[typeName].accepted += 1;
    if (countsAsOutflow) entry.byType[typeName].outflow += 1;
    entry.byType[typeName].vendorIds.add(vendorId);
  });

  return byVendorId;
}

function computeGoalStatsByVendor(goals) {
  const byVendorId = new Map();

  goals.forEach((g) => {
    const vendorId = Number(g.vendor_id);
    if (!byVendorId.has(vendorId)) {
      byVendorId.set(vendorId, {
        totalWeeks: 0,
        metWeeks: 0,
      });
    }

    const stats = byVendorId.get(vendorId);
    stats.totalWeeks += 1;
    if (g.goal_met) stats.metWeeks += 1;
  });

  for (const [vendorId, stats] of byVendorId.entries()) {
    const missedWeeks = stats.totalWeeks - stats.metWeeks;
    byVendorId.set(vendorId, {
      totalWeeks: stats.totalWeeks,
      metWeeks: stats.metWeeks,
      missedWeeks,
      rate:
        stats.totalWeeks > 0
          ? Number((stats.metWeeks / stats.totalWeeks).toFixed(4))
          : null,
    });
  }

  return byVendorId;
}

function computeLatestGoalStatusByVendor(goals) {
  const byVendorAndWeek = new Map();

  goals.forEach((g) => {
    const vendorId = Number(g.vendor_id);
    const weekEnd = toDateOnlyIso(g.week_end);
    const key = `${vendorId}:${weekEnd}`;

    if (!byVendorAndWeek.has(key)) {
      byVendorAndWeek.set(key, {
        vendorId,
        weekStart: toDateOnlyIso(g.week_start),
        weekEnd,
        allMet: true,
      });
    }

    if (!g.goal_met) {
      byVendorAndWeek.get(key).allMet = false;
    }
  });

  const latestByVendor = new Map();

  for (const item of byVendorAndWeek.values()) {
    const current = latestByVendor.get(item.vendorId);
    if (!current || item.weekEnd > current.weekEnd) {
      latestByVendor.set(item.vendorId, item);
    }
  }

  return latestByVendor;
}

function computeDateDiffInDays(fromDate, toDate) {
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
}

function getWeekStartIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const day = date.getUTCDay();
  const daysToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - daysToMonday);
  date.setUTCHours(0, 0, 0, 0);

  return date.toISOString().split("T")[0];
}

function getRecentGoalWeekStartDates(count = GOAL_OVERVIEW_WEEKS) {
  const now = new Date();
  const day = now.getUTCDay();
  const daysToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: count }, (_item, index) => {
    const week = new Date(monday);
    week.setUTCDate(monday.getUTCDate() - index * 7);
    return week.toISOString().split("T")[0];
  });
}

async function loadAnalyticsDataset(rawFilters = {}) {
  const filters = parseFilters(rawFilters);
  const productsIndex = await loadProducts();
  const typeFilter = resolveTypeFilter(filters, productsIndex);

  const profiles = await loadFilteredProfiles(filters, typeFilter);
  const profileById = new Map(profiles.map((item) => [Number(item.id), item]));
  const vendorIds = profiles.map((item) => Number(item.id));

  const snapshots = vendorIds.length
    ? await VendorCaseSnapshot.findAll({
        where: {
          vendor_id: {
            [Op.in]: vendorIds,
          },
          [Op.or]: [
            {
              case_created_at: {
                [Op.between]: [filters.fromDate, filters.toDate],
              },
            },
            {
              sent_date_2: {
                [Op.between]: [filters.fromDate, filters.toDate],
              },
            },
          ],
        },
        attributes: [
          "vendor_id",
          "product_id",
          "case_created_at",
          "sent_date_2",
          "sub_status",
        ],
        include: [
          {
            model: Product,
            as: "caseProduct",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      })
    : [];

  const goals = vendorIds.length
    ? await VendorWeeklyGoal.findAll({
        where: {
          vendor_id: {
            [Op.in]: vendorIds,
          },
          week_start: {
            [Op.in]: getRecentGoalWeekStartDates(),
          },
          ...(typeFilter.productIds.length
            ? {
                product_id: {
                  [Op.in]: typeFilter.productIds,
                },
              }
            : {}),
        },
        attributes: [
          "vendor_id",
          "product_id",
          "week_start",
          "week_end",
          "goal_met",
        ],
      })
    : [];

  return {
    filters,
    typeFilter: {
      ...typeFilter,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
    },
    productsIndex,
    profiles,
    profileById,
    vendorIds,
    snapshots,
    goals,
  };
}

function buildSummaryResponse(dataset) {
  const vendorMetrics = buildVendorMetricsFromSnapshots(
    dataset.snapshots,
    dataset.typeFilter,
  );
  const goalStatsByVendor = computeGoalStatsByVendor(dataset.goals);
  const latestGoalStatusByVendor = computeLatestGoalStatusByVendor(
    dataset.goals,
  );

  let totalInflow = 0;
  let totalAccepted = 0;
  let totalOutflow = 0;
  let conversionRateAccumulator = 0;
  let outflowRateAccumulator = 0;
  let conversionRateContributors = 0;
  let outflowRateContributors = 0;

  const categoryDistributionMap = new Map();

  dataset.profiles.forEach((profile) => {
    const vendorId = Number(profile.id);
    const category = resolveCurrentCategory(profile);
    const metrics = vendorMetrics.get(vendorId) || {
      inflow: 0,
      accepted: 0,
      outflow: 0,
    };

    totalInflow += metrics.inflow;
    totalAccepted += metrics.accepted;
    totalOutflow += metrics.outflow;

    const conversionRate =
      metrics.inflow > 0 ? (metrics.accepted / metrics.inflow) * 100 : null;
    const outflowRate =
      metrics.accepted > 0 ? (metrics.outflow / metrics.accepted) * 100 : null;
    if (conversionRate !== null) {
      conversionRateAccumulator += conversionRate;
      conversionRateContributors += 1;
    }
    if (outflowRate !== null) {
      outflowRateAccumulator += outflowRate;
      outflowRateContributors += 1;
    }

    if (!categoryDistributionMap.has(category)) {
      categoryDistributionMap.set(category, {
        category,
        count: 0,
        goalMetCount: 0,
        goalMissCount: 0,
      });
    }

    const categoryEntry = categoryDistributionMap.get(category);
    categoryEntry.count += 1;

    const latestStatus = latestGoalStatusByVendor.get(vendorId);
    if (latestStatus) {
      if (latestStatus.allMet) categoryEntry.goalMetCount += 1;
      else categoryEntry.goalMissCount += 1;
    }
  });

  let totalGoalWeeks = 0;
  let totalGoalMetWeeks = 0;

  for (const stats of goalStatsByVendor.values()) {
    totalGoalWeeks += stats.totalWeeks;
    totalGoalMetWeeks += stats.metWeeks;
  }

  let vendorsMeetingGoals = 0;
  let vendorsMissingGoals = 0;

  for (const status of latestGoalStatusByVendor.values()) {
    if (status.allMet) vendorsMeetingGoals += 1;
    else vendorsMissingGoals += 1;
  }

  return {
    summary: {
      totalVendors: dataset.profiles.length,
      activeVendors: dataset.profiles.filter((p) => Boolean(p.active)).length,
      totalInflow,
      totalAccepted,
      totalOutflow,
      totalRejectedOrUnsigned: Math.max(totalInflow - totalAccepted, 0),
      avgConversionRate:
        conversionRateContributors > 0
          ? Number(
              (conversionRateAccumulator / conversionRateContributors).toFixed(
                2,
              ),
            )
          : 0,
      avgOutflowToAcceptedRate:
        outflowRateContributors > 0
          ? Number(
              (outflowRateAccumulator / outflowRateContributors).toFixed(2),
            )
          : 0,
      goalComplianceRate:
        totalGoalWeeks > 0
          ? Number((totalGoalMetWeeks / totalGoalWeeks).toFixed(4))
          : 0,
      vendorsMeetingGoals,
      vendorsMissingGoals,
    },
    categoryDistribution: Array.from(categoryDistributionMap.values()),
  };
}

function buildTrendsResponse(dataset) {
  const days = computeDateDiffInDays(
    dataset.filters.fromDate,
    dataset.filters.toDate,
  );
  const granularity = days <= 90 ? "day" : "week";

  const inflowByBucket = new Map();

  dataset.snapshots.forEach((row) => {
    const typeName = getSnapshotTypeName(row);
    if (!typeFilterAllowsCase(dataset.typeFilter, typeName)) return;
    if (
      !isDateInRange(
        row.case_created_at,
        dataset.typeFilter.fromDate,
        dataset.typeFilter.toDate,
      )
    ) {
      return;
    }

    const bucket =
      granularity === "day"
        ? toDateOnlyIso(row.case_created_at)
        : getWeekStartIso(row.case_created_at);

    if (!bucket) return;

    if (!inflowByBucket.has(bucket)) {
      inflowByBucket.set(bucket, { total: 0, accepted: 0, outflow: 0 });
    }

    const entry = inflowByBucket.get(bucket);
    entry.total += 1;
    if (isAcceptedCaseSnapshot(row)) {
      entry.accepted += 1;
      if (
        isDateInRange(
          row.sent_date_2,
          dataset.typeFilter.fromDate,
          dataset.typeFilter.toDate,
        )
      ) {
        entry.outflow += 1;
      }
    }
  });

  const inflowTrend = Array.from(inflowByBucket.entries())
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, item]) => {
      const rejectedOrUnsigned = Math.max(item.total - item.accepted, 0);
      return {
        date,
        total: item.total,
        accepted: item.accepted,
        outflow: item.outflow,
        rejectedOrUnsigned,
        conversionRate:
          item.total > 0
            ? Number(((item.accepted / item.total) * 100).toFixed(2))
            : 0,
        outflowToAcceptedRate:
          item.accepted > 0
            ? Number(((item.outflow / item.accepted) * 100).toFixed(2))
            : 0,
      };
    });

  const goalByWeek = new Map();

  dataset.goals.forEach((goal) => {
    const weekStart = toDateOnlyIso(goal.week_start);
    const weekEnd = toDateOnlyIso(goal.week_end);
    const key = `${weekStart}:${weekEnd}`;

    if (!goalByWeek.has(key)) {
      goalByWeek.set(key, {
        periodStart: weekStart,
        periodEnd: weekEnd,
        vendorMetState: new Map(),
      });
    }

    const entry = goalByWeek.get(key);
    const vendorId = Number(goal.vendor_id);
    const prev = entry.vendorMetState.get(vendorId);

    if (prev === undefined) {
      entry.vendorMetState.set(vendorId, Boolean(goal.goal_met));
    } else {
      entry.vendorMetState.set(vendorId, prev && Boolean(goal.goal_met));
    }
  });

  const goalTrend = Array.from(goalByWeek.values())
    .sort((a, b) => (a.periodStart > b.periodStart ? 1 : -1))
    .map((row) => {
      let metVendors = 0;
      let missedVendors = 0;

      for (const isMet of row.vendorMetState.values()) {
        if (isMet) metVendors += 1;
        else missedVendors += 1;
      }

      const total = metVendors + missedVendors;

      return {
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        metVendors,
        missedVendors,
        goalComplianceRate:
          total > 0 ? Number((metVendors / total).toFixed(4)) : 0,
      };
    });

  return {
    range: dataset.filters.range,
    granularity,
    inflowTrend,
    goalTrend,
  };
}

function buildVendorsResponse(dataset) {
  const metricsByVendor = buildVendorMetricsFromSnapshots(
    dataset.snapshots,
    dataset.typeFilter,
  );
  const goalStatsByVendor = computeGoalStatsByVendor(dataset.goals);

  const items = dataset.profiles.map((profile) => {
    const vendorId = Number(profile.id);
    const displayInfo = getProfileDisplayInfo(profile);
    const metrics = metricsByVendor.get(vendorId) || {
      inflow: 0,
      accepted: 0,
      outflow: 0,
    };
    const rejectedOrUnsigned = Math.max(metrics.inflow - metrics.accepted, 0);

    const baseGoalStats = goalStatsByVendor.get(vendorId) || {
      totalWeeks: 0,
      metWeeks: 0,
      missedWeeks: 0,
      rate: null,
    };

    const goalRate = baseGoalStats.rate === null ? 0 : baseGoalStats.rate;

    return {
      vendorId,
      supplier: displayInfo.supplier,
      account: displayInfo.account,
      supplierSegment: displayInfo.supplierSegment,
      isNewVendor: displayInfo.isNewVendor,
      newVendorWindowDays: displayInfo.newVendorWindowDays,
      contactCreatedAt: displayInfo.contactCreatedAt,
      accountCreatedAt: displayInfo.accountCreatedAt,
      accountLastModifiedAt: displayInfo.accountLastModifiedAt,
      category: resolveCurrentCategory(profile),
      inflow: metrics.inflow,
      accepted: metrics.accepted,
      outflow: metrics.outflow,
      rejectedOrUnsigned,
      conversionRate:
        metrics.inflow > 0
          ? Number(((metrics.accepted / metrics.inflow) * 100).toFixed(2))
          : 0,
      outflowToAcceptedRate:
        metrics.accepted > 0
          ? Number(((metrics.outflow / metrics.accepted) * 100).toFixed(2))
          : 0,
      goalStats: baseGoalStats,
      goalRate,
      assignments: {
        total: (profile.tortAssignments || []).length,
        active: (profile.tortAssignments || []).filter(
          (a) => a.status === "active",
        ).length,
      },
    };
  });

  const sorter =
    VENDORS_SORTERS[dataset.filters.sortBy] || VENDORS_SORTERS.inflow;
  items.sort((a, b) => {
    const result = sorter(a, b);
    return dataset.filters.sortDir === "asc" ? -result : result;
  });

  const sliced = items.slice(0, dataset.filters.limit).map((item) => {
    const { goalRate, ...rest } = item;
    return rest;
  });

  return {
    items: sliced,
    pagination: {
      total: items.length,
      limit: dataset.filters.limit,
    },
  };
}

function buildTypesResponse(dataset) {
  const typeMap = new Map();

  dataset.snapshots.forEach((row) => {
    const typeName = getSnapshotTypeName(row);
    if (!typeFilterAllowsCase(dataset.typeFilter, typeName)) return;

    if (!typeMap.has(typeName)) {
      typeMap.set(typeName, {
        type: typeName,
        inflow: 0,
        accepted: 0,
        outflow: 0,
        vendorIds: new Set(),
        totalWeeks: 0,
        metWeeks: 0,
      });
    }

    const entry = typeMap.get(typeName);
    const countsAsInflow = isDateInRange(
      row.case_created_at,
      dataset.typeFilter.fromDate,
      dataset.typeFilter.toDate,
    );
    const countsAsAccepted = countsAsInflow && isAcceptedCaseSnapshot(row);
    const countsAsOutflow =
      countsAsAccepted &&
      isDateInRange(
        row.sent_date_2,
        dataset.typeFilter.fromDate,
        dataset.typeFilter.toDate,
      );

    if (countsAsInflow) entry.inflow += 1;
    if (countsAsAccepted) entry.accepted += 1;
    if (countsAsOutflow) entry.outflow += 1;
    entry.vendorIds.add(Number(row.vendor_id));
  });

  const productNameById = new Map();
  for (const product of dataset.productsIndex.byId.values()) {
    productNameById.set(Number(product.id), normalizeText(product.name));
  }

  const typeByNormalized = new Map();
  for (const [typeName] of typeMap.entries()) {
    typeByNormalized.set(normalizeText(typeName), typeName);
  }

  dataset.goals.forEach((goal) => {
    const normalizedName = productNameById.get(Number(goal.product_id));
    if (!normalizedName) return;

    const typeName = typeByNormalized.get(normalizedName);
    if (!typeName) return;

    const entry = typeMap.get(typeName);
    if (!entry) return;

    entry.totalWeeks += 1;
    if (goal.goal_met) entry.metWeeks += 1;
  });

  const items = Array.from(typeMap.values()).map((item) => {
    const rejectedOrUnsigned = Math.max(item.inflow - item.accepted, 0);
    const conversionRate =
      item.inflow > 0
        ? Number(((item.accepted / item.inflow) * 100).toFixed(2))
        : 0;

    let productId = null;
    for (const [id, product] of dataset.productsIndex.byId.entries()) {
      if (normalizeText(product.name) === normalizeText(item.type)) {
        productId = Number(id);
        break;
      }
    }

    return {
      productId,
      type: item.type,
      inflow: item.inflow,
      accepted: item.accepted,
      outflow: item.outflow,
      rejectedOrUnsigned,
      conversionRate,
      outflowToAcceptedRate:
        item.accepted > 0
          ? Number(((item.outflow / item.accepted) * 100).toFixed(2))
          : 0,
      goalComplianceRate:
        item.totalWeeks > 0
          ? Number((item.metWeeks / item.totalWeeks).toFixed(4))
          : 0,
      vendorsCount: item.vendorIds.size,
    };
  });

  items.sort((a, b) => b.inflow - a.inflow);

  return { items };
}

async function buildCategoryHistoryResponse(dataset) {
  const logRows = dataset.vendorIds.length
    ? await VendorCategoryLog.findAll({
        where: {
          vendor_id: {
            [Op.in]: dataset.vendorIds,
          },
          created_at: {
            [Op.between]: [dataset.filters.fromDate, dataset.filters.toDate],
          },
          ...(dataset.filters.category
            ? {
                to_category: dataset.filters.category,
              }
            : {}),
        },
        order: [["created_at", "DESC"]],
        limit: dataset.filters.limit,
        attributes: [
          "vendor_id",
          "from_category",
          "to_category",
          "triggered_by",
          "reason",
          "created_at",
        ],
      })
    : [];

  const items = logRows.map((row) => {
    const vendor = dataset.profileById.get(Number(row.vendor_id));
    const displayInfo = getProfileDisplayInfo(vendor);
    return {
      date: row.created_at,
      vendorId: Number(row.vendor_id),
      supplier: displayInfo.supplier,
      fromCategory: row.from_category,
      toCategory: row.to_category,
      triggeredBy: row.triggered_by,
      reason: row.reason || null,
    };
  });

  const summaryMap = new Map();
  items.forEach((item) => {
    const day = toDateOnlyIso(item.date);
    const key = `${day}:${item.fromCategory || "none"}:${item.toCategory || "none"}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        date: day,
        fromCategory: item.fromCategory,
        toCategory: item.toCategory,
        count: 0,
      });
    }

    summaryMap.get(key).count += 1;
  });

  const summary = Array.from(summaryMap.values()).sort((a, b) =>
    a.date > b.date ? 1 : -1,
  );

  return {
    items,
    summary,
  };
}

async function getVendorAnalyticsSummary(rawFilters = {}) {
  const dataset = await loadAnalyticsDataset(rawFilters);
  return buildSummaryResponse(dataset);
}

async function getVendorAnalyticsTrends(rawFilters = {}) {
  const dataset = await loadAnalyticsDataset(rawFilters);
  return buildTrendsResponse(dataset);
}

async function getVendorAnalyticsVendors(rawFilters = {}) {
  const dataset = await loadAnalyticsDataset(rawFilters);
  return buildVendorsResponse(dataset);
}

async function getVendorAnalyticsTypes(rawFilters = {}) {
  const dataset = await loadAnalyticsDataset(rawFilters);
  return buildTypesResponse(dataset);
}

async function getVendorAnalyticsCategoryHistory(rawFilters = {}) {
  const dataset = await loadAnalyticsDataset(rawFilters);
  return buildCategoryHistoryResponse(dataset);
}

module.exports = {
  getVendorAnalyticsSummary,
  getVendorAnalyticsTrends,
  getVendorAnalyticsVendors,
  getVendorAnalyticsTypes,
  getVendorAnalyticsCategoryHistory,
};
