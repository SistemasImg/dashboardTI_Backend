const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/authMiddleware");

const {
  getAgentsAttempts,
  generateAgentsAttemptsExcelReport,
  downloadAgentsAttemptsExcel,
} = require("../../controllers/sqlserver/queries.controller");

// All protected
router.use(authMiddleware);

router.get("/agents-attempts", getAgentsAttempts);
router.get("/generate-excel", generateAgentsAttemptsExcelReport);
router.get("/download-agents-attempts/:fileName", downloadAgentsAttemptsExcel);

module.exports = router;
