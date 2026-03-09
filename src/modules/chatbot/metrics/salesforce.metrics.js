const logger = require("../../../utils/logger");
const { normalizeDateRange } = require("../../../utils/dateNormalizer");

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

    console.log("SOQL Query:", soql);

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

exports.getCasesByStatus = async (status) => {
  try {
    logger.info(`Fetching cases with status: ${status}`);

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
      WHERE Status = '${status}'
      LIMIT 30
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

exports.getCasesByOrigin = async (origin) => {
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
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Origin = '${origin}'
      ORDER BY CreatedDate DESC
      LIMIT 30
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

exports.getCasesBySupplierSegment = async (segment) => {
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
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Supplier_Segment__c = '${segment}'
      ORDER BY CreatedDate DESC
      LIMIT 30
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

exports.getCasesBySubstatus = async (substatus) => {
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
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Substatus__c = '${substatus}'
      ORDER BY CreatedDate DESC
      LIMIT 30
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

exports.getCasesByType = async (type) => {
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
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Type = '${type}'
      ORDER BY CreatedDate DESC
      LIMIT 30
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

exports.getCasesGroupedByField = async (field, dateKeyword = null) => {
  try {
    const sf = await authenticateSalesforce();

    let dateFilter = "";
    if (dateKeyword) {
      dateFilter = `AND CreatedDate = ${dateKeyword}`;
    }

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
        ${field}
      FROM Case
      WHERE ${field} != null
      ${dateFilter}
      ORDER BY ${field}, CreatedDate DESC
      LIMIT 200
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch (error) {
    throw new Error("SF_GROUP_QUERY_FAILED");
  }
};

exports.getCasesByFilters = async (filters) => {
  try {
    const sf = await authenticateSalesforce();

    const conditions = [];

    if (filters.status) conditions.push(`Status = '${filters.status}'`);

    if (filters.origin) conditions.push(`Origin = '${filters.origin}'`);

    if (filters.segment)
      conditions.push(`Supplier_Segment__c = '${filters.segment}'`);

    if (filters.type) conditions.push(`Type = '${filters.type}'`);

    if (filters.substatus)
      conditions.push(`Substatus__c = '${filters.substatus}'`);

    if (filters.dateKeyword)
      conditions.push(`CreatedDate = ${filters.dateKeyword}`);

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
        Owner.Name,
        CreatedDate
      FROM Case
      ${whereClause}
      ORDER BY CreatedDate DESC
      LIMIT 30
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
