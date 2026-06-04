const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const vendorCategorySchema = require("../schemas/vendorCategory.schema");
const vendorTortAssignmentSchema = require("../schemas/vendorTortAssignment.schema");
const vendorRewardSchema = require("../schemas/vendorReward.schema");
const vendorTableUpdateSchema = require("../schemas/vendorTableUpdate.schema");
const vendorTableBulkUpdateSchema = require("../schemas/vendorTableBulkUpdate.schema");
const vendorTableCreateSchema = require("../schemas/vendorTableCreate.schema");
const vendorTableStatusSchema = require("../schemas/vendorTableStatus.schema");
const {
  syncVendors,
  getVendors,
  getVendorInsights,
  updateVendorCategory,
  upsertVendorTort,
  updateVendorRewards,
  runVendorCategoryRules,
  getVendorMonitoringSnapshot,
  getVendorMonitoringAlertsFeed,
  streamVendorMonitoringEvents,
  getVendorsAnalyticsSummary,
  getVendorsAnalyticsTrends,
  getVendorsAnalyticsVendors,
  getVendorsAnalyticsTypes,
  getVendorsAnalyticsCategoryHistory,
  syncVendorsTable,
  getVendorsTable,
  getVendorsCountries,
  createVendorTable,
  patchVendorTableStatus,
  patchVendorsTableBulk,
  patchVendorTableById,
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

router.post("/sync", syncVendors);
router.post("/table/sync", syncVendorsTable);
router.post("/category-rules/run", runVendorCategoryRules);
router.get("/analytics/summary", getVendorsAnalyticsSummary);
router.get("/analytics/trends", getVendorsAnalyticsTrends);
router.get("/analytics/vendors", getVendorsAnalyticsVendors);
router.get("/analytics/types", getVendorsAnalyticsTypes);
router.get("/analytics/category-history", getVendorsAnalyticsCategoryHistory);
router.get("/monitoring/summary", getVendorMonitoringSnapshot);
router.get("/monitoring/alerts", getVendorMonitoringAlertsFeed);
router.get("/monitoring/events", streamVendorMonitoringEvents);
router.get("/table", getVendorsTable);
router.get("/table/countries", getVendorsCountries);
router.post("/table", validate(vendorTableCreateSchema), createVendorTable);
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
router.get("/", getVendors);
router.get("/:vendorId", getVendorInsights);
router.patch(
  "/:vendorId/category",
  validate(vendorCategorySchema),
  updateVendorCategory,
);
router.post(
  "/:vendorId/torts",
  validate(vendorTortAssignmentSchema),
  upsertVendorTort,
);
router.patch(
  "/:vendorId/rewards",
  validate(vendorRewardSchema),
  updateVendorRewards,
);

module.exports = router;
