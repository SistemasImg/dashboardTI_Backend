function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildAdReachRideshareCaseQuery(caseNumber) {
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
  Lead__r.Do_you_have_an_attorney__c,
  Lead__r.Were_you_abused_in_an_Uber_or_Lyft_ride__c,
  Lead__r.Passenger_or_Driver__c,
  Lead__r.What_type_of_abuse_did_you_experience__c,
  Lead__r.Incident_Date__c,
  Lead__r.Have_a_Receipt__c,
  Lead__r.Is_there_a_police_report__c,
  Lead__r.Reported_to_any_of_the_following__c,
  Lead__r.When_was_the_abuse_reported__c,
  Lead__r.Abuse_Details__c,
  Lead__r.Trusted_Form__c,
  Lead__r.Landing_Page_URL__c,
  Lead__r.ip_address__c,
  Lead__r.Uber_or_Lyft__c,
  Lead__r.Gender__c,
  Lead__r.State_of_Incident__c,
  Lead__r.Additional_Notes__c,
  Lead__r.What_is_this_person_s_full_name__c,
  Lead__r.What_s_your_relationship_to_this_person__c,
  Lead__r.What_is_this_person_s_address__c,
  Lead__r.What_s_this_person_s_phone_number__c,
  Lead__r.Was_the_abuse_reported__c,
  Lead__r.When_did_you_tell_them__c,
  Lead__r.May_the_attorneys_contact_this_person__c,
  Lead__r.What_did_you_share_with_them__c,
  Lead__r.How_did_you_share_the_information__c,
  Lead__r.what_did_you_tell_them__c,
  Lead__r.Threaten_or_use_weapons_or_force__c,
  Oportunidad__r.Name,
  Oportunidad__r.AccountId,
  Lead__r.Status,
  Lead__r.Type
FROM Lead_de_oportunidad__c
WHERE Oportunidad__r.AccountId = '001TR00000pGZ66YAG'
  AND Lead__r.Status = 'Sent'
  AND Lead__r.Type = 'Rideshare'
  AND Lead__r.CaseNumber = '${safeCaseNumber}'
LIMIT 1
`;
}

module.exports = {
  buildAdReachRideshareCaseQuery,
};
