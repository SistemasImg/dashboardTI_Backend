const logger = require("../../../utils/logger");
const { normalizeDateRange } = require("../../../utils/dateNormalizer");

function buildDateFilter(dateKeyword, date) {
  if (dateKeyword) return `AND CreatedDate = ${dateKeyword.toUpperCase()}`;
  if (date) return `AND CreatedDate = ${date}`;
  return "";
}

function normalizeOriginValue(origin) {
  if (!origin) return origin;

  const normalizedInput = origin.trim().toLowerCase();
  const originAliases = {
    campaign_p: "Campaign_p",
    campaing_p: "Campaign_p",
    campaign_k: "Campaign_k",
    campaing_k: "Campaign_k",
    transfer: "Transfer",
  };

  return originAliases[normalizedInput] || origin;
}

function escapeSoqlString(value) {
  return String(value || "").replaceAll("'", "\\'");
}

function normalizeSupplierSegmentValue(segment) {
  if (!segment) return segment;

  const normalized = String(segment).trim().toLowerCase();
  const aliases = {
    high: "High Quality",
    "high quality": "High Quality",
    highquality: "High Quality",
    "alta calidad": "High Quality",
    medium: "Medium",
    "medium quality": "Medium",
    media: "Medium",
    low: "Low Quality",
    "low quality": "Low Quality",
    baja: "Low Quality",
  };

  return aliases[normalized] || segment;
}

function normalizeTierValue(tier) {
  if (!tier) return tier;

  const raw = String(tier).trim();
  const normalized = raw.toLowerCase().replaceAll(/\s+/g, "");
  const match = normalized.match(/^tier(\d+)$/);

  if (match?.[1]) return match[1];
  return raw;
}

function normalizeDateKeywordValue(value) {
  if (!value) return null;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "today" || normalized === "hoy") return "TODAY";
  if (normalized === "yesterday" || normalized === "ayer") return "YESTERDAY";

  return null;
}

function buildVendorDateFilter({
  dateKeyword,
  date,
  startDate,
  endDate,
  period,
}) {
  const normalizedKeyword = normalizeDateKeywordValue(dateKeyword);
  if (normalizedKeyword) {
    return `AND CreatedDate = ${normalizedKeyword}`;
  }

  if (period === "last_month") {
    return "AND CreatedDate = LAST_N_DAYS:30";
  }

  if (date) {
    const { startUTC, endUTC } = normalizeDateRange(date, date);
    return `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  }

  if (startDate && endDate) {
    const { startUTC, endUTC } = normalizeDateRange(startDate, endDate);
    return `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  }

  return "";
}

function buildOwnerInClause(ownerIds = []) {
  const uniqueIds = [...new Set((ownerIds || []).filter(Boolean))];
  if (!uniqueIds.length) return "";

  const quoted = uniqueIds.map((id) => `'${escapeSoqlString(id)}'`).join(",");
  return `AND OwnerId IN (${quoted})`;
}

function buildIdInClause(ids = []) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return "";

  return uniqueIds.map((id) => `'${escapeSoqlString(id)}'`).join(",");
}

function getSalesforceErrorDetail(error) {
  const payload = error?.response?.data;
  if (Array.isArray(payload) && payload[0]?.message) {
    return payload[0].message;
  }

  if (typeof payload === "string") return payload;
  if (payload?.message) return payload.message;

  return error?.message || "Unknown Salesforce error";
}

async function getVendorNamesById(sf, ownerIds = []) {
  const idInClause = buildIdInClause(ownerIds);
  if (!idInClause) return new Map();

  const soql = `
    SELECT Id, Name
    FROM User
    WHERE Id IN (${idInClause})
  `;

  const result = await runSoqlQueryFull(sf, soql);
  const map = new Map();

  (result.records || []).forEach((row) => {
    map.set(row.Id, row.Name);
  });

  return map;
}

async function getPrimarySegmentByVendor(sf, filters = {}, ownerIds = []) {
  const dateFilter = buildVendorDateFilter(filters);
  const ownerFilter = buildOwnerInClause(ownerIds);

  const soql = `
    SELECT OwnerId, Supplier_Segment__c
    FROM Case
    WHERE OwnerId != null
    AND Supplier_Segment__c != null
    ${dateFilter}
    ${ownerFilter}
    ORDER BY CreatedDate DESC
  `;

  const result = await runSoqlQueryFull(sf, soql);
  const countsByOwner = new Map();

  (result.records || []).forEach((row) => {
    const ownerId = row.OwnerId;
    const segment = row.Supplier_Segment__c;
    if (!ownerId || !segment) return;

    if (!countsByOwner.has(ownerId)) {
      countsByOwner.set(ownerId, new Map());
    }

    const segmentMap = countsByOwner.get(ownerId);
    segmentMap.set(segment, (segmentMap.get(segment) || 0) + 1);
  });

  const primarySegmentByOwner = new Map();
  countsByOwner.forEach((segmentMap, ownerId) => {
    let bestSegment = "N/A";
    let bestCount = -1;

    segmentMap.forEach((count, segment) => {
      if (count > bestCount) {
        bestCount = count;
        bestSegment = segment;
      }
    });

    primarySegmentByOwner.set(ownerId, bestSegment);
  });

  return primarySegmentByOwner;
}

const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");

const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");

/**
 * Get Case by date keyword (TODAY / YESTERDAY)
 */
exports.getCaseByDate = async (dateKeyword) => {
  try {
    logger.info(`Fetching cases for: ${dateKeyword}`);

    const sf = await authenticateSalesforce();

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
        WHERE CreatedDate = ${dateKeyword}
        ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    logger.error(`Salesforce Case error: ${error.message}`);
    throw new Error("SF_CASE_QUERY_FAILED");
  }
};

exports.getCaseByNumber = async (caseNumber) => {
  try {
    logger.info(`Fetching case: ${caseNumber}`);

    const sf = await authenticateSalesforce();

    const soql = `
   SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE CaseNumber = '${caseNumber}'
      LIMIT 1
    `;

    const result = await runSoqlQueryFull(sf, soql);

    if (!result.records || !result.records.length) {
      logger.warn(`Case not found: ${caseNumber}`);
      return null;
    }

    logger.success(`Case ${caseNumber} retrieved`);

    return result.records[0];
  } catch (error) {
    logger.error(`Salesforce case query error: ${error.message}`);
    throw new Error("SF_CASE_QUERY_FAILED");
  }
};

exports.getCasesByStatus = async (status, dateKeyword = null, date = null) => {
  try {
    logger.info(`Fetching cases with status: ${status}`);

    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);

    const soql = `
   SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE Status = '${status}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    logger.success(`Cases retrieved: ${result.records.length}`);

    return result.records;
  } catch (error) {
    logger.error(`Salesforce status query error: ${error.message}`);
    throw new Error("SF_STATUS_QUERY_FAILED");
  }
};

exports.getCasesByDateRange = async (startDate, endDate) => {
  try {
    const sf = await authenticateSalesforce();
    const { startUTC, endUTC } = normalizeDateRange(startDate, endDate);

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
        ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_CASE_RANGE_FAILED");
  }
};

exports.getCaseByPhone = async (phone) => {
  try {
    const cleanPhone = phone.replace(/\D/g, "");

    const sf = await authenticateSalesforce();

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE Phone_Numbercontact__c LIKE '%${cleanPhone}'
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch (error) {
    throw new Error("SF_PHONE_QUERY_FAILED");
  }
};

exports.getCaseByEmail = async (email) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE Email__c LIKE '%${email}%'
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch (error) {
    throw new Error("SF_EMAIL_QUERY_FAILED");
  }
};

exports.getCasesByOrigin = async (origin, dateKeyword = null, date = null) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);
    const originValue = normalizeOriginValue(origin);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Origin = '${originValue}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_ORIGIN_QUERY_FAILED");
  }
};

exports.getCasesBySupplierSegment = async (
  segment,
  dateKeyword = null,
  date = null,
) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Supplier_Segment__c = '${segment}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_SEGMENT_QUERY_FAILED");
  }
};

exports.getCasesBySubstatus = async (
  substatus,
  dateKeyword = null,
  date = null,
) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);
    const includeDisqualificationReasons =
      String(substatus || "").toLowerCase() === "disqualified";
    const disqualificationFields = includeDisqualificationReasons
      ? `Reason_for_DQ__c,
        Reason_for_Doesn_t_meet_criteria__c,
        `
      : "";

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        ${disqualificationFields}
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Substatus__c = '${substatus}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_SUBSTATUS_QUERY_FAILED");
  }
};

exports.getCasesByType = async (type, dateKeyword = null, date = null) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Type = '${type}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_TYPE_QUERY_FAILED");
  }
};

const FIELD_MAP = {
  status: "Status",
  origin: "Origin",
  type: "Type",
  "supplier segment": "Supplier_Segment__c",
  supplier_segment__c: "Supplier_Segment__c",
  segment: "Supplier_Segment__c",
  substatus: "Substatus__c",
  substatus__c: "Substatus__c",
};

const GROUPED_FIELD_LABELS = {
  Status: "Status",
  Origin: "Origin",
  Type: "Type",
  Supplier_Segment__c: "Supplier Segment",
  Substatus__c: "Substatus",
};

exports.getCasesGroupedByField = async (field, dateKeyword = null) => {
  try {
    const sf = await authenticateSalesforce();

    const normalizedField = FIELD_MAP[field.toLowerCase()] || field;
    const ALLOWED_FIELDS = [
      "Status",
      "Origin",
      "Type",
      "Supplier_Segment__c",
      "Substatus__c",
    ];
    if (!ALLOWED_FIELDS.includes(normalizedField)) {
      throw new Error("SF_INVALID_GROUP_FIELD");
    }

    let dateFilter = "";
    if (dateKeyword) {
      dateFilter = `AND CreatedDate = ${dateKeyword.toUpperCase()}`;
    }

    const soql = `
      SELECT ${normalizedField}, COUNT(Id) cnt
      FROM Case
      WHERE ${normalizedField} != null
      ${dateFilter}
      GROUP BY ${normalizedField}
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    const groups = {};
    let total = 0;
    result.records.forEach((r) => {
      const val = r[normalizedField] || "N/A";
      groups[val] = r.cnt;
      total += r.cnt;
    });

    return {
      field: normalizedField,
      fieldLabel: GROUPED_FIELD_LABELS[normalizedField] || normalizedField,
      groups,
      total,
      dateScope: dateKeyword || "all",
    };
  } catch (error) {
    throw new Error("SF_GROUP_QUERY_FAILED");
  }
};

exports.getCasesByFilters = async (filters) => {
  try {
    const sf = await authenticateSalesforce();

    const conditions = [];
    const originValue = normalizeOriginValue(filters.origin);
    const tierValue = normalizeTierValue(filters.tier);
    const includeDisqualificationReasons =
      String(filters.substatus || "").toLowerCase() === "disqualified";
    const disqualificationFields = includeDisqualificationReasons
      ? `Reason_for_DQ__c,
        Reason_for_Doesn_t_meet_criteria__c,
        `
      : "";

    if (filters.status) conditions.push(`Status = '${filters.status}'`);
    if (originValue) conditions.push(`Origin = '${originValue}'`);
    if (filters.segment)
      conditions.push(`Supplier_Segment__c = '${filters.segment}'`);
    if (filters.type) {
      const typeVal =
        filters.type.toLowerCase() === "tort" ? "Tort" : filters.type;
      conditions.push(`Type = '${typeVal}'`);
    }
    if (filters.substatus)
      conditions.push(`Substatus__c = '${filters.substatus}'`);
    if (tierValue) conditions.push(`Tier__c = '${tierValue}'`);
    if (filters.agentName)
      conditions.push(`Owner.Name LIKE '%${filters.agentName}%'`);

    if (filters.dateKeyword) {
      conditions.push(`CreatedDate = ${filters.dateKeyword.toUpperCase()}`);
    } else if (filters.period === "last_month") {
      conditions.push("CreatedDate = LAST_N_DAYS:30");
    } else if (filters.date) {
      const { startUTC, endUTC } = normalizeDateRange(
        filters.date,
        filters.date,
      );
      conditions.push(`CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`);
    } else if (filters.startDate && filters.endDate) {
      const { startUTC, endUTC } = normalizeDateRange(
        filters.startDate,
        filters.endDate,
      );
      conditions.push(`CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`);
    } else {
      // Default scope for filtered case queries when no date is provided.
      conditions.push("CreatedDate = TODAY");
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        ${disqualificationFields}
        Type,
        Tier__c,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate
      FROM Case
      ${whereClause}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    throw new Error("SF_DYNAMIC_FILTER_FAILED");
  }
};

exports.getOperationalSummary = async (dateKeyword) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Origin,
        Supplier_Segment__c,
        Owner.Name
      FROM Case
      WHERE CreatedDate = ${dateKeyword}
      LIMIT 100
    `;

    const result = await runSoqlQueryFull(sf, soql);

    const records = result.records;

    const summary = {
      total: records.length,
      byStatus: {},
      byOrigin: {},
      bySegment: {},
    };

    records.forEach((c) => {
      summary.byStatus[c.Status] = (summary.byStatus[c.Status] || 0) + 1;

      summary.byOrigin[c.Origin] = (summary.byOrigin[c.Origin] || 0) + 1;

      summary.bySegment[c.Supplier_Segment__c] =
        (summary.bySegment[c.Supplier_Segment__c] || 0) + 1;
    });

    return {
      summary,
      sampleCases: records.slice(0, 10),
    };
  } catch (error) {
    throw new Error("SF_SUMMARY_FAILED");
  }
};

exports.getVendorsWithLeads = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const segmentByVendor = await getPrimarySegmentByVendor(
      sf,
      filters,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
      segment: segmentByVendor.get(item.vendorId) || "N/A",
    }));

    return {
      totalVendors: records.length,
      totalLeads: records.reduce((acc, item) => acc + item.totalLeads, 0),
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(
      `getVendorsWithLeads failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_VENDOR_QUERY_FAILED");
  }
};

exports.getTopVendors = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const sortMode = String(filters.sort || "highest").toLowerCase();
    const sortDirection = sortMode === "lowest" ? "ASC" : "DESC";
    const limit =
      Number.isInteger(filters.limit) && filters.limit > 0
        ? Math.min(filters.limit, 50)
        : 10;

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) ${sortDirection}
      LIMIT ${limit}
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const segmentByVendor = await getPrimarySegmentByVendor(
      sf,
      filters,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
      segment: segmentByVendor.get(item.vendorId) || "N/A",
    }));

    return {
      limit,
      sort: sortMode,
      totalVendors: records.length,
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(`getTopVendors failed: ${getSalesforceErrorDetail(error)}`);
    throw new Error("SF_TOP_VENDOR_QUERY_FAILED");
  }
};

exports.getVendorsBySupplierSegment = async (segment, filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const normalizedSegment = normalizeSupplierSegmentValue(segment);
    const escapedSegment = escapeSoqlString(normalizedSegment);

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      AND Supplier_Segment__c = '${escapedSegment}'
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      segment: normalizedSegment,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
    }));

    return {
      segment: normalizedSegment,
      totalVendors: records.length,
      totalLeads: records.reduce((acc, item) => acc + item.totalLeads, 0),
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(
      `getVendorsBySupplierSegment failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_VENDOR_SEGMENT_QUERY_FAILED");
  }
};

exports.getVendorCases = async (vendorName, filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const escapedVendorName = escapeSoqlString(String(vendorName || "").trim());

    const exactSoql = `
      SELECT
        Id,
        CaseNumber,
        Phone_Numbercontact__c,
        Supplier_Segment__c,
        OwnerId,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE OwnerId != null
      AND Owner.Name = '${escapedVendorName}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    let result = await runSoqlQueryFull(sf, exactSoql);

    if (!result.records?.length) {
      const fallbackSoql = `
        SELECT
          Id,
          CaseNumber,
          Phone_Numbercontact__c,
          Supplier_Segment__c,
          OwnerId,
          Owner.Name,
          CreatedDate
        FROM Case
        WHERE OwnerId != null
        AND Owner.Name LIKE '%${escapedVendorName}%'
        ${dateFilter}
        ORDER BY CreatedDate DESC
      `;

      result = await runSoqlQueryFull(sf, fallbackSoql);
    }

    const records = (result.records || []).map((row) => ({
      caseId: row.Id,
      caseNumber: row.CaseNumber,
      phone: row.Phone_Numbercontact__c,
      segment: row.Supplier_Segment__c || "N/A",
      vendorId: row.OwnerId,
      vendor: row.Owner?.Name || "Unknown",
      createdDate: row.CreatedDate,
    }));

    return {
      vendorName,
      totalCases: records.length,
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(`getVendorCases failed: ${getSalesforceErrorDetail(error)}`);
    throw new Error("SF_VENDOR_CASES_QUERY_FAILED");
  }
};

exports.getTopVendorsWithCaseDetails = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const ranking = await exports.getTopVendors(filters);

    if (!ranking?.records?.length) {
      return {
        ...ranking,
        totalCaseRows: 0,
        records: [],
      };
    }

    const ownerIds = ranking.records
      .map((item) => item.vendorId)
      .filter(Boolean);
    const ownerFilter = buildOwnerInClause(ownerIds);
    const dateFilter = buildVendorDateFilter(filters);

    const soql = `
      SELECT
        CaseNumber,
        Phone_Numbercontact__c,
        Supplier_Segment__c,
        OwnerId,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE OwnerId != null
      ${ownerFilter}
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const casesByVendorId = new Map();

    (result.records || []).forEach((row) => {
      const ownerId = row.OwnerId;
      if (!ownerId) return;

      if (!casesByVendorId.has(ownerId)) {
        casesByVendorId.set(ownerId, []);
      }

      casesByVendorId.get(ownerId).push({
        caseNumber: row.CaseNumber,
        phone: row.Phone_Numbercontact__c,
        segment: row.Supplier_Segment__c || "N/A",
        vendor: row.Owner?.Name || "Unknown",
        createdDate: row.CreatedDate,
      });
    });

    const enrichedRecords = ranking.records.map((vendorRow) => {
      const vendorCases = casesByVendorId.get(vendorRow.vendorId) || [];
      return {
        ...vendorRow,
        totalCases: vendorCases.length,
        cases: vendorCases,
      };
    });

    return {
      ...ranking,
      totalCaseRows: enrichedRecords.reduce(
        (sum, item) => sum + (item.totalCases || 0),
        0,
      ),
      records: enrichedRecords,
    };
  } catch (error) {
    logger.error(
      `getTopVendorsWithCaseDetails failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_TOP_VENDOR_CASE_DETAILS_FAILED");
  }
};

// Returns the disqualification reason fields for a case by CaseNumber.
// Assumes substatus Disqualified; no date restriction.
exports.getCaseDisqualificationReason = async (caseNumber) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT Id, CaseNumber, Status, Substatus__c,
             Reason_for_DQ__c, Reason_for_Doesn_t_meet_criteria__c,
             Owner.Name, CreatedDate
      FROM Case
      WHERE CaseNumber = '${caseNumber}'
      LIMIT 1
    `;

    const result = await runSoqlQueryFull(sf, soql);

    if (!result.records || result.records.length === 0) {
      return { found: false, caseNumber };
    }

    const rec = result.records[0];
    return {
      found: true,
      caseNumber: rec.CaseNumber,
      status: rec.Status,
      substatus: rec.Substatus__c,
      owner: rec.Owner?.Name || null,
      createdDate: rec.CreatedDate,
      reasonForDQ: rec.Reason_for_DQ__c || null,
      reasonDoesntMeetCriteria: rec.Reason_for_Doesn_t_meet_criteria__c || null,
    };
  } catch (error) {
    logger.error(
      `getCaseDisqualificationReason failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_DQ_REASON_FAILED");
  }
};
