const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");
const {
  getRideshareReport,
} = require("../controllers/salesforce/rideshareReport.controller");

// All protected
router.use(authMiddleware);

router.get("/attempts/report", getRideshareReport);

module.exports = router;
