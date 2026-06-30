const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const vendorTableUpdateSchema = require("../schemas/vendorTableUpdate.schema");
const vendorTableBulkUpdateSchema = require("../schemas/vendorTableBulkUpdate.schema");
const vendorTableCreateSchema = require("../schemas/vendorTableCreate.schema");
const vendorTableStatusSchema = require("../schemas/vendorTableStatus.schema");
const {
  resetVendorPassword,
  getVendorSalesforceCases,
  getVendorsTable,
  getVendorTable,
  getVendorsCountries,
  createVendorTable,
  patchVendorTableStatus,
  patchVendorsTableBulk,
  patchVendorTableById,
  hardDeleteVendorTable,
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

// General vendor registry
router.get("/", getVendorsTable);
router.post("/", validate(vendorTableCreateSchema), createVendorTable);
router.get("/countries", getVendorsCountries);
router.patch(
  "/bulk",
  validate(vendorTableBulkUpdateSchema),
  patchVendorsTableBulk,
);

// Legacy aliases
router.get("/table", getVendorsTable);
router.get("/table/countries", getVendorsCountries);
router.get("/table/:vendorId/cases", getVendorSalesforceCases);
router.post("/table", validate(vendorTableCreateSchema), createVendorTable);
router.delete("/table/:vendorId/hard", hardDeleteVendorTable);
router.patch(
  "/table/:vendorId/status",
  validate(vendorTableStatusSchema),
  patchVendorTableStatus,
);
router.patch(
  "/table/bulk",
  validate(vendorTableBulkUpdateSchema),
  patchVendorsTableBulk,
);
router.patch(
  "/table/:vendorId",
  validate(vendorTableUpdateSchema),
  patchVendorTableById,
);

// General vendor item actions
router.get("/:vendorId", getVendorTable);
router.get("/:vendorId/cases", getVendorSalesforceCases);
router.post("/:vendorId/reset-password", resetVendorPassword);
router.delete("/:vendorId/hard", hardDeleteVendorTable);
router.patch(
  "/:vendorId/status",
  validate(vendorTableStatusSchema),
  patchVendorTableStatus,
);
router.patch(
  "/:vendorId",
  validate(vendorTableUpdateSchema),
  patchVendorTableById,
);

module.exports = router;
