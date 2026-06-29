const express = require("express");
const {
  externalStaticBearer,
} = require("../middlewares/externalStaticBearer.middleware");
const {
  getCaseLookupByPhone,
} = require("../controllers/salesforce/externalCaseLookup.controller");

const router = express.Router();

router.use(externalStaticBearer);

router.get("/case-lookup", getCaseLookupByPhone);
router.get("/case-substatus", getCaseLookupByPhone);

module.exports = router;
