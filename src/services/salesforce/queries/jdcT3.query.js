function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildJdcT3CaseQuery(caseNumber) {
  const safeCaseNumber = escapeSoqlString(caseNumber);

  return `
SELECT
  Lead__r.Id,
  Lead__r.CaseNumber,
  Lead__r.Email__c,
  Lead__r.Phone_Numbercontact__c,
  Lead__r.FirstName__c,
  Lead__r.Last_Name__c,
  Lead__r.Address_Street__c,
  Lead__r.City__c,
  Lead__r.StateUS__c,
  Lead__r.Area_Code__c,
  Lead__r.Date_of_Birth__c,
  Lead__r.Date_of_Death__c,
  Lead__r.Signer_SSN__c,
  Lead__r.Signer_Last_4_SSN__c,
  Lead__r.VictimName__c,
  Lead__r.VictimLName__c,
  Lead__r.Victim_Mailing_Address__c,
  Lead__r.Victim_City__c,
  Lead__r.Victim_State__c,
  Lead__r.Victim_Zipcode__c,
  Lead__r.Relationship_to_the_victim__c,
  Lead__r.Perpetrator_Name__c,
  Lead__r.Perpetrator_Title__c,
  Lead__r.Juvenile_Detention_Center_Name__c,
  Lead__r.Reason_for_Detention__c,
  Lead__r.Date_of_Abuse__c,
  Lead__r.Abuse_Details__c,
  Lead__r.Was_the_abuse_reported__c,
  Lead__r.If_yes_who_was_the_abuse_reported_to__c,
  Lead__r.When_was_the_abuse_reported__c,
  Lead__r.Outcome_after_reporting_the_abuse__c,
  Lead__r.Issues_from_Abuse__c,
  Lead__r.Treatment_details__c,
  Lead__r.Emergency_Contact_Name__c,
  Lead__r.Relationship_to_Emergency_Contact__c,
  Lead__r.Emergency_Mailing_Address__c,
  Lead__r.Emergency_Contact_Phone_Number__c,
  Lead__r.Emergency_Contact_Email__c,
  Lead__r.Prison_ID__c,
  Oportunidad__r.Name,
  Oportunidad__r.AccountId,
  Lead__r.Status,
  Lead__r.Type
FROM Lead_de_oportunidad__c
WHERE Oportunidad__r.AccountId = '001TR00000fksnQYAQ'
  AND Lead__r.Status = 'Sent'
  AND Lead__r.Type = 'Juvenile Detention Center'
  AND Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildJdcT3CaseQuery,
};
