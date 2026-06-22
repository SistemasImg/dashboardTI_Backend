const { Op } = require("sequelize");
const FinanceInvoice = require("../../models/financeInvoice");
const logger = require("../../utils/logger");
const {
  FINANCE_INVOICE_CATALOGS,
} = require("../../constants/financeInvoice.constants");
const { isSapConfigured } = require("../sap/auth.service");
const {
  createSupplierInvoice,
  createSupplierInvoiceAttachment,
} = require("../sap/client.service");
const {
  buildSupplierInvoicePayload,
  buildSupplierInvoiceAttachmentPayload,
} = require("../sap/supplierInvoice.mapper");

async function ensureFinanceInvoiceTable() {
  await FinanceInvoice.sync();
}

function normalizeStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateOnly(value) {
  if (!value) return null;
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

function toPublicInvoice(row) {
  if (!row) return null;

  return {
    id: row.id,
    invoiceUuid: row.invoice_uuid,
    documentType: row.document_type,
    documentSeries: row.document_series,
    documentNumber: row.document_number,
    purchaseType: row.purchase_type,
    goodsServicesType: row.goods_services_type,
    identityDocumentType: row.identity_document_type,
    ruc: row.ruc,
    businessName: row.business_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    currencyType: row.currency_type,
    taxableBaseAmount:
      row.taxable_base_amount == null ? null : Number(row.taxable_base_amount),
    igvAmount: row.igv_amount == null ? null : Number(row.igv_amount),
    totalAmount: row.total_amount == null ? null : Number(row.total_amount),
    validateDetraction: Boolean(row.validate_detraction),
    detractionPercentage:
      row.detraction_percentage == null
        ? null
        : Number(row.detraction_percentage),
    detractionCode: row.detraction_code,
    detractionAmount:
      row.detraction_amount == null ? null : Number(row.detraction_amount),
    hasInvoicePdf: Boolean(row.pdf_file_name),
    invoicePdf: row.pdf_file_name
      ? {
          fileName: row.pdf_file_name,
          mimeType: row.pdf_mime_type,
          size: row.pdf_size_bytes,
        }
      : null,
    sapPayload: row.sap_payload,
    sapStatus: row.sap_status,
    sapDocumentId: row.sap_document_id,
    sapResponse: row.sap_response,
    sapError: row.sap_error,
    submittedByUserId: row.submitted_by_user_id,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildInvoicePdfRecord(pdfFile) {
  if (!pdfFile?.buffer?.length) return null;

  return {
    fileName: normalizeStringOrNull(pdfFile.originalname) || "invoice.pdf",
    mimeType: normalizeStringOrNull(pdfFile.mimetype) || "application/pdf",
    size: Number(pdfFile.size) || pdfFile.buffer.length,
    base64: pdfFile.buffer.toString("base64"),
  };
}

function extractSapDocumentId(response) {
  return (
    response?.d?.SupplierInvoice ||
    response?.d?.SupplierInvoiceDocument ||
    response?.SupplierInvoice ||
    response?.SupplierInvoiceDocument ||
    response?.documentId ||
    response?.id ||
    null
  );
}

function serializeError(error) {
  return error?.sapResponse
    ? JSON.stringify(error.sapResponse)
    : String(error?.message || error);
}

async function submitInvoiceRowToSap(row) {
  if (!isSapConfigured()) {
    return {
      submitted: false,
      status: row.sap_status,
      reason: "SAP integration is not configured",
    };
  }

  const invoice = toPublicInvoice(row);
  const sapPayload = buildSupplierInvoicePayload(invoice);
  const attachmentPayload = buildSupplierInvoiceAttachmentPayload(invoice);

  try {
    const invoiceResponse = await createSupplierInvoice(sapPayload);
    const sapDocumentId = extractSapDocumentId(invoiceResponse);
    let attachmentResponse = null;

    if (attachmentPayload) {
      attachmentResponse = await createSupplierInvoiceAttachment({
        sapDocumentId,
        attachment: attachmentPayload,
      });
    }

    await row.update({
      sap_payload: {
        invoice: sapPayload,
        attachment: attachmentPayload
          ? {
              fileName: attachmentPayload.fileName,
              mimeType: attachmentPayload.mimeType,
              size: attachmentPayload.size,
            }
          : null,
      },
      sap_status: "sent",
      sap_document_id: sapDocumentId,
      sap_response: {
        invoice: invoiceResponse,
        attachment: attachmentResponse,
      },
      sap_error: null,
    });

    logger.success(
      `FinanceInvoiceService -> submitInvoiceRowToSap() success | invoiceId: ${row.id}`,
    );

    return {
      submitted: true,
      status: "sent",
      sapDocumentId,
      sapResponse: {
        invoice: invoiceResponse,
        attachment: attachmentResponse,
      },
    };
  } catch (error) {
    await row.update({
      sap_payload: {
        invoice: sapPayload,
        attachment: attachmentPayload
          ? {
              fileName: attachmentPayload.fileName,
              mimeType: attachmentPayload.mimeType,
              size: attachmentPayload.size,
            }
          : null,
      },
      sap_status: "failed",
      sap_error: serializeError(error),
      sap_response: error?.sapResponse || null,
    });

    logger.error(
      `FinanceInvoiceService -> submitInvoiceRowToSap() error | invoiceId: ${row.id} | ${error.message}`,
      { stack: error.stack, origin: "service" },
    );

    return {
      submitted: false,
      status: "failed",
      error: error.message,
      sapResponse: error?.sapResponse || null,
    };
  }
}

async function createFinanceInvoice(
  payload,
  { submittedByUserId = null, invoicePdf = null } = {},
) {
  await ensureFinanceInvoiceTable();

  const invoicePdfRecord = buildInvoicePdfRecord(invoicePdf);

  const row = await FinanceInvoice.create({
    document_type: payload.documentType,
    document_series: normalizeStringOrNull(payload.documentSeries),
    document_number: normalizeStringOrNull(payload.documentNumber),
    purchase_type: payload.purchaseType,
    goods_services_type: payload.goodsServicesType,
    identity_document_type: payload.identityDocumentType,
    ruc: payload.ruc,
    business_name: normalizeStringOrNull(payload.businessName),
    issue_date: normalizeDateOnly(payload.issueDate),
    due_date: normalizeDateOnly(payload.dueDate),
    currency_type: payload.currencyType,
    taxable_base_amount: toNumberOrNull(payload.taxableBaseAmount),
    igv_amount: toNumberOrNull(payload.igvAmount),
    total_amount: toNumberOrNull(payload.totalAmount),
    validate_detraction: payload.validateDetraction,
    detraction_percentage: toNumberOrNull(payload.detractionPercentage) || 0,
    detraction_code: normalizeStringOrNull(payload.detractionCode) || "000",
    detraction_amount: toNumberOrNull(payload.detractionAmount) || 0,
    pdf_file_name: invoicePdfRecord?.fileName || null,
    pdf_mime_type: invoicePdfRecord?.mimeType || null,
    pdf_size_bytes: invoicePdfRecord?.size || null,
    pdf_base64: invoicePdfRecord?.base64 || null,
    sap_status: "pending",
    submitted_by_user_id: submittedByUserId,
  });

  const sapSync = await submitInvoiceRowToSap(row);

  await row.reload();

  return {
    invoice: toPublicInvoice(row),
    sapSync,
  };
}

async function listFinanceInvoices(query = {}) {
  await ensureFinanceInvoiceTable();

  const where = {};
  if (query.sapStatus) where.sap_status = query.sapStatus;
  if (query.documentType) where.document_type = query.documentType;
  if (query.purchaseType) where.purchase_type = query.purchaseType;
  if (query.ruc) where.ruc = String(query.ruc).trim();
  if (query.search) {
    const search = `%${String(query.search).trim()}%`;
    where[Op.or] = [
      { invoice_uuid: { [Op.like]: search } },
      { document_number: { [Op.like]: search } },
      { ruc: { [Op.like]: search } },
      { business_name: { [Op.like]: search } },
    ];
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const rows = await FinanceInvoice.findAll({
    where,
    limit,
    order: [
      ["created_at", "DESC"],
      ["id", "DESC"],
    ],
  });

  return {
    total: rows.length,
    invoices: rows.map(toPublicInvoice),
  };
}

function getFinanceInvoiceCatalogs() {
  return FINANCE_INVOICE_CATALOGS;
}

async function getFinanceInvoiceById(invoiceId) {
  await ensureFinanceInvoiceTable();

  const row = await FinanceInvoice.findByPk(invoiceId);
  if (!row) {
    const error = new Error("Finance invoice not found");
    error.status = 404;
    throw error;
  }

  return toPublicInvoice(row);
}

async function syncFinanceInvoiceToSap(invoiceId, { force = false } = {}) {
  await ensureFinanceInvoiceTable();

  if (!isSapConfigured()) {
    const error = new Error("SAP integration is not configured");
    error.status = 503;
    throw error;
  }

  const row = await FinanceInvoice.findByPk(invoiceId);
  if (!row) {
    const error = new Error("Finance invoice not found");
    error.status = 404;
    throw error;
  }

  if (row.sap_status === "sent" && !force) {
    const error = new Error(
      "Invoice was already sent to SAP. Use force=true to resend.",
    );
    error.status = 409;
    throw error;
  }

  await row.update({ sap_status: "pending", sap_error: null });
  const sapSync = await submitInvoiceRowToSap(row);
  await row.reload();

  return {
    invoice: toPublicInvoice(row),
    sapSync,
  };
}

module.exports = {
  createFinanceInvoice,
  listFinanceInvoices,
  getFinanceInvoiceById,
  syncFinanceInvoiceToSap,
  getFinanceInvoiceCatalogs,
};
