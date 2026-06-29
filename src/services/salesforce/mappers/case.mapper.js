const { DateTime } = require("luxon");

const SALESFORCE_DISPLAY_TIMEZONE =
  process.env.SALESFORCE_TIMEZONE || "America/Los_Angeles";

function formatSalesforceDateTime(value) {
  if (!value) return null;

  const parsed = DateTime.fromISO(String(value), { setZone: true });
  return parsed.isValid
    ? parsed
        .setZone(SALESFORCE_DISPLAY_TIMEZONE)
        .toFormat("dd/MM/yyyy HH:mm:ss")
    : value;
}

function normalizeOperationalFlowTier(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return value ?? null;
  }

  if (/^T\d+$/i.test(normalized)) {
    return `T${normalized.slice(1)}`;
  }

  if (/^\d+$/.test(normalized)) {
    return `T${normalized}`;
  }

  return normalized;
}

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
    tier: record.Tier__c,
    supplierSegment: record.Supplier_Segment__c,
    substatus: record.Substatus__c,
    reasonForCallback: record.Reason_for_Callback__c,
    createdDate: formatSalesforceDateTime(record.CreatedDate),
  };
}

function mapOperationalFlowCase(record, ownerName = null) {
  return {
    caseNumber: record.CaseNumber ?? null,
    caseId: record.Id ?? null,
    ownerId: record.OwnerId ?? null,
    ownerName: ownerName ?? record.Owner?.Name ?? null,
    origin: record.Origin ?? null,
    fullName: record.FullName__c ?? null,
    phoneNumber: record.Phone_Numbercontact__c ?? null,
    email: record.Email__c ?? null,
    status: record.Status ?? null,
    substatus: record.Substatus__c ?? null,
    type: record.Type ?? null,
    tier: normalizeOperationalFlowTier(record.Tier__c),
    supplierSegment: record.Supplier_Segment__c ?? null,
    reasonForCallback: record.Reason_for_Callback__c ?? null,
    createdDate: record.CreatedDate ?? null,
    sentDate: record.Sent_Date2__c ?? null,
  };
}

module.exports = {
  mapMonitoringCase,
  mapOperationalFlowCase,
};
