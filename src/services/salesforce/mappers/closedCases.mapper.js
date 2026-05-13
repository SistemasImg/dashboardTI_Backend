/**
 * Maps Salesforce Case records for the closed cases report.
 * Handles field differences across report types (Disqualified, Rejected, Signed).
 */

function mapDisqualifiedCase(record, ownerName) {
  return {
    supplier: record.Supplier_Segment__c ?? null,
    caseNumber: record.CaseNumber ?? null,
    caseOwner: ownerName ?? null,
    origin: record.Origin ?? null,
    fullName: record.FullName__c ?? null,
    phoneNumber: record.Phone_Numbercontact__c ?? null,
    substatus: record.Substatus__c ?? null,
    type: record.Type ?? null,
    tier: record.Tier__c ?? null,
    reasonForDQ: record.Reason_for_DQ__c ?? null,
  };
}

function mapRejectedCase(record, ownerName) {
  return {
    supplier: record.Supplier_Segment__c ?? null,
    caseNumber: record.CaseNumber ?? null,
    caseOwner: ownerName ?? null,
    origin: record.Origin ?? null,
    fullName: record.FullName__c ?? null,
    phoneNumber: record.Phone_Numbercontact__c ?? null,
    substatus: record.Substatus__c ?? null,
    type: record.Type ?? null,
    tier: record.Tier__c ?? null,
    reasonForReject: record.Reason_for_Doesn_t_meet_criteria__c ?? null,
  };
}

function mapSignedCase(record, ownerName) {
  return {
    supplier: record.Supplier_Segment__c ?? null,
    caseNumber: record.CaseNumber ?? null,
    caseOwner: ownerName ?? null,
    origin: record.Origin ?? null,
    fullName: record.FullName__c ?? null,
    phoneNumber: record.Phone_Numbercontact__c ?? null,
    substatus: record.Substatus__c ?? null,
    type: record.Type ?? null,
    tier: record.Tier__c ?? null,
  };
}

module.exports = {
  mapDisqualifiedCase,
  mapRejectedCase,
  mapSignedCase,
};
