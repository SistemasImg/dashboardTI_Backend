function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "")
    return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

module.exports = {
  enabled: parseBoolean(process.env.SAP_ENABLED, false),
  dryRun: parseBoolean(process.env.SAP_DRY_RUN, false),
  baseUrl: process.env.SAP_BASE_URL,
  supplierInvoiceEndpoint:
    process.env.SAP_SUPPLIER_INVOICE_ENDPOINT ||
    "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice",
  supplierInvoiceAttachmentEndpoint:
    process.env.SAP_SUPPLIER_INVOICE_ATTACHMENT_ENDPOINT || null,
  authType: process.env.SAP_AUTH_TYPE || "basic",
  username: process.env.SAP_USERNAME,
  password: process.env.SAP_PASSWORD,
  clientId: process.env.SAP_CLIENT_ID,
  clientSecret: process.env.SAP_CLIENT_SECRET,
  tokenUrl: process.env.SAP_TOKEN_URL,
  csrfEnabled: parseBoolean(process.env.SAP_CSRF_ENABLED, true),
  timeoutMs: parseNumber(process.env.SAP_TIMEOUT_MS, 30000),
  rejectUnauthorized: parseBoolean(process.env.SAP_REJECT_UNAUTHORIZED, true),
};
