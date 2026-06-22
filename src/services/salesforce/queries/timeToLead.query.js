function buildTimeToLeadCasesQuery({ startDateTimeUtc, endDateTimeUtc }) {
  return `
SELECT
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
ORDER BY CreatedDate DESC
`;
}

module.exports = {
  buildTimeToLeadCasesQuery,
};
