const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const {
  getVendorsAnalyticsSummary,
  getVendorsAnalyticsTrends,
  getVendorsAnalyticsVendors,
  getVendorsAnalyticsTypes,
  getVendorsAnalyticsCategoryHistory,
} = require("../controllers/vendor.controller");

router.use(authMiddleware);

// Vendor analytics reports
router.get("/summary", getVendorsAnalyticsSummary);
router.get("/trends", getVendorsAnalyticsTrends);
router.get("/vendors", getVendorsAnalyticsVendors);
router.get("/types", getVendorsAnalyticsTypes);
router.get("/category-history", getVendorsAnalyticsCategoryHistory);

module.exports = router;
