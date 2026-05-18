const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("./auth.service");
const { runSoqlQuery } = require("./client.service");
const { buildUsersQuery } = require("./queries/user.query");
const {
  buildDisqualifiedCasesQuery,
  buildRejectedCasesQuery,
  buildSignedCasesBySentDateQuery,
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
    // For signed: use Sent_Date2__c only
    mapFn = mapSignedCase;
    caseRecords = await runSoqlQuery(
      sf,
      buildSignedCasesBySentDateQuery(date, caseType),
    );
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
