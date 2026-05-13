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

/**
 * Builds a SOQL query for Disqualified cases.
 * Status = 'Closed', Substatus__c = 'Disqualified'
 * Includes Reason_for_DQ__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildDisqualifiedCasesQuery(date) {
  const { start, end } = buildClosedDateRange(date);

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
`;
}

/**
 * Builds a SOQL query for Rejected cases.
 * Status = 'Closed', Substatus__c = 'Reject'
 * Includes Reason_for_Doesn_t_meet_criteria__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildRejectedCasesQuery(date) {
  const { start, end } = buildClosedDateRange(date);

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
`;
}

/**
 * Builds a SOQL query for Signed cases via Sent_Date2__c.
 * Status = 'Sent', Substatus__c = 'Signed'
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildSignedCasesBySentDateQuery(date) {
  const { start, end } = buildClosedDateRange(date);

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
`;
}

//   AND Substatus__c = 'Signed'
/**
 * Builds a SOQL query for Signed cases via Start_Date__c.
 * Status = 'Sent', Substatus__c = 'Signed'
 * Note: Only used if Start_Date__c field exists in Salesforce.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildSignedCasesByStartDateQuery(date) {
  const { start, end } = buildClosedDateRange(date);

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
  AND Start_Date__c >= ${start}
`;
}

module.exports = {
  buildDisqualifiedCasesQuery,
  buildRejectedCasesQuery,
  buildSignedCasesBySentDateQuery,
  buildSignedCasesByStartDateQuery,
};
