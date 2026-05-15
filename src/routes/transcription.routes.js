const express = require("express");
const router = express.Router();

const {
  createTranscriptionJob,
  getTranscriptionJobDetail,
  getRecordingsStatus,
} = require("../controllers/transcription.controller");

router.post("/", createTranscriptionJob);
router.post("/recordings/status", getRecordingsStatus);
router.get("/:id", getTranscriptionJobDetail);

module.exports = router;
