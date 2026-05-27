function buildUsersQuery() {
  return `
    SELECT
      Id,
      Name
    FROM User
WHERE Contact.Name <> Null and Contact.Parent_Account__r.Name <> Null
  `;
}

function buildSupplierAccountsQuery() {
  return `
    SELECT
      Id,
      Username,
      IsActive,
      Contact.Name,
      Contact.Parent_Account__r.Name,
      Contact.Country__c,
      Contact.Supplier_segment__c,
      Contact.Approval_After__c
    FROM User
    WHERE Contact.Name <> Null AND Contact.Parent_Account__r.Name <> Null 
  `;
}

module.exports = {
  buildUsersQuery,
  buildSupplierAccountsQuery,
};
