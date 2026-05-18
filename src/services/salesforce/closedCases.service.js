const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("./auth.service");
const { runSoqlQuery } = require("./client.service");
const { buildUsersQuery } = require("./queries/user.query");
const {
  buildDisqualifiedCasesQuery,
  buildRejectedCasesQuery,
  buildSignedCasesBySentDateQuery,
  buildSignedCasesByStartDateQuery,
} = require("./queries/closedCases.query");
const {
  mapDisqualifiedCase,
  mapRejectedCase,
  mapSignedCase,
} = require("./mappers/closedCases.mapper");
const { mapUsersName } = require("./mappers/users.mapper");
const { getCommentsByCaseNumbers } = require("./closedCasesComment.service");
const {
  getWorkStatusByCaseNumbers,
  enrichCasesWithWorkStatus,
} = require("./closedCasesWorkStatus.service");

const VALID_TYPES = new Set(["disqualified", "rejected", "signed"]);
const DEFAULT_CASE_OWNER = "Marketing Digital";

/**
 * Returns closed cases filtered by date and report type.
 * @param {string} date      - ISO date (YYYY-MM-DD)
 * @param {string} reportType - 'disqualified' | 'rejected' | 'signed'
 * @param {string} [caseType] - Optional Salesforce Case.Type filter
 */
async function getClosedCasesReport(date, reportType, caseType) {
  if (!VALID_TYPES.has(reportType)) {
    throw Object.assign(new Error(`Invalid reportType: ${reportType}`), {
      statusCode: 400,
    });
  }

  logger.info(
    `ClosedCasesService → getClosedCasesReport() | date=${date} type=${reportType} caseType=${caseType || "(none)"}`,
  );

  const sf = await authenticateSalesforce();

  let caseRecords = [];
  let mapFn;

  if (reportType === "disqualified") {
    mapFn = mapDisqualifiedCase;
    caseRecords = await runSoqlQuery(
      sf,
      buildDisqualifiedCasesQuery(date, caseType),
    );
  } else if (reportType === "rejected") {
    mapFn = mapRejectedCase;
    caseRecords = await runSoqlQuery(
      sf,
      buildRejectedCasesQuery(date, caseType),
    );
  } else {
    // For signed: run both date field queries in parallel and deduplicate
    mapFn = mapSignedCase;
    const [recordsBySentDate, recordsByStartDate] = await Promise.all([
      runSoqlQuery(sf, buildSignedCasesBySentDateQuery(date, caseType)).catch(
        (err) => {
          logger.warn(
            `Signed query by Sent_Date2__c failed: ${err.message}, continuing with Start_Date__c only`,
          );
          return [];
        },
      ),
      runSoqlQuery(sf, buildSignedCasesByStartDateQuery(date, caseType)).catch(
        (err) => {
          logger.warn(
            `Signed query by Start_Date__c failed: ${err.message}, continuing with Sent_Date2__c only`,
          );
          return [];
        },
      ),
    ]);

    // Deduplicate by caseNumber (use Map to keep first occurrence)
    const dedupeMap = new Map();
    [...recordsBySentDate, ...recordsByStartDate].forEach((record) => {
      if (!dedupeMap.has(record.CaseNumber)) {
        dedupeMap.set(record.CaseNumber, record);
      }
    });
    caseRecords = Array.from(dedupeMap.values());
  }

  const userRecords = await runSoqlQuery(sf, buildUsersQuery());

  // Build owner id → name map
  const usersMap = new Map(
    userRecords
      .map(mapUsersName)
      .filter(Boolean)
      .map((u) => [u.id, u.name]),
  );

  const cases = caseRecords.map((record) =>
    mapFn(record, usersMap.get(record.OwnerId) ?? DEFAULT_CASE_OWNER),
  );

  const commentsMap = await getCommentsByCaseNumbers(
    cases.map((item) => item.caseNumber),
  );
  const workStatusMap = await getWorkStatusByCaseNumbers(
    cases.map((item) => item.caseNumber),
  );

  const casesWithComment = cases.map((item) => ({
    ...item,
    comment: commentsMap.get(item.caseNumber) ?? null,
  }));
  const enrichedCases = enrichCasesWithWorkStatus(
    casesWithComment,
    workStatusMap,
  );

  logger.success(
    `ClosedCasesService → getClosedCasesReport() | total=${enrichedCases.length}`,
  );

  return {
    total: enrichedCases.length,
    reportType,
    caseType: caseType || null,
    date,
    cases: enrichedCases,
  };
}

module.exports = { getClosedCasesReport };
