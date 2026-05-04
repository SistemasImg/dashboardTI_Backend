function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildT9RideshareCaseQuery(caseNumber) {
  const safeCaseNumber = escapeSoqlString(caseNumber);

  return `
SELECT
  Lead__r.Id,
  Lead__r.CaseNumber,
  Lead__r.Phone_Numbercontact__c,
  Lead__r.Email__c,
  Lead__r.FirstName__c,
  Lead__r.Last_Name__c,
  Lead__r.Address_Street__c,
  Lead__r.City__c,
  Lead__r.StateUS__c,
  Lead__r.Area_Code__c,
  Lead__r.Date_of_Birth__c,
  Lead__r.Incident_Date__c,
  Lead__r.Status,
  Lead__r.Type,
  Oportunidad__r.Name,
  Oportunidad__r.AccountId
FROM Lead_de_oportunidad__c
WHERE Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildT9RideshareCaseQuery,
};
