function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildBardPortT2CaseQuery(caseNumber) {
  const safeCaseNumber = escapeSoqlString(caseNumber);

  return `
SELECT
  Lead__r.Id,
  Lead__r.CaseNumber,
  Lead__r.Email__c,
  Lead__r.Phone_Numbercontact__c,
  Lead__r.FirstName__c,
  Lead__r.Last_Name__c,
  Lead__r.Do_you_have_an_attorney__c,
  Lead__r.Receive_an_Implanted_Port_Catheter__c,
  Lead__r.Implanted_Port_Catheter_infection__c
FROM Lead_de_oportunidad__c
WHERE Oportunidad__r.AccountId = '001TR00000YhtYmYAJ'
  AND Lead__r.Status = 'Sent'
  AND Lead__r.Type = 'Bard Port'
  AND Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildBardPortT2CaseQuery,
};
