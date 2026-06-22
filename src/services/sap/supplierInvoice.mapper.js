function normalizeDate(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }

  return text.slice(0, 10);
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : undefined;
}

function removeEmptyValues(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function mapCurrencyType(currencyType) {
  const map = {
    1: "PEN",
    2: "USD",
  };
  return map[String(currencyType)] || String(currencyType || "");
}

function buildSupplierInvoicePayload(invoice) {
  return removeEmptyValues({
    DocumentDate: normalizeDate(invoice.issueDate),
    PostingDate: normalizeDate(invoice.issueDate),
    SupplierInvoiceIDByInvcgParty: `${invoice.documentSeries}-${invoice.documentNumber}`,
    InvoicingParty: invoice.ruc,
    DocumentCurrency: mapCurrencyType(invoice.currencyType),
    InvoiceGrossAmount: normalizeAmount(invoice.totalAmount),
    TaxIsCalculatedAutomatically: true,
    HeaderText: invoice.goodsServicesType,
    AssignmentReference: invoice.purchaseType,
    _source: {
      invoiceUuid: invoice.invoiceUuid,
      documentType: invoice.documentType,
      documentSeries: invoice.documentSeries,
      documentNumber: invoice.documentNumber,
      purchaseType: invoice.purchaseType,
      goodsServicesType: invoice.goodsServicesType,
      identityDocumentType: invoice.identityDocumentType,
      ruc: invoice.ruc,
      businessName: invoice.businessName,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currencyType: invoice.currencyType,
      taxableBaseAmount: invoice.taxableBaseAmount,
      igvAmount: invoice.igvAmount,
      totalAmount: invoice.totalAmount,
      validateDetraction: invoice.validateDetraction,
      detractionPercentage: invoice.detractionPercentage,
      detractionCode: invoice.detractionCode,
      detractionAmount: invoice.detractionAmount,
      hasInvoicePdf: Boolean(invoice.invoicePdf?.fileName),
    },
  });
}

function buildSupplierInvoiceAttachmentPayload(invoice) {
  if (!invoice?.invoicePdf?.fileName || !invoice?.invoicePdf?.base64) {
    return null;
  }

  return {
    fileName: invoice.invoicePdf.fileName,
    mimeType: invoice.invoicePdf.mimeType || "application/pdf",
    size: invoice.invoicePdf.size,
    base64: invoice.invoicePdf.base64,
  };
}

module.exports = {
  buildSupplierInvoicePayload,
  buildSupplierInvoiceAttachmentPayload,
};
