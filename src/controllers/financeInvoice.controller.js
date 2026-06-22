const logger = require("../utils/logger");
const {
  createFinanceInvoice,
  listFinanceInvoices,
  getFinanceInvoiceById,
  syncFinanceInvoiceToSap,
  getFinanceInvoiceCatalogs,
} = require("../services/finance/invoice.service");

async function createInvoice(req, res, next) {
  logger.info("FinanceInvoiceController -> createInvoice() called");

  try {
    const result = await createFinanceInvoice(req.body, {
      submittedByUserId: req.user?.id || null,
      invoicePdf: req.file || null,
    });

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    logger.error(
      `FinanceInvoiceController -> createInvoice() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function listInvoices(req, res, next) {
  logger.info("FinanceInvoiceController -> listInvoices() called");

  try {
    const result = await listFinanceInvoices(req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error(
      `FinanceInvoiceController -> listInvoices() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

function getInvoiceCatalogs(req, res) {
  logger.info("FinanceInvoiceController -> getInvoiceCatalogs() called");
  return res.status(200).json({
    success: true,
    data: getFinanceInvoiceCatalogs(),
  });
}

async function getInvoiceById(req, res, next) {
  logger.info("FinanceInvoiceController -> getInvoiceById() called");

  try {
    const result = await getFinanceInvoiceById(req.params.invoiceId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error(
      `FinanceInvoiceController -> getInvoiceById() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function syncInvoiceToSap(req, res, next) {
  logger.info("FinanceInvoiceController -> syncInvoiceToSap() called");

  try {
    const result = await syncFinanceInvoiceToSap(req.params.invoiceId, {
      force: req.body?.force === true,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error(
      `FinanceInvoiceController -> syncInvoiceToSap() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

module.exports = {
  createInvoice,
  listInvoices,
  getInvoiceCatalogs,
  getInvoiceById,
  syncInvoiceToSap,
};
