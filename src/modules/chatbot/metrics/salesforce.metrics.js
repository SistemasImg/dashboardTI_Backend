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

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
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
    if (filters.agentName)
      conditions.push(`Owner.Name LIKE '%${filters.agentName}%'`);

    if (filters.dateKeyword) {
      conditions.push(`CreatedDate = ${filters.dateKeyword.toUpperCase()}`);
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
        Type,
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
