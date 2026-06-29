const { Op, DataTypes } = require("sequelize");
const sequelize = require("../../config/db");
const logger = require("../../utils/logger");
const {
  getUsBusinessDaysWindowStartDate,
  toSalesforceDateTimeLiteral,
} = require("../../utils/usBusinessDays");
const { evaluateCategoryRules } = require("./vendor.categoryRules.service");
const {
  buildGoalCompensationSummary,
} = require("./vendor.goalCompensation.service");
const { authenticateSalesforce } = require("../salesforce/auth.service");
const {
  runSoqlQuery,
  runSoqlQueryAll,
  patchSalesforceSObject,
  resetSalesforceUserPassword,
} = require("../salesforce/client.service");
const {
  buildVendorCaseSnapshotsQuery,
  buildVendorOutflowValidationQuery,
} = require("../salesforce/queries/vendorPerformance.query");
const {
  Vendor,
  VendorCountry,
  VendorProfile,
  VendorTortAssignment,
  Product,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
} = require("../../models");

const CATEGORY = {
  NEW_VENDOR: "new_vendor",
  TOP_VENDORS: "top_vendors",
  UNDER_REVIEW: "under_review",
  CRITICAL_VENDOR: "critical_vendor",
};

const CATEGORY_SOURCE = {
  AUTO: "auto",
  MANUAL: "manual",
};

const LEGACY_CATEGORY_ALIASES = {
  new_review: CATEGORY.NEW_VENDOR,
};

const NEW_VENDOR_WINDOW_DAYS = 30;
const SALESFORCE_METADATA_BATCH_SIZE = 100;
const SALESFORCE_CASE_SNAPSHOT_DAYS = 90;
const SALESFORCE_CASE_SNAPSHOT_WINDOW_TYPE = "us_business_days";
const SALESFORCE_VENDOR_DATA_SYNC_ENABLED = true;
const SALESFORCE_SUPPLIER_SEGMENT_SYNC_ENABLED = false;
const GOAL_OVERVIEW_WEEKS = 4;
const GOAL_COMPLETED_EVALUATION_WEEKS = 3;
const ACCEPTED_CASE_SUBSTATUS = "accepted";

const SALESFORCE_SUPPLIER_SEGMENT_BY_CATEGORY = {
  [CATEGORY.TOP_VENDORS]: "Top Vendor",
  [CATEGORY.NEW_VENDOR]: "New Vendor",
  [CATEGORY.UNDER_REVIEW]: "Under Review",
  [CATEGORY.CRITICAL_VENDOR]: "Critical Vendor",
};

const REWARD_KEYS = [
  "additional",
  "preferred_payment_n7",
  "replacement_flexibility",
  "auto_intake",
];

const REWARD_COLUMN_BY_KEY = {
  additional: "bonus_access",
  preferred_payment_n7: "net_7",
  replacement_flexibility: "replacement_flexibility",
  auto_intake: "auto_intake",
};

const OUTFLOW_VALIDATION_BATCH_SIZE = 100;

const LEGACY_REWARD_KEY_BY_FIELD = {
  bonusAccess: "additional",
  net7: "preferred_payment_n7",
  replacementFlexibility: "replacement_flexibility",
};

const VENDOR_CASE_REASON_FIELDS = [
  "Reason_for_Detention__c",
  "Reason_for_Doesn_t_meet_criteria__c",
  "Reason_for_DQ__c",
  "Reason_for_On_Hold__c",
  "Reason_for_Rejection__c",
  "Reason_for_Spam__c",
  "Reason_for_Unreachable__c",
];

const VENDOR_CASE_REASON_LABELS = {
  Reason_for_Detention__c: "Detention",
  Reason_for_Doesn_t_meet_criteria__c: "Doesn't meet criteria",
  Reason_for_DQ__c: "DQ",
  Reason_for_On_Hold__c: "On hold",
  Reason_for_Rejection__c: "Rejection",
  Reason_for_Spam__c: "Spam",
  Reason_for_Unreachable__c: "Unreachable",
};

function escapeSoqlString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function normalizeCategory(value) {
  const category = String(value || "")
    .trim()
    .toLowerCase();
  return LEGACY_CATEGORY_ALIASES[category] || category;
}

async function ensureVendorCategoryEnumValues() {
  const categoryEnumWithLegacy = DataTypes.ENUM(
    CATEGORY.NEW_VENDOR,
    "new_review",
    CATEGORY.TOP_VENDORS,
    CATEGORY.UNDER_REVIEW,
    CATEGORY.CRITICAL_VENDOR,
  );
  const categoryEnum = DataTypes.ENUM(
    CATEGORY.NEW_VENDOR,
    CATEGORY.TOP_VENDORS,
    CATEGORY.UNDER_REVIEW,
    CATEGORY.CRITICAL_VENDOR,
  );
  const queryInterface = sequelize.getQueryInterface();

  await queryInterface.changeColumn("vendor_profiles", "computed_category", {
    type: categoryEnumWithLegacy,
    allowNull: false,
    defaultValue: CATEGORY.UNDER_REVIEW,
  });
  await queryInterface.changeColumn("vendor_profiles", "manual_category", {
    type: categoryEnumWithLegacy,
    allowNull: true,
  });
  await queryInterface.changeColumn("vendor_category_logs", "from_category", {
    type: categoryEnumWithLegacy,
    allowNull: true,
  });
  await queryInterface.changeColumn("vendor_category_logs", "to_category", {
    type: categoryEnumWithLegacy,
    allowNull: false,
  });

  await sequelize.query(
    "UPDATE vendor_profiles SET computed_category = 'new_vendor' WHERE computed_category = 'new_review'",
  );
  await sequelize.query(
    "UPDATE vendor_profiles SET manual_category = 'new_vendor' WHERE manual_category = 'new_review'",
  );
  await sequelize.query(
    "UPDATE vendor_category_logs SET from_category = 'new_vendor' WHERE from_category = 'new_review'",
  );
  await sequelize.query(
    "UPDATE vendor_category_logs SET to_category = 'new_vendor' WHERE to_category = 'new_review'",
  );

  await queryInterface.changeColumn("vendor_profiles", "computed_category", {
    type: categoryEnum,
    allowNull: false,
    defaultValue: CATEGORY.UNDER_REVIEW,
  });
  await queryInterface.changeColumn("vendor_profiles", "manual_category", {
    type: categoryEnum,
    allowNull: true,
  });
  await queryInterface.changeColumn("vendor_category_logs", "from_category", {
    type: categoryEnum,
    allowNull: true,
  });
  await queryInterface.changeColumn("vendor_category_logs", "to_category", {
    type: categoryEnum,
    allowNull: false,
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getEffectiveVendorCategory(profile) {
  const manualCategory = normalizeCategory(profile?.manual_category) || null;
  if (profile?.category_source === CATEGORY_SOURCE.MANUAL && manualCategory) {
    return manualCategory;
  }

  return normalizeCategory(profile?.computed_category);
}

function getSupplierSegmentLabelForCategory(category) {
  return (
    SALESFORCE_SUPPLIER_SEGMENT_BY_CATEGORY[normalizeCategory(category)] || null
  );
}

function toIsoDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isDateWithinLastDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const threshold = new Date();
  threshold.setUTCDate(threshold.getUTCDate() - days);
  return date >= threshold;
}

function buildVendorFreshness(localVendor, salesforceMetadata) {
  const createdRecently = isDateWithinLastDays(
    salesforceMetadata?.contactCreatedAt,
    NEW_VENDOR_WINDOW_DAYS,
  );
  const reactivatedRecently =
    localVendor?.status === "active" &&
    isDateWithinLastDays(localVendor?.reactivated_at, NEW_VENDOR_WINDOW_DAYS);

  let reason = null;
  let effectiveDate = null;

  if (reactivatedRecently) {
    reason = "reactivated";
    effectiveDate = toIsoDateOrNull(localVendor?.reactivated_at);
  } else if (createdRecently) {
    reason = "created";
    effectiveDate = salesforceMetadata?.contactCreatedAt || null;
  }

  return {
    isNewVendor: Boolean(createdRecently || reactivatedRecently),
    reason,
    effectiveDate,
    createdRecently: Boolean(createdRecently),
    reactivatedRecently: Boolean(reactivatedRecently),
    reactivatedAt: toIsoDateOrNull(localVendor?.reactivated_at),
    deactivatedAt: toIsoDateOrNull(localVendor?.deactivated_at),
    lastStatusChangedAt: toIsoDateOrNull(localVendor?.last_status_changed_at),
    windowDays: NEW_VENDOR_WINDOW_DAYS,
  };
}

function buildVendorAccountMetadataQuery(userIds) {
  const idList = userIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ");

  return `
    SELECT
      Id,
      Contact.Approval_After__c,
      Contact.CreatedDate,
      Contact.Account.Id,
      Contact.Account.CreatedDate,
      Contact.Account.LastModifiedDate,
      Contact.Account.LastModifiedById,
      Contact.Account.LastModifiedBy.Name,
      Contact.Parent_Account__r.Id,
      Contact.Parent_Account__r.CreatedDate,
      Contact.Parent_Account__r.LastModifiedDate,
      Contact.Parent_Account__r.LastModifiedById,
      Contact.Parent_Account__r.LastModifiedBy.Name
    FROM User
    WHERE Id IN (${idList})
  `;
}

function buildVendorContactMetadataQuery(contactIds) {
  const idList = contactIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ");

  return `
    SELECT
      Id,
      Approval_After__c,
      CreatedDate,
      Account.Id,
      Account.CreatedDate,
      Account.LastModifiedDate,
      Account.LastModifiedById,
      Account.LastModifiedBy.Name,
      Parent_Account__r.Id,
      Parent_Account__r.CreatedDate,
      Parent_Account__r.LastModifiedDate,
      Parent_Account__r.LastModifiedById,
      Parent_Account__r.LastModifiedBy.Name
    FROM Contact
    WHERE Id IN (${idList})
  `;
}

function buildVendorAssignedCasesQuery(salesforceOwnerId) {
  const windowStart = getCaseSnapshotWindowStart();
  const windowStartLiteral = toSalesforceDateTimeLiteral(windowStart);

  return `
    SELECT
      Id,
      CaseNumber,
      OwnerId,
      Owner.Name,
      Type,
      CreatedDate,
      Status,
      Substatus__c,
      ${VENDOR_CASE_REASON_FIELDS.join(",\n      ")}
    FROM Case
    WHERE OwnerId = '${escapeSoqlString(salesforceOwnerId)}'
    ${windowStartLiteral ? `AND CreatedDate >= ${windowStartLiteral}` : ""}
    ORDER BY CreatedDate DESC
  `;
}

function normalizeVendorCaseStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function incrementCount(map, value) {
  const key = String(value || "Unknown").trim() || "Unknown";
  map[key] = (map[key] || 0) + 1;
}

function getVendorCaseBucket(record) {
  const status = normalizeVendorCaseStatus(record?.Status);
  const substatus = normalizeVendorCaseStatus(record?.Substatus__c);

  if (status === "sent") return "sent";
  if (status === "in progress") return "inProgress";
  if (substatus === "accepted") return "accepted";
  if (substatus === "reject" || substatus === "rejected") return "rejected";

  return "other";
}

function buildVendorCaseStatusSummary(records = []) {
  const tracked = {
    sent: 0,
    inProgress: 0,
    accepted: 0,
    rejected: 0,
    other: 0,
  };
  const byStatus = {};
  const bySubstatus = {};

  for (const record of records) {
    tracked[getVendorCaseBucket(record)] += 1;
    incrementCount(byStatus, record?.Status);
    incrementCount(bySubstatus, record?.Substatus__c);
  }

  return {
    tracked,
    byStatus,
    bySubstatus,
  };
}

function resolveSalesforceAccountMetadata(user) {
  const account = user?.Contact?.Parent_Account__r || user?.Contact?.Account;
  const contactCreatedAt = toIsoDateOrNull(user?.Contact?.CreatedDate);
  const accountCreatedAt = toIsoDateOrNull(account?.CreatedDate);
  const accountLastModifiedAt = toIsoDateOrNull(account?.LastModifiedDate);

  return {
    approvalAfter: toIsoDateOrNull(user?.Contact?.Approval_After__c),
    contactCreatedAt,
    accountId: account?.Id || null,
    accountCreatedAt,
    accountLastModifiedAt,
    accountLastModifiedById: account?.LastModifiedById || null,
    accountLastModifiedByName: account?.LastModifiedBy?.Name || null,
    isNewVendor: isDateWithinLastDays(contactCreatedAt, NEW_VENDOR_WINDOW_DAYS),
  };
}

function resolveSalesforceContactMetadata(contact) {
  return resolveSalesforceAccountMetadata({ Contact: contact });
}

async function fetchSalesforceAccountMetadataMap(salesforceIds) {
  const ids = (salesforceIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const userIds = Array.from(new Set(ids.filter((id) => id.startsWith("005"))));
  const contactIds = Array.from(
    new Set(ids.filter((id) => id.startsWith("003"))),
  );

  const metadataMap = new Map();
  if (!userIds.length && !contactIds.length) {
    return {
      metadataMap,
      queried: 0,
      matched: 0,
      newVendors: 0,
    };
  }

  const sf = await authenticateSalesforce();
  let matched = 0;
  let newVendors = 0;

  for (const batch of chunkArray(userIds, SALESFORCE_METADATA_BATCH_SIZE)) {
    const rows = await runSoqlQuery(sf, buildVendorAccountMetadataQuery(batch));

    for (const row of rows || []) {
      const salesforceId = String(row?.Id || "").trim();
      if (!salesforceId) continue;

      const metadata = resolveSalesforceAccountMetadata(row);
      metadataMap.set(salesforceId, metadata);
      matched += 1;
      if (metadata.isNewVendor) newVendors += 1;
    }
  }

  for (const batch of chunkArray(contactIds, SALESFORCE_METADATA_BATCH_SIZE)) {
    const rows = await runSoqlQuery(sf, buildVendorContactMetadataQuery(batch));

    for (const row of rows || []) {
      const salesforceId = String(row?.Id || "").trim();
      if (!salesforceId) continue;

      const metadata = resolveSalesforceContactMetadata(row);
      metadataMap.set(salesforceId, metadata);
      matched += 1;
      if (metadata.isNewVendor) newVendors += 1;
    }
  }

  return {
    metadataMap,
    queried: userIds.length + contactIds.length,
    matched,
    newVendors,
  };
}

function resolveCaseSubStatus(row) {
  return row?.Substatus__c || row?.Sub_Status__c || row?.Sub_Status || null;
}

function isAcceptedCaseSnapshot(snapshot) {
  const subStatus = String(
    snapshot?.sub_status ||
      snapshot?.Substatus__c ||
      snapshot?.Sub_Status__c ||
      "",
  )
    .trim()
    .toLowerCase();

  return subStatus === ACCEPTED_CASE_SUBSTATUS;
}

function isValidatedOutflowSnapshot(snapshot) {
  return Boolean(
    (snapshot?.sent_date_2 || snapshot?.Sent_Date2__c) &&
    (snapshot?.outflow_validated || snapshot?.outflowValidated),
  );
}

function isOutflowCaseSnapshot(snapshot) {
  return Boolean(snapshot?.sent_date_2 || snapshot?.Sent_Date2__c);
}

function resolveCaseProduct(row, productMap) {
  const typeName = String(row?.Type || "").trim();
  if (!typeName) return null;
  return productMap.get(typeName.toLowerCase()) || null;
}

function buildOutflowValidationKey(caseNumber, typeName) {
  const normalizedCaseNumber = normalizeTextKey(caseNumber);
  const normalizedType = normalizeTextKey(typeName);
  if (!normalizedCaseNumber || !normalizedType) return null;
  return `${normalizedCaseNumber}::${normalizedType}`;
}

async function fetchValidatedOutflowKeySet(sf, caseRows = []) {
  const sentCaseNumbers = Array.from(
    new Set(
      caseRows
        .filter((row) => row?.Sent_Date2__c)
        .map((row) => String(row?.CaseNumber || "").trim())
        .filter(Boolean),
    ),
  );

  if (!sentCaseNumbers.length) return new Set();

  const result = new Set();

  for (const batch of chunkArray(
    sentCaseNumbers,
    OUTFLOW_VALIDATION_BATCH_SIZE,
  )) {
    const query = buildVendorOutflowValidationQuery(batch);
    const rows = query ? await runSoqlQueryAll(sf, query) : [];

    for (const row of rows || []) {
      const key = buildOutflowValidationKey(
        row?.Lead__r?.CaseNumber,
        row?.Lead__r?.Type,
      );
      if (key) result.add(key);
    }
  }

  return result;
}

async function fetchSalesforceCaseSnapshots(salesforceIds) {
  const ownerIds = Array.from(
    new Set(
      (salesforceIds || [])
        .map((id) => String(id || "").trim())
        .filter((id) => id.startsWith("005")),
    ),
  );

  if (!ownerIds.length) return [];

  const sf = await authenticateSalesforce();
  const rows = [];
  const windowStart = getCaseSnapshotWindowStart();
  const windowStartLiteral = toSalesforceDateTimeLiteral(windowStart);

  for (const batch of chunkArray(ownerIds, SALESFORCE_METADATA_BATCH_SIZE)) {
    const query = buildVendorCaseSnapshotsQuery(
      batch,
      SALESFORCE_CASE_SNAPSHOT_DAYS,
      {
        createdDateFrom: windowStartLiteral,
        signedDateFrom: windowStartLiteral,
        sentDateFrom: windowStartLiteral,
      },
    );
    const batchRows = query ? await runSoqlQueryAll(sf, query) : [];
    rows.push(...(batchRows || []));
  }

  const validatedOutflowKeys = await fetchValidatedOutflowKeySet(sf, rows);

  return rows.map((row) => ({
    ...row,
    outflowValidated: Boolean(
      row?.Sent_Date2__c &&
      validatedOutflowKeys.has(
        buildOutflowValidationKey(row?.CaseNumber, row?.Type),
      ),
    ),
  }));
}

async function syncVendorCaseSnapshots(
  transaction,
  salesforceIds,
  profileBySalesforceId,
  productMap,
) {
  const rows = await fetchSalesforceCaseSnapshots(salesforceIds);
  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const salesforceCaseId = String(row?.Id || "").trim();
    const ownerId = String(row?.OwnerId || "").trim();
    const caseNumber = String(row?.CaseNumber || "").trim();
    const profile = profileBySalesforceId.get(ownerId);
    const product = resolveCaseProduct(row, productMap);

    if (!salesforceCaseId || !ownerId || !caseNumber || !profile || !product) {
      skipped += 1;
      continue;
    }

    const payload = {
      vendor_id: profile.id,
      salesforce_case_id: salesforceCaseId,
      case_number: caseNumber,
      product_id: Number(product.id),
      case_created_at: row.CreatedDate || null,
      signed_date: row.Signed_Date__c || null,
      sent_date_2: row.Sent_Date2__c || null,
      outflow_validated: Boolean(row.outflowValidated),
      sub_status: resolveCaseSubStatus(row),
    };

    const existing = await VendorCaseSnapshot.findOne({
      where: { salesforce_case_id: salesforceCaseId },
      transaction,
    });

    if (existing) {
      await existing.update(payload, { transaction });
    } else {
      await VendorCaseSnapshot.create(payload, { transaction });
    }

    upserted += 1;
  }

  return {
    fetched: rows.length,
    upserted,
    skipped,
    days: SALESFORCE_CASE_SNAPSHOT_DAYS,
    windowType: SALESFORCE_CASE_SNAPSHOT_WINDOW_TYPE,
    windowStart: getCaseSnapshotWindowStart().toISOString(),
    outflowValidation: {
      required: true,
      source: "Lead_de_oportunidad__c",
      rule: "CaseNumber and Type must match a Signed Lead__r record",
    },
  };
}

async function ensureVendorTortAssignments(
  transaction,
  vendorProfileId,
  localTorts,
  productMap,
) {
  const incoming = new Map();

  for (const item of localTorts || []) {
    const tortName = String(item?.tort || "").trim();
    const normalizedTortType = tortName.trim().toLowerCase();

    if (!normalizedTortType || incoming.has(normalizedTortType)) continue;

    const product = productMap.get(normalizedTortType);

    if (!product) {
      logger.warn(
        `VendorClassificationService → ensureVendorTortAssignments() skipped tort without product match: ${tortName}`,
      );
      continue;
    }

    const status = String(item?.status || "active")
      .trim()
      .toLowerCase();

    incoming.set(normalizedTortType, {
      product,
      status: ["active", "inactive", "paused"].includes(status)
        ? status
        : "active",
    });
  }

  const existingRows = await VendorTortAssignment.findAll({
    where: { vendor_id: vendorProfileId },
    transaction,
  });

  const keepProductIds = new Set(
    Array.from(incoming.values()).map((item) => Number(item.product.id)),
  );

  for (const existing of existingRows) {
    if (!keepProductIds.has(Number(existing.product_id))) {
      await existing.destroy({ transaction });
    }
  }

  for (const { product, status } of incoming.values()) {
    const productId = Number(product.id);

    const existing = await VendorTortAssignment.findOne({
      where: {
        vendor_id: vendorProfileId,
        product_id: productId,
      },
      transaction,
    });

    if (existing) {
      await existing.update({ status }, { transaction });
      continue;
    }

    await VendorTortAssignment.create(
      {
        vendor_id: vendorProfileId,
        product_id: productId,
        status,
        notes: "Synced from local vendors.tort_tier_statuses",
      },
      { transaction },
    );
  }
}

function normalizeLocalVendorTorts(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function buildVendorMetadataJson(localVendor, salesforceMetadata) {
  const vendorFreshness = buildVendorFreshness(localVendor, salesforceMetadata);

  return {
    source: {
      vendorsTableId: localVendor.id,
      salesforceAccountMetadata: Boolean(salesforceMetadata),
    },
    salesforce: {
      contactCreatedAt: salesforceMetadata?.contactCreatedAt || null,
      accountId: salesforceMetadata?.accountId || null,
      accountCreatedAt: salesforceMetadata?.accountCreatedAt || null,
      accountLastModifiedAt: salesforceMetadata?.accountLastModifiedAt || null,
      accountLastModifiedById:
        salesforceMetadata?.accountLastModifiedById || null,
      accountLastModifiedByName:
        salesforceMetadata?.accountLastModifiedByName || null,
    },
    vendorFreshness: {
      ...vendorFreshness,
    },
  };
}

function resolveInitialComputedCategory(
  localVendor,
  existingProfile,
  salesforceMetadata,
) {
  if (buildVendorFreshness(localVendor, salesforceMetadata).isNewVendor) {
    return CATEGORY.NEW_VENDOR;
  }

  return (
    normalizeCategory(existingProfile?.computed_category) ||
    CATEGORY.UNDER_REVIEW
  );
}

function buildVendorProfilePayload(
  localVendor,
  existingProfile,
  salesforceMetadata,
) {
  const computedCategory = resolveInitialComputedCategory(
    localVendor,
    existingProfile,
    salesforceMetadata,
  );

  return {
    salesforce_user_id: localVendor.salesforce_id,
    approval_after: salesforceMetadata?.approvalAfter || null,
    first_seen_at: existingProfile?.first_seen_at || new Date(),
    last_synced_at: new Date(),
    computed_category: computedCategory,
    category_source: existingProfile?.category_source || CATEGORY_SOURCE.AUTO,
    manual_category:
      normalizeCategory(existingProfile?.manual_category) || null,
    performance_score: Number(existingProfile?.performance_score || 0),
    metrics_json: buildVendorMetadataJson(localVendor, salesforceMetadata),
  };
}

function buildVendorProfileCreatePayload(localVendor, salesforceMetadata) {
  const payload = buildVendorProfilePayload(
    localVendor,
    null,
    salesforceMetadata,
  );

  return {
    ...payload,
    username: localVendor.email || null,
    account: localVendor.name || "Unknown vendor",
    supplier: localVendor.contact_name || localVendor.name || "Unknown vendor",
    country: localVendor.countryInfo?.name || null,
    supplier_segment: localVendor.supplier_segment || null,
    active: localVendor.status === "active",
  };
}

function getProfileVendorInfo(row) {
  return row?.vendorInfo || null;
}

function getVendorCountryName(vendorInfo) {
  return vendorInfo?.countryInfo?.name || null;
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

function getCurrentGoalWeekStartDate() {
  return getRecentGoalWeekStartDates(1)[0] || null;
}

function buildGoalWeekWindowBounds(weekStartDates = []) {
  const sortedWeekStarts = [...weekStartDates].filter(Boolean).sort();
  if (!sortedWeekStarts.length) return null;

  const startStr = sortedWeekStarts[0];
  const endWeekStartStr = sortedWeekStarts[sortedWeekStarts.length - 1];
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endWeekStartStr}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);

  return {
    start,
    end,
    startStr,
    endStr: end.toISOString().split("T")[0],
  };
}

function getGoalOutflowWindowInfo() {
  const recentWeekStarts = getRecentGoalWeekStartDates(GOAL_OVERVIEW_WEEKS);
  const classificationWeekStarts = recentWeekStarts.slice(
    1,
    1 + GOAL_COMPLETED_EVALUATION_WEEKS,
  );

  return {
    visible: buildGoalWeekWindowBounds(recentWeekStarts),
    classification: buildGoalWeekWindowBounds(classificationWeekStarts),
  };
}

function toDateOnlyString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return String(value).split("T")[0];
}

function isGoalWeekComplete(weekEnd) {
  const weekEndStr = toDateOnlyString(weekEnd);
  if (!weekEndStr) return false;
  const end = new Date(`${weekEndStr}T23:59:59.999Z`);
  return new Date() > end;
}

function isDateInsideWindow(value, windowBounds) {
  if (!value || !windowBounds) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return date >= windowBounds.start && date <= windowBounds.end;
}

function getCaseSnapshotWindowStart() {
  return getUsBusinessDaysWindowStartDate(SALESFORCE_CASE_SNAPSHOT_DAYS);
}

function getLast90DaysStart() {
  return getCaseSnapshotWindowStart();
}

async function ensureVendorClassificationTables() {
  await VendorProfile.sync();
  await VendorTortAssignment.sync();
  await VendorCaseSnapshot.sync();
  await VendorWeeklyGoal.sync();
  await VendorTopReward.sync();
  await VendorCategoryLog.sync();
  await ensureVendorCategoryEnumValues();

  const queryInterface = sequelize.getQueryInterface();
  const weeklyGoalsDefinition = await queryInterface.describeTable(
    "vendor_weekly_goals",
  );
  const caseSnapshotsDefinition = await queryInterface.describeTable(
    "vendor_case_snapshots",
  );

  if (!weeklyGoalsDefinition.actual_outflow) {
    await queryInterface.addColumn("vendor_weekly_goals", "actual_outflow", {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
  }

  if (!caseSnapshotsDefinition.sent_date_2) {
    await queryInterface.addColumn("vendor_case_snapshots", "sent_date_2", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  if (!caseSnapshotsDefinition.outflow_validated) {
    await queryInterface.addColumn(
      "vendor_case_snapshots",
      "outflow_validated",
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    );
  }

  const topRewardsDefinition =
    await queryInterface.describeTable("vendor_top_rewards");

  if (!topRewardsDefinition.auto_intake) {
    await queryInterface.addColumn("vendor_top_rewards", "auto_intake", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }
}

async function syncVendorsFromMysql(options = {}) {
  const { syncSalesforceData = SALESFORCE_VENDOR_DATA_SYNC_ENABLED } = options;

  logger.info("VendorClassificationService → syncVendorsFromMysql() started");

  await ensureVendorClassificationTables();

  const localVendors = await Vendor.findAll({
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
    order: [
      ["name", "ASC"],
      ["id", "ASC"],
    ],
  });

  const localSalesforceIds = localVendors
    .map((vendor) => String(vendor.salesforce_id || "").trim())
    .filter(Boolean);

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

  const existingProfiles = localSalesforceIds.length
    ? await VendorProfile.findAll({
        where: {
          salesforce_user_id: {
            [Op.in]: localSalesforceIds,
          },
        },
      })
    : [];
  const existingMap = new Map(
    existingProfiles.map((item) => [item.salesforce_user_id, item]),
  );
  const localIdSet = new Set(localSalesforceIds);
  const salesforceMetadataResult = syncSalesforceData
    ? await fetchSalesforceAccountMetadataMap(localSalesforceIds)
    : {
        queried: 0,
        matched: 0,
        newVendors: 0,
        metadataMap: new Map(),
        salesforceSyncEnabled: false,
      };
  const salesforceMetadataMap = salesforceMetadataResult.metadataMap;
  let synced = 0;
  let deactivated = 0;
  let caseSnapshots = {
    fetched: 0,
    upserted: 0,
    skipped: 0,
    days: SALESFORCE_CASE_SNAPSHOT_DAYS,
  };

  await sequelize.transaction(async (transaction) => {
    const profileBySalesforceId = new Map();

    for (const localVendor of localVendors) {
      const salesforceId = String(localVendor.salesforce_id || "").trim();
      if (!salesforceId) continue;

      const existingProfile = existingMap.get(salesforceId) || null;
      const localTorts = normalizeLocalVendorTorts(
        localVendor.tort_tier_statuses,
      );
      const salesforceMetadata =
        salesforceMetadataMap.get(salesforceId) || null;
      const payload = buildVendorProfilePayload(
        localVendor,
        existingProfile,
        salesforceMetadata,
      );

      let profile;
      if (existingProfile) {
        profile = await existingProfile.update(payload, { transaction });
      } else {
        profile = await VendorProfile.create(
          buildVendorProfileCreatePayload(localVendor, salesforceMetadata),
          { transaction },
        );
      }

      await ensureVendorTortAssignments(
        transaction,
        profile.id,
        localTorts,
        productMap,
      );

      profileBySalesforceId.set(salesforceId, profile);

      synced += 1;
    }

    if (syncSalesforceData) {
      caseSnapshots = await syncVendorCaseSnapshots(
        transaction,
        localSalesforceIds,
        profileBySalesforceId,
        productMap,
      );
    } else {
      caseSnapshots = {
        ...caseSnapshots,
        skipped: localSalesforceIds.length,
        salesforceSyncEnabled: false,
      };
    }

    const staleProfiles = await VendorProfile.findAll({ transaction });
    for (const profile of staleProfiles) {
      const salesforceId = String(profile.salesforce_user_id || "").trim();
      if (!salesforceId || localIdSet.has(salesforceId) || !profile.active) {
        continue;
      }

      await profile.update(
        {
          active: false,
          last_synced_at: new Date(),
        },
        {
          transaction,
        },
      );
      deactivated += 1;
    }
  });

  logger.success(
    `VendorClassificationService → syncVendorsFromMysql() success | synced: ${synced} | deactivated: ${deactivated}`,
  );

  return {
    synced,
    deactivated,
    source: "mysql.vendors",
    salesforceMetadata: {
      queried: salesforceMetadataResult.queried,
      matched: salesforceMetadataResult.matched,
      newVendors: salesforceMetadataResult.newVendors,
      windowDays: NEW_VENDOR_WINDOW_DAYS,
    },
    caseSnapshots,
    topVendorCandidates: 0,
  };
}

async function syncVendorsAndEvaluateRules(options = {}) {
  const {
    failOnRulesError = false,
    syncSalesforceData = SALESFORCE_VENDOR_DATA_SYNC_ENABLED,
    syncSalesforceSupplierSegments = SALESFORCE_SUPPLIER_SEGMENT_SYNC_ENABLED,
  } = options;
  const syncResult = await syncVendorsFromMysql({ syncSalesforceData });

  try {
    const rulesResult = await evaluateCategoryRules();
    const supplierSegmentSync = await syncVendorSupplierSegmentsFromProfiles({
      syncSalesforce: syncSalesforceSupplierSegments,
    });

    return {
      ...syncResult,
      rules: rulesResult,
      supplierSegmentSync,
    };
  } catch (error) {
    logger.error(
      `VendorClassificationService → syncVendorsAndEvaluateRules() rules evaluation failed: ${error.message}`,
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

function buildUserContactSupplierSegmentQuery(userIds = []) {
  const inClause = userIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ");

  return `
    SELECT
      Id,
      Contact.Id,
      Contact.Supplier_segment__c
    FROM User
    WHERE Id IN (${inClause})
  `;
}

async function fetchSalesforceContactSegmentMap(userIds = []) {
  const sf = await authenticateSalesforce();
  const contactByUserId = new Map();

  for (const batch of chunkArray(userIds, SALESFORCE_METADATA_BATCH_SIZE)) {
    if (!batch.length) continue;
    const rows = await runSoqlQueryAll(
      sf,
      buildUserContactSupplierSegmentQuery(batch),
    );

    for (const row of rows || []) {
      contactByUserId.set(String(row.Id || "").trim(), {
        contactId: String(row.Contact?.Id || "").trim() || null,
        supplierSegment: row.Contact?.Supplier_segment__c || null,
      });
    }
  }

  return { sf, contactByUserId };
}

async function syncVendorSupplierSegmentsFromProfiles(options = {}) {
  const { syncSalesforce = SALESFORCE_SUPPLIER_SEGMENT_SYNC_ENABLED } = options;

  await ensureVendorClassificationTables();

  const profiles = await VendorProfile.findAll({
    include: [buildVendorInfoInclude({ required: true })],
    order: [["id", "ASC"]],
  });
  const rowsToSync = [];

  for (const profile of profiles) {
    const category = getEffectiveVendorCategory(profile);
    const supplierSegment = getSupplierSegmentLabelForCategory(category);
    const vendorInfo = getProfileVendorInfo(profile);
    const salesforceUserId = String(profile.salesforce_user_id || "").trim();

    if (!supplierSegment || !vendorInfo || !salesforceUserId) continue;

    rowsToSync.push({
      profileId: profile.id,
      vendorId: vendorInfo.id,
      salesforceUserId,
      category,
      supplierSegment,
      currentLocalSupplierSegment: vendorInfo.supplier_segment || null,
    });
  }

  const result = {
    attempted: rowsToSync.length,
    localUpdated: 0,
    salesforceUpdated: 0,
    skipped: 0,
    failed: 0,
    salesforceSyncEnabled: syncSalesforce,
    salesforceSkipped: 0,
    failures: [],
  };

  for (const item of rowsToSync) {
    if (item.currentLocalSupplierSegment !== item.supplierSegment) {
      await Vendor.update(
        { supplier_segment: item.supplierSegment },
        { where: { id: item.vendorId } },
      );
      result.localUpdated += 1;
    }
  }

  if (!syncSalesforce) {
    result.skipped = rowsToSync.length;
    result.salesforceSkipped = rowsToSync.length;

    logger.info(
      `VendorClassificationService → syncVendorSupplierSegmentsFromProfiles() Salesforce sync disabled | attempted: ${result.attempted} | localUpdated: ${result.localUpdated} | salesforceSkipped: ${result.salesforceSkipped}`,
    );

    return result;
  }

  let salesforceContactMap;
  let sf;

  try {
    const contactResult = await fetchSalesforceContactSegmentMap(
      rowsToSync.map((item) => item.salesforceUserId),
    );
    salesforceContactMap = contactResult.contactByUserId;
    sf = contactResult.sf;
  } catch (error) {
    logger.error(
      `VendorClassificationService → syncVendorSupplierSegmentsFromProfiles() Salesforce contact lookup failed: ${error.message}`,
      { stack: error.stack },
    );

    return {
      ...result,
      failed: rowsToSync.length,
      failures: rowsToSync.map((item) => ({
        vendorId: item.vendorId,
        profileId: item.profileId,
        salesforceUserId: item.salesforceUserId,
        reason: error.message,
      })),
    };
  }

  for (const item of rowsToSync) {
    const contactInfo = salesforceContactMap.get(item.salesforceUserId);
    if (!contactInfo?.contactId) {
      result.skipped += 1;
      result.failures.push({
        vendorId: item.vendorId,
        profileId: item.profileId,
        salesforceUserId: item.salesforceUserId,
        reason: "Salesforce User has no linked Contact.Id",
      });
      continue;
    }

    if (String(contactInfo.supplierSegment || "") === item.supplierSegment) {
      result.skipped += 1;
      continue;
    }

    try {
      await patchSalesforceSObject(sf, "Contact", contactInfo.contactId, {
        Supplier_segment__c: item.supplierSegment,
      });
      result.salesforceUpdated += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        vendorId: item.vendorId,
        profileId: item.profileId,
        salesforceUserId: item.salesforceUserId,
        contactId: contactInfo.contactId,
        supplierSegment: item.supplierSegment,
        reason: error.message,
      });
    }
  }

  logger.info(
    `VendorClassificationService → syncVendorSupplierSegmentsFromProfiles() done | attempted: ${result.attempted} | localUpdated: ${result.localUpdated} | salesforceUpdated: ${result.salesforceUpdated} | skipped: ${result.skipped} | failed: ${result.failed}`,
  );

  return result;
}

function toPublicVendor(row, options = {}) {
  const { metricsOverride = null } = options;
  const vendorInfo = getProfileVendorInfo(row);
  const metrics = metricsOverride || {
    ...(row.metrics_json || {}),
    ...buildSnapshotMetricsJson(row),
  };
  const salesforceInfo = metrics?.salesforce || {};
  const vendorFreshness = metrics?.vendorFreshness || {};
  const manualCategory = normalizeCategory(row.manual_category) || null;
  const category =
    row.category_source === CATEGORY_SOURCE.MANUAL && manualCategory
      ? manualCategory
      : normalizeCategory(row.computed_category);

  return {
    id: row.id,
    salesforceUserId: row.salesforce_user_id,
    vendorTableId: vendorInfo?.id || null,
    username: vendorInfo?.email || row.username,
    account: vendorInfo?.name || row.account,
    supplier: vendorInfo?.contact_name || row.supplier,
    country: getVendorCountryName(vendorInfo) || row.country,
    supplierSegment: vendorInfo?.supplier_segment || row.supplier_segment,
    active: vendorInfo ? vendorInfo.status === "active" : Boolean(row.active),
    approvalAfter: formatDateForPublic(row.approval_after),
    firstSeenAt: formatDateForPublic(row.first_seen_at),
    lastSyncedAt: formatDateForPublic(row.last_synced_at),
    isNewVendor: Boolean(vendorFreshness.isNewVendor),
    newVendorReason: vendorFreshness.reason || null,
    newVendorWindowDays: Number(
      vendorFreshness.windowDays || NEW_VENDOR_WINDOW_DAYS,
    ),
    newVendorEffectiveDate: formatDateForPublic(vendorFreshness.effectiveDate),
    reactivatedAt: formatDateForPublic(vendorFreshness.reactivatedAt),
    deactivatedAt: formatDateForPublic(vendorFreshness.deactivatedAt),
    lastStatusChangedAt: formatDateForPublic(
      vendorFreshness.lastStatusChangedAt,
    ),
    contactCreatedAt: formatDateForPublic(salesforceInfo.contactCreatedAt),
    accountCreatedAt: formatDateForPublic(salesforceInfo.accountCreatedAt),
    accountLastModifiedAt: formatDateForPublic(
      salesforceInfo.accountLastModifiedAt,
    ),
    accountLastModifiedById: salesforceInfo.accountLastModifiedById || null,
    accountLastModifiedByName: salesforceInfo.accountLastModifiedByName || null,
    performanceScore: Number(row.performance_score || 0),
    category,
    computedCategory: normalizeCategory(row.computed_category),
    manualCategory,
    categorySource: row.category_source,
    metrics,
    alertFlags: row.alert_flags || null,
    consecutiveMissedWeeks: Number(row.consecutive_missed_weeks || 0),
    tortAssignments: (row.tortAssignments || []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product?.name || null,
      status: item.status,
      notes: item.notes,
      assignedBy: item.assigned_by,
      updatedAt: formatDateForPublic(item.updated_at),
    })),
  };
}

function toNumberSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateForPublic(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return `${day}/${month}/${year}`;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

function publicDateToSortKey(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return String(value || "");

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function toBooleanFlag(value) {
  return Boolean(value);
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) return false;

  return null;
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

function buildAssignedProductMatcher(assignments = []) {
  const productIds = new Set();
  const productNames = new Set();

  (assignments || []).forEach((assignment) => {
    if (assignment?.status && assignment.status !== "active") return;

    const productId = Number(assignment?.product_id || assignment?.productId);
    if (productId > 0) productIds.add(productId);

    const productName = normalizeTextKey(
      assignment?.product?.name || assignment?.productName,
    );
    if (productName) productNames.add(productName);
  });

  return {
    hasAssignments: productIds.size > 0 || productNames.size > 0,
    productIds,
    productNames,
  };
}

function doesSnapshotMatchAssignedProducts(snapshot, matcher) {
  if (!matcher?.hasAssignments) return false;

  const snapshotProductId = Number(snapshot?.product_id || 0);
  if (snapshotProductId > 0 && matcher.productIds.has(snapshotProductId)) {
    return true;
  }

  const snapshotProductName = normalizeTextKey(
    getSnapshotProductName(snapshot),
  );
  return snapshotProductName && matcher.productNames.has(snapshotProductName);
}

function getSnapshotProductName(row) {
  return (
    String(
      row?.Type || row?.caseProduct?.name || row?.product?.name || "Unknown",
    ).trim() || "Unknown"
  );
}

function getSnapshotCreatedAt(snapshot) {
  return snapshot?.case_created_at || snapshot?.CreatedDate || null;
}

function getSnapshotSentAt(snapshot) {
  return snapshot?.sent_date_2 || snapshot?.Sent_Date2__c || null;
}

function isSnapshotInsideCreatedDateWindow(snapshot, windowStart) {
  const createdAt = getSnapshotCreatedAt(snapshot);
  if (!createdAt) return false;

  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) return false;

  return createdDate >= windowStart;
}

function isSnapshotInsideSentDateWindow(snapshot, windowStart) {
  const sentAt = getSnapshotSentAt(snapshot);
  if (!sentAt) return false;

  const sentDate = new Date(sentAt);
  if (Number.isNaN(sentDate.getTime())) return false;

  return sentDate >= windowStart;
}

function buildSnapshotMetricsFromSnapshots(snapshots = [], options = {}) {
  const windowStart = options.windowStart || getCaseSnapshotWindowStart();
  const assignedProductMatcher = buildAssignedProductMatcher(
    options.assignments || [],
  );
  const scopedSnapshots = assignedProductMatcher.hasAssignments
    ? snapshots.filter((snapshot) =>
        doesSnapshotMatchAssignedProducts(snapshot, assignedProductMatcher),
      )
    : [];
  const inflowSnapshots = scopedSnapshots.filter((snapshot) =>
    isSnapshotInsideCreatedDateWindow(snapshot, windowStart),
  );
  const acceptedSnapshots = inflowSnapshots.filter((snapshot) =>
    isAcceptedCaseSnapshot(snapshot),
  );
  const outflowSnapshots = acceptedSnapshots.filter(
    (snapshot) =>
      isOutflowCaseSnapshot(snapshot) &&
      isSnapshotInsideSentDateWindow(snapshot, windowStart),
  );
  const byType = {};
  const byTypeMetrics = {};

  for (const snapshot of inflowSnapshots) {
    const typeName = getSnapshotProductName(snapshot);
    byType[typeName] = (byType[typeName] || 0) + 1;

    if (!byTypeMetrics[typeName]) {
      byTypeMetrics[typeName] = {
        inflow: 0,
        accepted: 0,
        outflow: 0,
      };
    }

    byTypeMetrics[typeName].inflow += 1;
    if (isAcceptedCaseSnapshot(snapshot)) byTypeMetrics[typeName].accepted += 1;
    if (
      isAcceptedCaseSnapshot(snapshot) &&
      isOutflowCaseSnapshot(snapshot) &&
      isSnapshotInsideSentDateWindow(snapshot, windowStart)
    ) {
      byTypeMetrics[typeName].outflow += 1;
    }
  }

  const total = inflowSnapshots.length;
  const acceptedCount = acceptedSnapshots.length;
  const outflowCount = outflowSnapshots.length;

  return {
    totals: {
      windowType: SALESFORCE_CASE_SNAPSHOT_WINDOW_TYPE,
      businessDays: SALESFORCE_CASE_SNAPSHOT_DAYS,
      windowStart: windowStart.toISOString(),
      last90Days: total,
      acceptedLast90Days: acceptedCount,
      outflowLast90Days: outflowCount,
      acceptedToInflowRatePercent:
        total > 0 ? Number(((acceptedCount / total) * 100).toFixed(2)) : 0,
      outflowToAcceptedRatePercent:
        acceptedCount > 0
          ? Number(((outflowCount / acceptedCount) * 100).toFixed(2))
          : 0,
      avgPerDay90Days: Number(
        (total / SALESFORCE_CASE_SNAPSHOT_DAYS).toFixed(4),
      ),
    },
    byType: {
      last90Days: byType,
    },
    byTypeMetrics: {
      last90Days: byTypeMetrics,
    },
    byTypeTier: {
      last90Days: {},
    },
  };
}

function buildSnapshotMetricsJson(row) {
  return buildSnapshotMetricsFromSnapshots(row?.caseSnapshots || [], {
    assignments: row?.tortAssignments || [],
  });
}

function groupSalesforceCaseSnapshotsByOwnerId(rows = []) {
  const grouped = new Map();

  rows.forEach((row) => {
    const ownerId = String(row?.OwnerId || "").trim();
    if (!ownerId) return;

    if (!grouped.has(ownerId)) {
      grouped.set(ownerId, []);
    }

    grouped.get(ownerId).push(row);
  });

  return grouped;
}

function buildMetricsOverrideFromLiveSnapshots(row, liveCaseRows = []) {
  if (!Array.isArray(liveCaseRows) || liveCaseRows.length === 0) return null;

  const windowStart = getCaseSnapshotWindowStart();

  return {
    ...(row.metrics_json || {}),
    ...buildSnapshotMetricsFromSnapshots(liveCaseRows, {
      windowStart,
      assignments: row.tortAssignments || [],
    }),
  };
}

function toPublicAlertFlags(flags = {}, vendor = {}) {
  const totals = vendor.metrics?.totals || {};
  const businessDays = toNumberSafe(totals.businessDays);
  const acceptedLast90Days = toNumberSafe(totals.acceptedLast90Days);
  const acceptedAvgPerDay =
    businessDays > 0
      ? Number((acceptedLast90Days / businessDays).toFixed(4))
      : 0;

  return {
    fraudRisk: toBooleanFlag(flags.fraud_risk),
    fraudRatePercent: toNumberSafe(flags.fraud_rate_pct),
    accepted28Days: acceptedLast90Days || toNumberSafe(flags.accepted_28_days),
    acceptedDays28: toNumberSafe(flags.accepted_days_28),
    conversionRatePercent:
      toNumberSafe(totals.acceptedToInflowRatePercent) ||
      toNumberSafe(flags.conversion_rate_pct),
    acceptedAvgPerDay:
      acceptedAvgPerDay || toNumberSafe(flags.accepted_avg_per_day),
    topConversionWindowDays:
      businessDays || toNumberSafe(flags.top_conversion_window_days),
    topInflow90Days:
      toNumberSafe(totals.last90Days) || toNumberSafe(flags.top_inflow_90_days),
    topAccepted90Days:
      acceptedLast90Days || toNumberSafe(flags.top_accepted_90_days),
    topOutflow90Days:
      toNumberSafe(totals.outflowLast90Days) ||
      toNumberSafe(flags.top_outflow_90_days),
    topAcceptedToInflowRatePercent:
      toNumberSafe(totals.acceptedToInflowRatePercent) ||
      toNumberSafe(flags.top_accepted_to_inflow_rate_pct),
    topOutflowToAcceptedRatePercent:
      toNumberSafe(totals.outflowToAcceptedRatePercent) ||
      toNumberSafe(flags.top_outflow_to_accepted_rate_pct) ||
      toNumberSafe(flags.top_accepted_to_outflow_rate_pct),
    topMinAcceptedToInflowRatePercent: toNumberSafe(
      flags.top_min_accepted_to_inflow_rate_pct,
    ),
    topMinOutflowToAcceptedRatePercent: toNumberSafe(
      flags.top_min_accepted_to_outflow_rate_pct,
    ),
    topMeetsConversionThresholds: toBooleanFlag(
      flags.top_meets_conversion_thresholds,
    ),
    classificationMatrix: flags.classification_matrix || null,
    highQuality: {
      enabled: toBooleanFlag(flags.hq_enabled),
      status: flags.hq_status || null,
      isHighQuality: toBooleanFlag(flags.hq_high_quality),
      acceptedToInflowRatePercent:
        toNumberSafe(totals.acceptedToInflowRatePercent) ||
        toNumberSafe(flags.hq_accepted_to_inflow_rate_pct),
      minAcceptedToInflowRatePercent: toNumberSafe(
        flags.hq_min_accepted_to_inflow_rate_pct,
      ),
    },
    highVolume: {
      enabled: toBooleanFlag(flags.hv_enabled),
      status: flags.hv_status || null,
      isHighVolume: toBooleanFlag(flags.hv_high_volume),
      passedTorts: toNumberSafe(flags.hv_passed_torts),
      totalTorts: toNumberSafe(flags.hv_total_torts),
      passRatePercent: toNumberSafe(flags.hv_pass_rate_pct),
      minPassRatePercent: toNumberSafe(flags.hv_min_pass_rate_pct),
      completedWeeksEvaluated: toNumberSafe(flags.hv_completed_weeks_evaluated),
      byTort: Array.isArray(flags.hv_by_tort) ? flags.hv_by_tort : [],
    },
    topConversionWindowType:
      totals.windowType || flags.top_conversion_window_type || null,
    topConversionWindowStart: formatDateForPublic(
      totals.windowStart || flags.top_conversion_window_start,
    ),
    topCompletedWeeksEvaluated: toNumberSafe(
      flags.top_completed_weeks_evaluated,
    ),
    topGoalMetCount: toNumberSafe(flags.top_goal_met_count),
    topGoalTotalCount: toNumberSafe(flags.top_goal_total_count),
    topGoalComplianceRate:
      flags.top_goal_compliance_rate === null ||
      flags.top_goal_compliance_rate === undefined
        ? null
        : toNumberSafe(flags.top_goal_compliance_rate),
    topCompensatedGoalMetCount: toNumberSafe(
      flags.top_compensated_goal_met_count,
    ),
    topCompensatedGoalComplianceRate:
      flags.top_compensated_goal_compliance_rate === null ||
      flags.top_compensated_goal_compliance_rate === undefined
        ? null
        : toNumberSafe(flags.top_compensated_goal_compliance_rate),
    topUnderperformWeeks: toNumberSafe(flags.top_underperform_weeks),
    trendingToNewVendor: toBooleanFlag(flags.trending_to_new_vendor),
    trendingToUnderReview: toBooleanFlag(flags.trending_to_under_review),
    consecutiveMissedWeeks: toNumberSafe(flags.consecutive_missed_weeks),
    lastTopCheckWeek: formatDateForPublic(flags.last_top_check_week),
    goalCompensation: {
      enabled: toBooleanFlag(flags.goal_compensation_enabled),
      mode: flags.goal_compensation_mode || null,
      applied: toBooleanFlag(flags.goal_compensation_applied),
      eligible: toBooleanFlag(flags.goal_compensation_eligible),
      messageCode: flags.goal_compensation_message_code || null,
      message: flags.goal_compensation_message || null,
      windowWeeks: toNumberSafe(flags.goal_compensation_window_weeks),
      completedWeeksEvaluated: toNumberSafe(
        flags.goal_compensation_completed_weeks_evaluated,
      ),
      totalTarget: toNumberSafe(flags.goal_compensation_total_target),
      totalOutflow: toNumberSafe(flags.goal_compensation_total_outflow),
      totalDeficit: toNumberSafe(flags.goal_compensation_total_deficit),
      totalSurplus: toNumberSafe(flags.goal_compensation_total_surplus),
      byTort: Array.isArray(flags.goal_compensation_by_tort)
        ? flags.goal_compensation_by_tort
        : [],
    },
    newVendorProbation: {
      enabled: toBooleanFlag(flags.new_vendor_probation_enabled),
      trialWeeks: toNumberSafe(flags.new_vendor_probation_trial_weeks),
      completedWeeks: toNumberSafe(flags.new_vendor_probation_completed_weeks),
      remainingWeeks: toNumberSafe(flags.new_vendor_probation_remaining_weeks),
      trialComplete: toBooleanFlag(flags.new_vendor_probation_trial_complete),
      status: flags.new_vendor_probation_status || null,
      subcategory: flags.new_vendor_probation_subcategory || null,
      actionRequired: toBooleanFlag(flags.new_vendor_probation_action_required),
      shouldDeactivate: toBooleanFlag(
        flags.new_vendor_probation_should_deactivate,
      ),
      recommendedAction: flags.new_vendor_probation_recommended_action || null,
      messageCode: flags.new_vendor_probation_message_code || null,
      message: flags.new_vendor_probation_message || null,
      totalTarget: toNumberSafe(flags.new_vendor_probation_total_target),
      totalOutflow: toNumberSafe(flags.new_vendor_probation_total_outflow),
      totalDeficit: toNumberSafe(flags.new_vendor_probation_total_deficit),
      totalSurplus: toNumberSafe(flags.new_vendor_probation_total_surplus),
      byTort: Array.isArray(flags.new_vendor_probation_by_tort)
        ? flags.new_vendor_probation_by_tort
        : [],
      currentWeekProgress: flags.new_vendor_probation_current_week || null,
    },
    underReviewProductivity: {
      enabled: toBooleanFlag(flags.under_review_productivity_enabled),
      reviewWeeks: toNumberSafe(flags.under_review_productivity_review_weeks),
      completedWeeks: toNumberSafe(
        flags.under_review_productivity_completed_weeks,
      ),
      remainingWeeks: toNumberSafe(
        flags.under_review_productivity_remaining_weeks,
      ),
      reviewComplete: toBooleanFlag(
        flags.under_review_productivity_review_complete,
      ),
      status: flags.under_review_productivity_status || null,
      subcategory: flags.under_review_productivity_subcategory || null,
      actionRequired: toBooleanFlag(
        flags.under_review_productivity_action_required,
      ),
      shouldDeactivate: toBooleanFlag(
        flags.under_review_productivity_should_deactivate,
      ),
      recommendedAction:
        flags.under_review_productivity_recommended_action || null,
      messageCode: flags.under_review_productivity_message_code || null,
      message: flags.under_review_productivity_message || null,
      totalTarget: toNumberSafe(flags.under_review_productivity_total_target),
      totalOutflow: toNumberSafe(flags.under_review_productivity_total_outflow),
      totalDeficit: toNumberSafe(flags.under_review_productivity_total_deficit),
      totalSurplus: toNumberSafe(flags.under_review_productivity_total_surplus),
      byTort: Array.isArray(flags.under_review_productivity_by_tort)
        ? flags.under_review_productivity_by_tort
        : [],
      currentWeekProgress: flags.under_review_productivity_current_week || null,
    },
    criticalVendorStatus: {
      enabled: toBooleanFlag(flags.critical_vendor_enabled),
      reviewWeeks: toNumberSafe(flags.critical_vendor_review_weeks),
      completedWeeks: toNumberSafe(flags.critical_vendor_completed_weeks),
      remainingWeeks: toNumberSafe(flags.critical_vendor_remaining_weeks),
      reviewComplete: toBooleanFlag(flags.critical_vendor_review_complete),
      status: flags.critical_vendor_status || null,
      subcategory: flags.critical_vendor_subcategory || null,
      actionRequired: toBooleanFlag(flags.critical_vendor_action_required),
      shouldDeactivate: toBooleanFlag(flags.critical_vendor_should_deactivate),
      recommendedAction: flags.critical_vendor_recommended_action || null,
      messageCode: flags.critical_vendor_message_code || null,
      message: flags.critical_vendor_message || null,
      hqLow: toBooleanFlag(flags.critical_vendor_hq_low),
      hvLow: toBooleanFlag(flags.critical_vendor_hv_low),
      acceptedToInflowRatePercent: toNumberSafe(
        flags.critical_vendor_accepted_to_inflow_rate_pct,
      ),
      highVolumeRatePercent: toNumberSafe(flags.critical_vendor_hv_rate_pct),
      totalTarget: toNumberSafe(flags.critical_vendor_total_target),
      totalOutflow: toNumberSafe(flags.critical_vendor_total_outflow),
      totalDeficit: toNumberSafe(flags.critical_vendor_total_deficit),
      totalSurplus: toNumberSafe(flags.critical_vendor_total_surplus),
      byTort: Array.isArray(flags.critical_vendor_by_tort)
        ? flags.critical_vendor_by_tort
        : [],
      currentWeekProgress: flags.critical_vendor_current_week || null,
    },
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
    vendorTableId: vendor.vendorTableId,
    username: vendor.username,
    account: vendor.account,
    supplier: vendor.supplier,
    country: vendor.country,
    supplierSegment: vendor.supplierSegment,
    active: vendor.active,
    approvalAfter: vendor.approvalAfter,
    firstSeenAt: vendor.firstSeenAt,
    lastSyncedAt: vendor.lastSyncedAt,
    isNewVendor: vendor.isNewVendor,
    newVendorWindowDays: vendor.newVendorWindowDays,
    contactCreatedAt: vendor.contactCreatedAt,
    accountCreatedAt: vendor.accountCreatedAt,
    accountLastModifiedAt: vendor.accountLastModifiedAt,
    accountLastModifiedById: vendor.accountLastModifiedById,
    accountLastModifiedByName: vendor.accountLastModifiedByName,
  };
}

function buildPerformancePayload(vendor) {
  const totals = vendor.metrics?.totals || {};
  const inflow90 = toNumberSafe(totals.last90Days);
  const accepted90 = toNumberSafe(totals.acceptedLast90Days);
  const outflow90 = toNumberSafe(totals.outflowLast90Days);

  return {
    score: toNumberSafe(vendor.performanceScore),
    kpis: {
      windowType: totals.windowType || null,
      businessDays: toNumberSafe(totals.businessDays),
      windowStart: formatDateForPublic(totals.windowStart),
      inflowLast90Days: inflow90,
      acceptedLast90Days: accepted90,
      outflowLast90Days: outflow90,
      acceptedToInflowConversionRateLast90DaysPercent: toNumberSafe(
        totals.acceptedToInflowRatePercent,
      ),
      outflowToAcceptedConversionRateLast90DaysPercent: toNumberSafe(
        totals.outflowToAcceptedRatePercent,
      ),
      avgInflowPerDayLast90Days: toNumberSafe(totals.avgPerDay90Days),
    },
  };
}

function buildListAnalyticsPayload(performance) {
  const kpis = performance?.kpis || {};

  return {
    inflow: toNumberSafe(kpis.inflowLast90Days),
    accepted: toNumberSafe(kpis.acceptedLast90Days),
    outflow: toNumberSafe(kpis.outflowLast90Days),
    acceptedToInflowConversionRate: toNumberSafe(
      kpis.acceptedToInflowConversionRateLast90DaysPercent,
    ),
    outflowToAcceptedConversionRate: toNumberSafe(
      kpis.outflowToAcceptedConversionRateLast90DaysPercent,
    ),
  };
}

function getCategoryBadgeLabel(category) {
  const labels = {
    [CATEGORY.NEW_VENDOR]: "New vendor",
    [CATEGORY.TOP_VENDORS]: "Top vendors",
    [CATEGORY.UNDER_REVIEW]: "Under review",
    [CATEGORY.CRITICAL_VENDOR]: "Critical vendor",
  };

  return labels[category] || category;
}

function getCategoryBadgeSeverity(category) {
  if (category === CATEGORY.TOP_VENDORS) return "success";
  if (category === CATEGORY.NEW_VENDOR) return "warning";
  if (category === CATEGORY.UNDER_REVIEW) return "danger";
  if (category === CATEGORY.CRITICAL_VENDOR) return "danger";
  return "neutral";
}

function buildCategoryDisplayBadges(vendor, alerts = {}) {
  const primaryBadge = buildCategoryPrimaryBadge(vendor);
  const secondaryBadges = buildCategorySecondaryBadges(vendor, alerts);

  return [primaryBadge, ...secondaryBadges];
}

function buildCategoryPrimaryBadge(vendor) {
  return {
    code: vendor.category,
    label: getCategoryBadgeLabel(vendor.category),
    type: "category",
    severity: getCategoryBadgeSeverity(vendor.category),
  };
}

function countMissedGoalWeeks(signal = {}) {
  return (signal.byTort || []).reduce((maxMissedWeeks, tort) => {
    const missedWeeks = (tort.weeklyBreakdown || []).filter(
      (week) => !week.actualMet,
    ).length;
    return Math.max(maxMissedWeeks, missedWeeks);
  }, 0);
}

function hasActiveTortAssignment(vendor) {
  return (vendor.tortAssignments || []).some(
    (assignment) => assignment.status === "active",
  );
}

function getUnderperformingTorts(signal = {}) {
  return (signal.byTort || []).filter(
    (item) => !item.eligibleAfterCompensation,
  );
}

function formatTortBadgeLabel(torts = []) {
  if (torts.length === 0) return null;
  if (torts.length === 1) {
    return `${torts[0].productName || "Assigned tort"} below goal`;
  }
  return `${torts.length} torts below goal`;
}

function buildCategorySecondaryBadges(vendor, alerts = {}) {
  const newVendorProbation = alerts.newVendorProbation || {};
  const underReviewProductivity = alerts.underReviewProductivity || {};
  const criticalVendorStatus = alerts.criticalVendorStatus || {};
  const actionSignal = newVendorProbation.enabled
    ? newVendorProbation
    : underReviewProductivity.enabled
      ? underReviewProductivity
      : criticalVendorStatus.enabled
        ? criticalVendorStatus
        : null;

  const badges = [];
  const canRecommendDeactivation =
    newVendorProbation.enabled || criticalVendorStatus.enabled;

  if (actionSignal?.shouldDeactivate && canRecommendDeactivation) {
    badges.push({
      code: actionSignal.subcategory || "deactivate_vendor",
      label: "Deactivation recommended",
      type: "action",
      severity: "danger",
      message: actionSignal.message || null,
    });
  } else if (
    actionSignal?.recommendedAction === "deactivate_underperforming_torts"
  ) {
    badges.push({
      code: actionSignal.subcategory || "deactivate_underperforming_torts",
      label: "Tort deactivation recommended",
      type: "action",
      severity: "warning",
      message: actionSignal.message || null,
    });
  } else if (actionSignal?.actionRequired) {
    badges.push({
      code: actionSignal.subcategory || "action_required",
      label: actionSignal.status === "partial" ? "Partial progress" : "At risk",
      type: "status",
      severity: "warning",
      message: actionSignal.message || null,
    });
  }

  if (actionSignal?.enabled) {
    const totalOutflow = Number(actionSignal.totalOutflow || 0);
    const totalTarget = Number(actionSignal.totalTarget || 0);
    const totalDeficit = Number(actionSignal.totalDeficit || 0);
    const missedWeeks = countMissedGoalWeeks(actionSignal);
    const underperformingTorts = getUnderperformingTorts(actionSignal);
    const underperformingTortsLabel =
      formatTortBadgeLabel(underperformingTorts);

    if (missedWeeks > 0) {
      badges.push({
        code: "missed_weeks",
        label:
          missedWeeks === 1 ? "Missed 1 week" : `Missed ${missedWeeks} weeks`,
        type: "reason",
        severity: actionSignal.shouldDeactivate ? "danger" : "warning",
        message: actionSignal.message || null,
      });
    }

    if (underperformingTortsLabel) {
      badges.push({
        code: "underperforming_torts",
        label: underperformingTortsLabel,
        type: "reason",
        severity: actionSignal.shouldDeactivate ? "danger" : "warning",
        message: actionSignal.message || null,
      });
    }

    if (!hasActiveTortAssignment(vendor)) {
      badges.push({
        code: "no_assigned_torts",
        label: "No assigned torts",
        type: "reason",
        severity: "danger",
        message: "Vendor has no active tort assignments.",
      });
    } else if (totalTarget > 0 && totalDeficit > 0) {
      badges.push({
        code: "goal_deficit",
        label: `${totalOutflow}/${totalTarget} outflow`,
        type: "reason",
        severity: actionSignal.shouldDeactivate ? "danger" : "warning",
        message: actionSignal.message || null,
      });
    } else if (totalTarget > 0 && totalOutflow >= totalTarget) {
      badges.push({
        code: "goal_met",
        label: `${totalOutflow}/${totalTarget} outflow`,
        type: "reason",
        severity: "success",
        message: actionSignal.message || null,
      });
    }

    const currentWeek = actionSignal.currentWeekProgress || null;
    const currentWeekTarget = Number(currentWeek?.totalTarget || 0);
    const currentWeekOutflow = Number(currentWeek?.totalOutflow || 0);
    if (currentWeekTarget > 0) {
      badges.push({
        code: "current_week_progress",
        label: `${currentWeekOutflow}/${currentWeekTarget} this week`,
        type: "context",
        severity: "neutral",
      });
    }

    if (!actionSignal.trialComplete && !actionSignal.reviewComplete) {
      const remainingWeeks = Number(actionSignal.remainingWeeks || 0);
      badges.push({
        code: "weeks_remaining",
        label:
          remainingWeeks === 1
            ? "1 week remaining"
            : `${remainingWeeks} weeks remaining`,
        type: "context",
        severity: "neutral",
      });
    }

    return badges;
  }

  if (alerts.goalCompensation?.applied) {
    return [
      {
        code: "goal_compensation_applied",
        label: "Goal compensated",
        type: "status",
        severity: "info",
        message: alerts.goalCompensation.message || null,
      },
    ];
  }

  if (vendor.category === CATEGORY.TOP_VENDORS) {
    const hqPct = toNumberSafe(alerts.highQuality?.acceptedToInflowRatePercent);
    const hvRate = toNumberSafe(alerts.highVolume?.passRatePercent);
    const topBadges = [
      {
        code: "top_stable",
        label: "Stable",
        type: "status",
        severity: "success",
      },
    ];
    if (hqPct > 0 && hqPct < 25) {
      topBadges.push({
        code: "top_hq_trending_down",
        label: `HQ ${hqPct}% (low margin)`,
        type: "status",
        severity: "warning",
      });
    }
    if (hvRate > 0 && hvRate < 60) {
      topBadges.push({
        code: "top_hv_trending_down",
        label: `HV ${hvRate}% (low margin)`,
        type: "status",
        severity: "warning",
      });
    }
    return topBadges;
  }

  return [];
}

function buildCategoryPayload(vendor) {
  const categoryInfo = vendor.metrics?.category || {};
  const alerts = toPublicAlertFlags(vendor.alertFlags || {}, vendor);
  const newVendorProbation = alerts.newVendorProbation || {};
  const underReviewProductivity = alerts.underReviewProductivity || {};
  const criticalVendorStatus = alerts.criticalVendorStatus || {};
  const subcategory =
    newVendorProbation.enabled && newVendorProbation.subcategory
      ? newVendorProbation.subcategory
      : underReviewProductivity.enabled && underReviewProductivity.subcategory
        ? underReviewProductivity.subcategory
        : criticalVendorStatus.enabled && criticalVendorStatus.subcategory
          ? criticalVendorStatus.subcategory
          : vendor.category === CATEGORY.TOP_VENDORS
            ? "top_goal_qualified"
            : vendor.category === CATEGORY.UNDER_REVIEW
              ? "under_review_default"
              : null;

  return {
    current: vendor.category,
    subcategory,
    primaryBadge: buildCategoryPrimaryBadge(vendor),
    secondaryBadges: buildCategorySecondaryBadges(vendor, alerts),
    displayBadges: buildCategoryDisplayBadges(vendor, alerts),
    source: vendor.categorySource,
    computed: vendor.computedCategory,
    manual: vendor.manualCategory,
    isNewVendorCategory: vendor.category === CATEGORY.NEW_VENDOR,
    isCriticalVendorCategory: vendor.category === CATEGORY.CRITICAL_VENDOR,
    isNewVendor: Boolean(vendor.isNewVendor),
    newVendorWindowDays: vendor.newVendorWindowDays,
    isTop20Candidate: toBooleanFlag(categoryInfo.isTop20Candidate),
    consecutiveMissedWeeks: toNumberSafe(vendor.consecutiveMissedWeeks),
    actionRequired: Boolean(
      newVendorProbation.actionRequired ||
      underReviewProductivity.actionRequired ||
      criticalVendorStatus.actionRequired,
    ),
    shouldDeactivate: Boolean(
      newVendorProbation.shouldDeactivate ||
      criticalVendorStatus.shouldDeactivate,
    ),
    recommendedAction:
      newVendorProbation.recommendedAction ||
      underReviewProductivity.recommendedAction ||
      criticalVendorStatus.recommendedAction ||
      null,
    alerts,
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

function normalizeRewardKeys(rewards = []) {
  const allowed = new Set(REWARD_KEYS);
  return Array.from(
    new Set(
      (rewards || [])
        .map((reward) => String(reward || "").trim())
        .filter((reward) => allowed.has(reward)),
    ),
  );
}

function resolveRewardKeysFromPayload(payload = {}) {
  if (Array.isArray(payload.rewards)) {
    return normalizeRewardKeys(payload.rewards);
  }

  return Object.entries(LEGACY_REWARD_KEY_BY_FIELD)
    .filter(([field]) => Boolean(payload[field]))
    .map((entry) => entry[1]);
}

function buildRewardUpdatePayload(rewardKeys = []) {
  const selected = new Set(normalizeRewardKeys(rewardKeys));
  const payload = { active: selected.size > 0 };

  REWARD_KEYS.forEach((key) => {
    payload[REWARD_COLUMN_BY_KEY[key]] = selected.has(key);
  });

  return payload;
}

function toPublicRewards(topReward) {
  if (!topReward) {
    return {
      active: false,
      selected: [],
    };
  }

  const selected = REWARD_KEYS.filter((key) =>
    Boolean(topReward[REWARD_COLUMN_BY_KEY[key]]),
  );

  return {
    active: Boolean(topReward.active) && selected.length > 0,
    selected,
    // Legacy fields kept for older consumers.
    bonusAccess: Boolean(topReward.bonus_access),
    net7: Boolean(topReward.net_7),
    replacementFlexibility: Boolean(topReward.replacement_flexibility),
    autoIntake: Boolean(topReward.auto_intake),
  };
}

function buildVendorInfoInclude({ required = true, where } = {}) {
  return {
    model: Vendor,
    as: "vendorInfo",
    required,
    where,
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
  };
}

function buildCaseSnapshotInclude() {
  return {
    model: VendorCaseSnapshot,
    as: "caseSnapshots",
    required: false,
    where: {
      [Op.or]: [
        {
          case_created_at: {
            [Op.gte]: getLast90DaysStart(),
          },
        },
        {
          sent_date_2: {
            [Op.gte]: getLast90DaysStart(),
          },
        },
      ],
    },
    attributes: [
      "salesforce_case_id",
      "case_number",
      "product_id",
      "case_created_at",
      "signed_date",
      "sent_date_2",
      "outflow_validated",
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

function getDefaultGoalOverview() {
  return {
    summary: {
      totalGoals: 0,
      totalWeeks: 0,
      metWeeks: 0,
      missedGoals: 0,
      missedWeeks: 0,
      rate: null,
      totalTarget: 0,
      totalOutflow: 0,
      visibleTotalGoals: 0,
      visibleTotalWeeks: 0,
      visibleMetWeeks: 0,
      visibleMissedWeeks: 0,
      visibleRate: null,
      visibleTotalTarget: 0,
      visibleTotalOutflow: 0,
    },
    byTort: [],
    compensation: buildGoalCompensationSummary([], {
      windowWeeks: GOAL_COMPLETED_EVALUATION_WEEKS,
    }),
  };
}

function buildGoalCompensationFromRows(
  rows = [],
  windowWeeks = GOAL_COMPLETED_EVALUATION_WEEKS,
) {
  const weekMap = new Map();

  rows.forEach((row) => {
    const weekStart = toDateOnlyString(row.week_start);
    const weekEnd = toDateOnlyString(row.week_end);
    if (!weekStart || !weekEnd) return;

    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {
        week: {
          startStr: weekStart,
          endStr: weekEnd,
        },
        weekStart,
        weekEnd,
        weeksAgo: 0,
        isComplete: isGoalWeekComplete(weekEnd),
        goals: [],
      });
    }

    weekMap.get(weekStart).goals.push({
      productId: row.product_id,
      productName: row.product?.name || null,
      target: toNumberSafe(row.weekly_target),
      actual: toNumberSafe(row.actual_outflow ?? row.actual_inflow),
      met: Boolean(row.goal_met),
    });
  });

  const sortedWeekStarts = Array.from(weekMap.keys()).sort((a, b) =>
    a < b ? 1 : -1,
  );

  return buildGoalCompensationSummary(
    sortedWeekStarts.map((weekStart, index) => ({
      ...weekMap.get(weekStart),
      weeksAgo: index,
    })),
    { windowWeeks },
  );
}

function buildGoalOverviewMap(rows = []) {
  const byVendorId = new Map();
  const currentWeekStart = getCurrentGoalWeekStartDate();

  rows.forEach((row) => {
    const vendorId = Number(row.vendor_id);
    const productId = Number(row.product_id);
    const productName = row.product?.name || null;
    const weekStart = toDateOnlyString(row.week_start);
    const weekEnd = toDateOnlyString(row.week_end);

    if (!byVendorId.has(vendorId)) {
      byVendorId.set(vendorId, {
        visibleTotalWeeks: 0,
        visibleMetWeeks: 0,
        visibleTotalTarget: 0,
        visibleTotalOutflow: 0,
        evaluationTotalWeeks: 0,
        evaluationMetWeeks: 0,
        evaluationTotalTarget: 0,
        evaluationTotalOutflow: 0,
        rows: [],
        byTortMap: new Map(),
      });
    }

    const entry = byVendorId.get(vendorId);
    entry.rows.push(row);
    const actualOutflow = toNumberSafe(row.actual_outflow ?? row.actual_inflow);
    const weeklyTarget = toNumberSafe(row.weekly_target);
    const goalMet = Boolean(row.goal_met);
    const isCurrentWeek = weekStart === currentWeekStart;
    const isComplete = isGoalWeekComplete(weekEnd);
    const countsForCategory = isComplete && !isCurrentWeek;

    entry.visibleTotalWeeks += 1;
    if (goalMet) entry.visibleMetWeeks += 1;
    entry.visibleTotalTarget += weeklyTarget;
    entry.visibleTotalOutflow += actualOutflow;

    if (countsForCategory) {
      entry.evaluationTotalWeeks += 1;
      if (goalMet) entry.evaluationMetWeeks += 1;
      entry.evaluationTotalTarget += weeklyTarget;
      entry.evaluationTotalOutflow += actualOutflow;
    }

    const tortKey = `${productId}:${productName || ""}`;
    if (!entry.byTortMap.has(tortKey)) {
      entry.byTortMap.set(tortKey, {
        productId,
        productName,
        weeks: [],
      });
    }

    entry.byTortMap.get(tortKey).weeks.push({
      id: row.id,
      weekStart: formatDateForPublic(weekStart),
      weekEnd: formatDateForPublic(weekEnd),
      weeklyTarget,
      actualOutflow,
      goalMet,
      calculatedAt: formatDateForPublic(row.updated_at),
      isCurrentWeek,
      isComplete,
      countsForCategory,
      evaluationStatus: isCurrentWeek
        ? "in_progress"
        : isComplete
          ? "completed"
          : "pending",
    });
  });

  const output = new Map();

  for (const [vendorId, entry] of byVendorId.entries()) {
    const missedWeeks = entry.evaluationTotalWeeks - entry.evaluationMetWeeks;
    const visibleMissedWeeks = entry.visibleTotalWeeks - entry.visibleMetWeeks;
    const byTort = Array.from(entry.byTortMap.values()).map((item) => ({
      ...item,
      weeks: item.weeks.sort((a, b) =>
        publicDateToSortKey(a.weekStart) < publicDateToSortKey(b.weekStart)
          ? 1
          : -1,
      ),
    }));

    output.set(vendorId, {
      summary: {
        totalGoals: entry.evaluationTotalWeeks,
        totalWeeks: entry.evaluationTotalWeeks,
        metWeeks: entry.evaluationMetWeeks,
        missedGoals: missedWeeks,
        missedWeeks,
        rate:
          entry.evaluationTotalWeeks > 0
            ? Number(
                (entry.evaluationMetWeeks / entry.evaluationTotalWeeks).toFixed(
                  4,
                ),
              )
            : null,
        totalTarget: entry.evaluationTotalTarget,
        totalOutflow: entry.evaluationTotalOutflow,
        visibleTotalGoals: entry.visibleTotalWeeks,
        visibleTotalWeeks: entry.visibleTotalWeeks,
        visibleMetWeeks: entry.visibleMetWeeks,
        visibleMissedWeeks,
        visibleRate:
          entry.visibleTotalWeeks > 0
            ? Number(
                (entry.visibleMetWeeks / entry.visibleTotalWeeks).toFixed(4),
              )
            : null,
        visibleTotalTarget: entry.visibleTotalTarget,
        visibleTotalOutflow: entry.visibleTotalOutflow,
      },
      byTort,
      compensation: buildGoalCompensationFromRows(
        entry.rows,
        GOAL_COMPLETED_EVALUATION_WEEKS,
      ),
    });
  }

  return output;
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

function buildCaseEntriesByTypeMap(rows = [], options = {}) {
  const assignedProductMatcher = buildAssignedProductMatcher(
    options.assignments || [],
  );
  const goalOutflowWindow = getGoalOutflowWindowInfo();
  const byType = {};

  rows.forEach((row) => {
    if (
      assignedProductMatcher.hasAssignments &&
      !doesSnapshotMatchAssignedProducts(row, assignedProductMatcher)
    ) {
      return;
    }

    const type =
      String(
        row?.Type || row?.caseProduct?.name || row?.product?.name || "Unknown",
      ).trim() || "Unknown";
    const caseNumber = String(row?.CaseNumber || row?.case_number || "").trim();
    const caseId = String(row?.Id || row?.salesforce_case_id || "").trim();
    const outflowDate = getSnapshotSentAt(row);
    const outflowValidated = isValidatedOutflowSnapshot(row);

    if (!caseNumber || !caseId) return;
    if (!byType[type]) byType[type] = [];

    byType[type].push({
      caseNumber,
      caseId,
      outflow: {
        date: formatDateForPublic(outflowDate),
        validated: outflowValidated,
        countsForVisibleGoalWindow: Boolean(
          outflowValidated &&
          isDateInsideWindow(outflowDate, goalOutflowWindow.visible),
        ),
        countsForCategoryWindow: Boolean(
          outflowValidated &&
          isDateInsideWindow(outflowDate, goalOutflowWindow.classification),
        ),
        visibleGoalWindow: goalOutflowWindow.visible
          ? {
              start: formatDateForPublic(goalOutflowWindow.visible.startStr),
              end: formatDateForPublic(goalOutflowWindow.visible.endStr),
              weeks: GOAL_OVERVIEW_WEEKS,
            }
          : null,
        categoryWindow: goalOutflowWindow.classification
          ? {
              start: formatDateForPublic(
                goalOutflowWindow.classification.startStr,
              ),
              end: formatDateForPublic(goalOutflowWindow.classification.endStr),
              weeks: GOAL_COMPLETED_EVALUATION_WEEKS,
            }
          : null,
      },
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
    const weekStart = toDateOnlyString(g.week_start);
    const weekEnd = toDateOnlyString(g.week_end);
    const isCurrentWeek = weekStart === getCurrentGoalWeekStartDate();
    const isComplete = isGoalWeekComplete(weekEnd);
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
      weekStart: formatDateForPublic(weekStart),
      weekEnd: formatDateForPublic(weekEnd),
      weeklyTarget: g.weekly_target,
      actualOutflow: g.actual_outflow ?? g.actual_inflow,
      goalMet: Boolean(g.goal_met),
      calculatedAt: formatDateForPublic(g.updated_at),
      isCurrentWeek,
      isComplete,
      countsForCategory: isComplete && !isCurrentWeek,
      evaluationStatus: isCurrentWeek
        ? "in_progress"
        : isComplete
          ? "completed"
          : "pending",
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
      compensation: buildGoalCompensationFromRows(
        weeklyGoals,
        GOAL_COMPLETED_EVALUATION_WEEKS,
      ),
    },
    rewards: topReward ? toPublicRewards(topReward) : toPublicRewards(null),
    categoryLogs: categoryLogs.map((l) => ({
      id: l.id,
      fromCategory: l.from_category,
      toCategory: l.to_category,
      reason: l.reason,
      triggeredBy: l.triggered_by,
      createdAt: formatDateForPublic(l.created_at),
    })),
  };
}

function buildCaseReasonPayload(record) {
  const fields = {};
  const active = [];

  VENDOR_CASE_REASON_FIELDS.forEach((field) => {
    const value = record[field] || null;
    fields[field] = value;

    if (value) {
      active.push({
        field,
        label: VENDOR_CASE_REASON_LABELS[field] || field,
        value,
      });
    }
  });

  return { fields, active };
}

function mapVendorAssignedCase(record, { instanceUrl, vendorSalesforceId }) {
  const reasons = buildCaseReasonPayload(record);
  const bucket = getVendorCaseBucket(record);

  return {
    caseId: record.Id || null,
    caseNumber: record.CaseNumber || null,
    salesforceUrl: record.Id
      ? `${instanceUrl}/lightning/r/Case/${record.Id}/view`
      : null,
    status: record.Status || null,
    substatus: record.Substatus__c || null,
    trackedStatus: bucket,
    isTrackedStatus: bucket !== "other",
    type: record.Type || null,
    createdDate: formatDateForPublic(record.CreatedDate),
    createdDateIso: toIsoDateOrNull(record.CreatedDate),
    caseOwner: {
      id: record.OwnerId || null,
      name: record.Owner?.Name || null,
      isVendorOwner: record.OwnerId === vendorSalesforceId,
    },
    reasons: reasons.fields,
    activeReasons: reasons.active,
  };
}

async function getVendorAssignedSalesforceCases(vendorId) {
  const parsedVendorId = Number(vendorId);
  if (!Number.isInteger(parsedVendorId) || parsedVendorId <= 0) {
    const error = new Error("Valid vendor id is required");
    error.status = 400;
    throw error;
  }

  const vendor = await Vendor.findByPk(parsedVendorId, {
    attributes: [
      "id",
      "salesforce_id",
      "name",
      "contact_name",
      "email",
      "status",
    ],
  });

  if (!vendor) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const salesforceOwnerId = String(vendor.salesforce_id || "").trim();
  if (!salesforceOwnerId) {
    const error = new Error("Vendor has no Salesforce id");
    error.status = 409;
    throw error;
  }

  const sf = await authenticateSalesforce();
  const records = await runSoqlQueryAll(
    sf,
    buildVendorAssignedCasesQuery(salesforceOwnerId),
  );
  const statusSummary = buildVendorCaseStatusSummary(records);
  const cases = records.map((record) =>
    mapVendorAssignedCase(record, {
      instanceUrl: sf.instanceUrl,
      vendorSalesforceId: salesforceOwnerId,
    }),
  );

  return {
    vendor: {
      id: vendor.id,
      salesforceId: salesforceOwnerId,
      account: vendor.name,
      supplier: vendor.contact_name,
      email: vendor.email,
      status: vendor.status,
    },
    summary: {
      total: cases.length,
      window: {
        type: SALESFORCE_CASE_SNAPSHOT_WINDOW_TYPE,
        businessDays: SALESFORCE_CASE_SNAPSHOT_DAYS,
        field: "CreatedDate",
        startDate: toSalesforceDateTimeLiteral(getCaseSnapshotWindowStart()),
      },
      trackedStatuses: statusSummary.tracked,
      salesforceStatusCounts: statusSummary.byStatus,
      salesforceSubstatusCounts: statusSummary.bySubstatus,
    },
    cases,
  };
}

async function listVendors(filters = {}) {
  await ensureVendorClassificationTables();

  const where = {};
  const vendorWhere = {
    status: "active",
  };

  const categoryFilter = normalizeCategory(filters.category);
  if (categoryFilter) {
    where[Op.or] = [
      {
        category_source: CATEGORY_SOURCE.MANUAL,
        manual_category: categoryFilter,
      },
      {
        category_source: CATEGORY_SOURCE.AUTO,
        computed_category: categoryFilter,
      },
    ];
  }

  if (filters.supplierSegment) {
    vendorWhere.supplier_segment = filters.supplierSegment;
  }

  if (filters.search) {
    vendorWhere[Op.or] = [
      { name: { [Op.like]: `%${filters.search}%` } },
      { contact_name: { [Op.like]: `%${filters.search}%` } },
      { email: { [Op.like]: `%${filters.search}%` } },
    ];
  }

  const include = [
    buildVendorInfoInclude({ where: vendorWhere }),
    buildCaseSnapshotInclude(),
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
    {
      model: VendorTopReward,
      as: "topReward",
      required: false,
    },
  ];

  const rows = await VendorProfile.findAll({
    where,
    include,
    order: [
      ["performance_score", "DESC"],
      [{ model: Vendor, as: "vendorInfo" }, "name", "ASC"],
      ["id", "ASC"],
    ],
  });

  const isNewVendorFilter = parseOptionalBoolean(
    filters.isNewVendor ?? filters.newVendor,
  );
  const filteredRows =
    isNewVendorFilter === null
      ? rows
      : rows.filter((row) => {
          const metrics = row.metrics_json || {};
          return (
            Boolean(metrics.vendorFreshness?.isNewVendor) === isNewVendorFilter
          );
        });

  const shouldFetchLiveMetrics =
    parseOptionalBoolean(filters.liveMetrics ?? filters.live) === true;
  let liveSnapshotsByOwnerId = new Map();
  if (shouldFetchLiveMetrics) {
    try {
      const liveRows = await fetchSalesforceCaseSnapshots(
        filteredRows.map((row) => row.salesforce_user_id),
      );
      liveSnapshotsByOwnerId = groupSalesforceCaseSnapshotsByOwnerId(liveRows);
    } catch (error) {
      logger.warn(
        `VendorClassificationService → listVendors() live Salesforce metrics fallback: ${error.message}`,
      );
    }
  }

  const vendorIds = filteredRows.map((row) => Number(row.id)).filter(Boolean);
  const goalWeekStartDates = getRecentGoalWeekStartDates();
  const weeklyGoalRows = vendorIds.length
    ? await VendorWeeklyGoal.findAll({
        where: {
          vendor_id: {
            [Op.in]: vendorIds,
          },
          week_start: {
            [Op.in]: goalWeekStartDates,
          },
        },
        attributes: [
          "id",
          "vendor_id",
          "product_id",
          "week_start",
          "week_end",
          "weekly_target",
          "actual_inflow",
          "actual_outflow",
          "goal_met",
          "updated_at",
        ],
        include: [
          {
            model: Product,
            as: "product",
            attributes: ["id", "name"],
            required: false,
          },
        ],
        order: [
          ["vendor_id", "ASC"],
          ["product_id", "ASC"],
          ["week_start", "DESC"],
        ],
      })
    : [];
  const goalOverviewMap = buildGoalOverviewMap(weeklyGoalRows);

  const items = filteredRows.map((row) => {
    const metricsOverride = buildMetricsOverrideFromLiveSnapshots(
      row,
      liveSnapshotsByOwnerId.get(String(row.salesforce_user_id || "").trim()) ||
        [],
    );
    const vendor = toPublicVendor(row, { metricsOverride });
    const performance = buildPerformancePayload(vendor);
    const goalOverview =
      goalOverviewMap.get(Number(row.id)) || getDefaultGoalOverview();

    return {
      vendor: toVendorBase(vendor),
      analytics: buildListAnalyticsPayload(performance),
      performance,
      category: buildCategoryPayload(vendor),
      inflow: buildInflowPayload(vendor),
      assignments: buildAssignmentsPayload(vendor),
      goalStats: goalOverview.summary,
      goals: {
        weekStarts: goalWeekStartDates.map(formatDateForPublic),
        byTort: goalOverview.byTort,
        compensation: goalOverview.compensation,
      },
      rewards: toPublicRewards(row.topReward || null),
    };
  });
  const activeCount = items.filter((item) => item.vendor.active).length;

  const categoryCount = {
    new_vendor: 0,
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
      metricsSource: shouldFetchLiveMetrics ? "salesforce_live" : "local_cache",
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

  const previousCategory =
    profile.category_source === CATEGORY_SOURCE.MANUAL &&
    profile.manual_category
      ? profile.manual_category
      : profile.computed_category;

  await profile.update({
    category_source: CATEGORY_SOURCE.MANUAL,
    manual_category: category,
  });

  if (previousCategory !== category) {
    await VendorCategoryLog.create({
      vendor_id: profile.id,
      from_category: previousCategory || null,
      to_category: category,
      reason: "Manual category update",
      triggered_by: "manual",
    });
  }

  const refreshed = await VendorProfile.findByPk(vendorId, {
    include: [buildVendorInfoInclude({ required: false })],
  });

  return toPublicVendor(refreshed || profile);
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
  await ensureVendorClassificationTables();

  const row = await VendorProfile.findByPk(vendorId, {
    include: [
      buildVendorInfoInclude({ required: false }),
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
        where: {
          [Op.or]: [
            {
              case_created_at: {
                [Op.gte]: getLast90DaysStart(),
              },
            },
            {
              sent_date_2: {
                [Op.gte]: getLast90DaysStart(),
              },
            },
          ],
        },
        required: false,
        attributes: [
          "salesforce_case_id",
          "case_number",
          "product_id",
          "case_created_at",
          "signed_date",
          "sent_date_2",
          "outflow_validated",
          "sub_status",
        ],
        include: [
          {
            model: Product,
            as: "caseProduct",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        model: VendorWeeklyGoal,
        as: "weeklyGoals",
        separate: true,
        where: {
          week_start: {
            [Op.in]: getRecentGoalWeekStartDates(),
          },
        },
        order: [["week_start", "DESC"]],
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

  let caseRows = row.caseSnapshots || [];
  let metricsOverride = null;

  try {
    const liveCaseRows = await fetchSalesforceCaseSnapshots([
      row.salesforce_user_id,
    ]);
    if (Array.isArray(liveCaseRows) && liveCaseRows.length > 0) {
      const windowStart = getCaseSnapshotWindowStart();
      caseRows = liveCaseRows.filter(
        (snapshot) =>
          isSnapshotInsideCreatedDateWindow(snapshot, windowStart) ||
          isSnapshotInsideSentDateWindow(snapshot, windowStart),
      );
      metricsOverride = buildMetricsOverrideFromLiveSnapshots(
        row,
        liveCaseRows,
      );
    }
  } catch (error) {
    logger.warn(
      `VendorClassificationService → getVendorInsightsById() live Salesforce metrics fallback for vendor ${vendorId}: ${error.message}`,
    );
  }

  const vendor = toPublicVendor(row, { metricsOverride });
  const caseEntriesByTypeLast90Days = buildCaseEntriesByTypeMap(caseRows, {
    assignments: row.tortAssignments || [],
  });
  const goalOverview =
    buildGoalOverviewMap(row.weeklyGoals || []).get(Number(vendorId)) ||
    getDefaultGoalOverview();

  return buildVendorInsights(vendor, caseEntriesByTypeLast90Days, {
    weeklyGoals: row.weeklyGoals || [],
    topReward: row.topReward || null,
    categoryLogs: row.categoryLogs || [],
    goalStats: goalOverview.summary,
  });
}

async function updateVendorTopRewards(vendorId, payload = {}) {
  await ensureVendorClassificationTables();

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
      auto_intake: false,
      active: false,
    },
  });

  const selectedRewards = resolveRewardKeysFromPayload(payload);

  await reward.update(buildRewardUpdatePayload(selectedRewards));

  return {
    success: true,
    vendorId,
    rewards: toPublicRewards(reward).selected,
  };
}

async function resolveVendorForSalesforcePasswordReset(vendorId) {
  const parsedVendorId = Number(vendorId);
  if (!Number.isInteger(parsedVendorId) || parsedVendorId <= 0) {
    const error = new Error("Valid vendor id is required");
    error.status = 400;
    throw error;
  }

  const profile = await VendorProfile.findByPk(parsedVendorId, {
    include: [buildVendorInfoInclude({ required: false })],
  });

  if (profile) {
    const vendorInfo = getProfileVendorInfo(profile);
    return {
      profileId: profile.id,
      vendorTableId: vendorInfo?.id || null,
      salesforceUserId:
        String(
          profile.salesforce_user_id || vendorInfo?.salesforce_id || "",
        ).trim() || null,
      supplier: vendorInfo?.contact_name || profile.supplier || null,
      username: vendorInfo?.email || profile.username || null,
    };
  }

  const vendor = await Vendor.findByPk(parsedVendorId, {
    attributes: ["id", "salesforce_id", "contact_name", "email", "name"],
  });

  if (!vendor) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  return {
    profileId: null,
    vendorTableId: vendor.id,
    salesforceUserId: String(vendor.salesforce_id || "").trim() || null,
    supplier: vendor.contact_name || vendor.name || null,
    username: vendor.email || null,
  };
}

async function resetVendorSalesforcePassword(vendorId) {
  await ensureVendorClassificationTables();

  const vendor = await resolveVendorForSalesforcePasswordReset(vendorId);
  if (!vendor.salesforceUserId || !vendor.salesforceUserId.startsWith("005")) {
    const error = new Error("Vendor has no valid Salesforce User id");
    error.status = 409;
    throw error;
  }

  const sf = await authenticateSalesforce();
  const salesforceResponse = await resetSalesforceUserPassword(
    sf,
    vendor.salesforceUserId,
  );

  return {
    success: true,
    message: "Salesforce password reset requested",
    vendor,
    salesforce: {
      userId: vendor.salesforceUserId,
      response: salesforceResponse,
    },
  };
}

module.exports = {
  syncVendorsFromMysql,
  syncVendorsAndEvaluateRules,
  listVendors,
  getVendorInsightsById,
  getVendorAssignedSalesforceCases,
  setVendorCategory,
  assignVendorToTort,
  updateVendorTopRewards,
  resetVendorSalesforcePassword,
};
