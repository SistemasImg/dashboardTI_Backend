/**
 * Queries for closed cases report filtered by ClosedDate.
 * Three report types: Disqualified, Rejected, and Signed.
 */

function buildClosedDateRange(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const toSoqlDateTime = (value) => value.toISOString().replace(".000", "");

  return {
    start: toSoqlDateTime(start),
    end: toSoqlDateTime(end),
  };
}

function escapeSoqlString(value) {
  return String(value).replaceAll("'", String.raw`\'`);
}

function buildOptionalCaseTypeFilter(caseType) {
  const normalized = String(caseType || "").trim();
  if (!normalized) return "";

  return `\n  AND Type = '${escapeSoqlString(normalized)}'`;
}

/**
 * Builds a SOQL query for Disqualified cases.
 * Status = 'Closed', Substatus__c = 'Disqualified'
 * Includes Reason_for_DQ__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildDisqualifiedCasesQuery(date, caseType) {
  const { start, end } = buildClosedDateRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c,
  Reason_for_DQ__c
FROM Case
WHERE Status = 'Closed'
  AND Substatus__c = 'Disqualified'
  AND ClosedDate >= ${start}
  AND ClosedDate < ${end}
${typeFilter}
`;
}

/**
 * Builds a SOQL query for Rejected cases.
 * Status = 'Closed', Substatus__c = 'Reject'
 * Includes Reason_for_Doesn_t_meet_criteria__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildRejectedCasesQuery(date, caseType) {
  const { start, end } = buildClosedDateRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c,
  Reason_for_Doesn_t_meet_criteria__c
FROM Case
WHERE Status = 'Closed'
  AND Substatus__c = 'Reject'
  AND ClosedDate >= ${start}
  AND ClosedDate < ${end}
${typeFilter}
`;
}

/**
 * Builds a SOQL query for Signed cases via Sent_Date2__c.
 * Status = 'Sent'
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildSignedCasesBySentDateQuery(date, caseType) {
  const { start, end } = buildClosedDateRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c
FROM Case
WHERE Status = 'Sent'
  AND Sent_Date2__c >= ${start}
  AND Sent_Date2__c < ${end}
${typeFilter}

`;
}

module.exports = {
  buildDisqualifiedCasesQuery,
  buildRejectedCasesQuery,
  buildSignedCasesBySentDateQuery,
};
