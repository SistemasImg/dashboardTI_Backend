function mapMonitoringCase(record) {
  return {
    caseNumber: record.CaseNumber,
    caseId: record.Id,
    ownerId: record.OwnerId,
    origin: record.Origin,
    fullName: record.FullName__c,
    phoneNumber: record.Phone_Numbercontact__c,
    email: record.Email__c,
    type: record.Type,
    supplierSegment: record.Supplier_Segment__c,
    substatus: record.Substatus__c,
    createdDate: record.CreatedDate ? record.CreatedDate.split("T")[0] : null,
  };
}

module.exports = {
  mapMonitoringCase,
};
