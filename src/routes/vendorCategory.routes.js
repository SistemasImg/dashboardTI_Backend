const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const vendorCategorySchema = require("../schemas/vendorCategory.schema");
const vendorTortAssignmentSchema = require("../schemas/vendorTortAssignment.schema");
const vendorRewardSchema = require("../schemas/vendorReward.schema");
const {
  getVendors,
  getVendorInsights,
  updateVendorCategory,
  upsertVendorTort,
  updateVendorRewards,
  runVendorCategoryRules,
  getVendorMonitoringSnapshot,
  getVendorMonitoringAlertsFeed,
  streamVendorMonitoringEvents,
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

// Category rules and monitoring
router.post("/rules/run", runVendorCategoryRules);
router.get("/monitoring/summary", getVendorMonitoringSnapshot);
router.get("/monitoring/alerts", getVendorMonitoringAlertsFeed);
router.get("/monitoring/events", streamVendorMonitoringEvents);

// Vendor category profiles
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
router.put(
  "/:vendorId/rewards",
  validate(vendorRewardSchema),
  updateVendorRewards,
);

module.exports = router;
