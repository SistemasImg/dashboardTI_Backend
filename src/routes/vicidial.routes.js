const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate");
const {
  getAllAgentsRealtime,
} = require("../controllers/vicidial/vicidialAgents.controller");
const {
  searchLeadByPhone,
} = require("../controllers/vicidial/vicidialLeadSearch.controller");
const {
  downloadRecordingProxy,
  downloadRecordingsBulk,
} = require("../controllers/vicidial/vicidialRecordingsDownload.controller");
const vicidialBulkDownloadSchema = require("../schemas/vicidialBulkDownload.schema");

router.get("/agents", getAllAgentsRealtime);
router.get("/leads/search", searchLeadByPhone);
router.get("/recordings/proxy", downloadRecordingProxy);
router.post(
  "/recordings/download-bulk",
  validate(vicidialBulkDownloadSchema),
  downloadRecordingsBulk,
);

module.exports = router;
