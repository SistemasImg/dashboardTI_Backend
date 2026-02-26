const express = require("express");
const router = express.Router();
const {
  handleCaseUpdate,
} = require("../../controllers/ghl/salesforce/substatusUpdated");

router.post("/", handleCaseUpdate);

module.exports = router;
