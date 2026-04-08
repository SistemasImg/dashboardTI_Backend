const express = require("express");
const router = express.Router();

const { receiveMetaLead } = require("../controllers/meta/commets.controller");

// Meta webhook endpoint
router.post("/comments", receiveMetaLead);

module.exports = router;
