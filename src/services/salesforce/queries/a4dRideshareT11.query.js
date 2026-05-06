function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildA4DRideshareT11CaseQuery(caseNumber) {
  const safeCaseNumber = escapeSoqlString(caseNumber);

  return `
SELECT
  Lead__r.Id,
  Lead__r.CaseNumber,
  Lead__r.FirstName__c,
  Lead__r.Last_Name__c,
  Lead__r.Phone_Numbercontact__c,
  Lead__r.Area_Code__c,
  Lead__r.Email__c,
  Lead__r.ip_address__c,
  Lead__r.What_describes_the_misconduct__c,
  Lead__r.Have_a_Receipt__c,
  Lead__r.Incident_Date__c,
  Lead__r.Were_you_abused_in_an_Uber_or_Lyft_ride__c,
  Lead__r.Reported_to_any_of_the_following__c,
  Lead__r.Abuse_Details__c,
  Lead__r.Landing_Page_URL__c,
  Lead__r.Trusted_Form__c
FROM Lead_de_oportunidad__c
WHERE Oportunidad__r.AccountId = '001TR00000LRBBNYA5'
  AND Lead__r.Substatus__c = 'Transferred'
  AND Lead__r.Type = 'Rideshare'
  AND Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildA4DRideshareT11CaseQuery,
};
