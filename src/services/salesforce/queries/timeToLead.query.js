function buildTimeToLeadCasesQuery({ startDateTimeUtc, endDateTimeUtc }) {
  return `
SELECT
  Id,
  CreatedDate,
  CaseNumber,
  FullName__c,
  Phone_Numbercontact__c,
  Email__c,
  Status,
  Substatus__c,
  Reason_for_DQ__c,
  Reason_for_Doesn_t_meet_criteria__c,
  Reason_for_Spam__c,
  Sent_Date2__c,
  ethnicity__c,
  Origin,
  Type,
  Reason_for_Rejection__c,
  OwnerId,
  Owner.Name
FROM Case
WHERE CreatedDate >= ${startDateTimeUtc}
  AND CreatedDate < ${endDateTimeUtc}
  AND Status NOT IN ('Sent', 'Closed')
  AND (
    Substatus__c = null
    OR Substatus__c NOT IN (
      'Disqualified',
      'Do Not Call',
      'Test',
      'Returned to Supplier'
    )
  )
ORDER BY CreatedDate DESC
`;
}

function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value || "")
    .replaceAll(backslash, `${backslash}${backslash}`)
    .replaceAll("'", `${backslash}'`);
}

function buildCaseSubstatusHistoryQuery(caseIds = []) {
  const values = [...new Set(caseIds.filter(Boolean))]
    .map((caseId) => `'${escapeSoqlString(caseId)}'`)
    .join(", ");

  if (!values) return null;

  return `
SELECT
  CaseId,
  CreatedDate,
  Field,
  OldValue,
  NewValue
FROM CaseHistory
WHERE CaseId IN (${values})
  AND Field IN ('Substatus', 'Substatus__c')
ORDER BY CaseId ASC, CreatedDate ASC
`;
}

module.exports = {
  buildTimeToLeadCasesQuery,
  buildCaseSubstatusHistoryQuery,
};
