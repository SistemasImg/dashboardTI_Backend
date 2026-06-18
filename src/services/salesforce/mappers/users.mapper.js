function mapUsersName(user) {
  if (!user?.Name) return null;

  const name = user.Name.trim();
  if (!name) return null;

  if (name === "International Media Group") {
    user.Name = "Marketing Digital";
  }

  return { id: user.Id, name: user.Name };
}

function mapSupplierAccount(user) {
  if (!user) return null;

  const supplierName = user.Contact?.Name?.trim();
  const accountName =
    user.Contact?.Account?.Name?.trim() ||
    user.Contact?.Parent_Account__r?.Name?.trim();

  if (!supplierName || !accountName) return null;

  return {
    id: user.Id,
    username: user.Username || null,
    account: accountName,
    supplier: supplierName,
    country: user.Contact?.Country__c || null,
    supplierSegment: user.Contact?.Supplier_segment__c || null,
    active: Boolean(user.IsActive),
    approvalAfter: user.Contact?.Approval_After__c || null,
  };
}

function mapDashboardVendor(user) {
  if (!user) return null;

  const contactName = String(user.Contact?.Name || "").trim();
  const vendorName = String(
    user.CompanyName ||
      user.Contact?.Account?.Name ||
      user.Contact?.Parent_Account__r?.Name ||
      "",
  ).trim();

  if (!contactName || !vendorName) return null;

  return {
    salesforceId: String(user.Id || "").trim(),
    name: vendorName,
    contactName,
    email: user.Username || null,
    country: user.Contact?.Country__c || null,
    status: user.IsActive ? "active" : "inactive",
  };
}

module.exports = {
  mapUsersName,
  mapSupplierAccount,
  mapDashboardVendor,
};
