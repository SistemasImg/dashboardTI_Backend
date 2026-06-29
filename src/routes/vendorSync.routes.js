const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const {
  patchSalesforceVendorsToMysql,
  patchSalesforceVendorCategoriesToMysql,
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

// Vendor sync and Salesforce admin
router.patch("/salesforce/vendors", patchSalesforceVendorsToMysql);
router.patch(
  "/salesforce/vendors-category",
  patchSalesforceVendorCategoriesToMysql,
);

module.exports = router;
