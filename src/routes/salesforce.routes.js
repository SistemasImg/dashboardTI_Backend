const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const audienceExportSchema = require("../schemas/audienceExportSchema");
const {
  getRideshareReport,
} = require("../controllers/salesforce/rideshareReport.controller");
const {
  postAudienceExport,
} = require("../controllers/salesforce/audienceExport.controller");
const {
  getClosedCases,
} = require("../controllers/salesforce/closedCases.controller");
const {
  getClosedCasesVicidialExcel,
} = require("../controllers/salesforce/closedCasesExcel.controller");
const {
  upsertComment,
  deleteComment,
} = require("../controllers/salesforce/closedCasesComment.controller");
const closedCaseCommentSchema = require("../schemas/closedCaseComment.schema");

// All protected
router.use(authMiddleware);

router.get("/attempts/report", getRideshareReport);
router.post(
  "/audience/export",
  validate(audienceExportSchema),
  postAudienceExport,
);

// GET /salesforce/closed-cases?date=YYYY-MM-DD&type=disqualified|rejected|signed
router.get("/closed-cases", getClosedCases);
router.get("/closed-cases/excel", getClosedCasesVicidialExcel);
router.post(
  "/closed-cases/comment",
  validate(closedCaseCommentSchema),
  upsertComment,
);
router.delete("/closed-cases/comment/:caseNumber", deleteComment);

module.exports = router;
