function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildDepoProveraT8CaseQuery(caseNumber) {
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
  Lead__r.Used_Depo_Provera_for_at_least_1_year__c,
  Lead__r.Diagnosed_with_Meningioma__c
FROM Lead_de_oportunidad__c
WHERE Oportunidad__r.AccountId = '001TR00000YhtYmYAJ'
  AND Lead__r.Status = 'Sent'
  AND Lead__r.Type = 'Depo Provera'
  AND Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildDepoProveraT8CaseQuery,
};
