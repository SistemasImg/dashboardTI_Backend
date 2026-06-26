const express = require("express");
const {
  externalStaticBearer,
} = require("../middlewares/externalStaticBearer.middleware");
const {
  getCaseSubstatusByPhone,
} = require("../controllers/salesforce/externalCaseLookup.controller");

const router = express.Router();

router.use(externalStaticBearer);

router.get("/case-substatus", getCaseSubstatusByPhone);

module.exports = router;
