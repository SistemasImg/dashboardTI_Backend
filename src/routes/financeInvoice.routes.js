const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const financeInvoiceUpload = require("../middlewares/financeInvoiceUpload.middleware");
const validate = require("../middlewares/validate");
const financeInvoiceCreateSchema = require("../schemas/financeInvoiceCreate.schema");
const financeInvoiceSapSyncSchema = require("../schemas/financeInvoiceSapSync.schema");
const {
  createInvoice,
  listInvoices,
  getInvoiceCatalogs,
  getInvoiceById,
  syncInvoiceToSap,
} = require("../controllers/financeInvoice.controller");

router.use(authMiddleware);

router.get("/", listInvoices);
router.get("/catalogs", getInvoiceCatalogs);
router.post(
  "/",
  financeInvoiceUpload.single("invoicePdf"),
  validate(financeInvoiceCreateSchema),
  createInvoice,
);
router.get("/:invoiceId", getInvoiceById);
router.post(
  "/:invoiceId/sap-sync",
  validate(financeInvoiceSapSyncSchema),
  syncInvoiceToSap,
);

module.exports = router;
