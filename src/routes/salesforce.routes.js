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

// All protected
router.use(authMiddleware);

router.get("/attempts/report", getRideshareReport);
router.post(
  "/audience/export",
  validate(audienceExportSchema),
  postAudienceExport,
);

module.exports = router;
