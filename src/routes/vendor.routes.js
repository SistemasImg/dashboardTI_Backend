const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const vendorCategorySchema = require("../schemas/vendorCategory.schema");
const vendorTortAssignmentSchema = require("../schemas/vendorTortAssignment.schema");
const vendorRewardSchema = require("../schemas/vendorReward.schema");
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
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

router.post("/sync", syncVendors);
router.post("/category-rules/run", runVendorCategoryRules);
router.get("/analytics/summary", getVendorsAnalyticsSummary);
router.get("/analytics/trends", getVendorsAnalyticsTrends);
router.get("/analytics/vendors", getVendorsAnalyticsVendors);
router.get("/analytics/types", getVendorsAnalyticsTypes);
router.get("/analytics/category-history", getVendorsAnalyticsCategoryHistory);
router.get("/monitoring/summary", getVendorMonitoringSnapshot);
router.get("/monitoring/alerts", getVendorMonitoringAlertsFeed);
router.get("/monitoring/events", streamVendorMonitoringEvents);
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
