const logger = require("../../../utils/logger");

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
      SELECT Id, CaseNumber, Status, Substatus__c, Owner.Name, CreatedDate
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
      SELECT Id, CaseNumber, Status, Substatus__c
      FROM Case
      WHERE Status = '${status}'
      LIMIT 50
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
        WHERE CreatedDate >= ${startDate}
        AND CreatedDate <= ${endDate}
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
      WHERE Phone LIKE '%${cleanPhone}'
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
      WHERE ContactEmail LIKE '%${email}%'
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch (error) {
    throw new Error("SF_EMAIL_QUERY_FAILED");
  }
};
