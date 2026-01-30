function buildMonitoringCasesQuery() {
  return `
SELECT 
  CreatedDate,
  CaseNumber,
  FullName__c,
  Phone_Numbercontact__c,
  Email__c,
  Status,
  Substatus__c,
  Type,
  Id,
  Supplier_Segment__c,
  Origin,
  OwnerId
FROM Case
WHERE Status = 'In Progress'
  AND Substatus__c IN (
    'Busy','Callback','Contract sent','Dead Air',
    'Docs pending','No Answer','On call','TCPA OK','VM'
  ) 
  AND Origin NOT IN ('Coreg','Coreg CPA','Aged Data')
  AND (
       (Supplier_Segment__c = 'High Quality' 
        AND CreatedDate >= LAST_N_DAYS:45 )
    OR (Supplier_Segment__c != 'High Quality' 
        AND CreatedDate >= LAST_N_DAYS:30 )
      )
`;
}

module.exports = {
  buildMonitoringCasesQuery,
};
