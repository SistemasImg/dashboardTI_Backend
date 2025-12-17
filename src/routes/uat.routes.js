const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const didUatSchema = require("../schemas/didUatSchema");
const landingUatSchema = require("../schemas/landingUatSchema");
const validate = require("../middlewares/validate");

const {
  createTestLanding,
  createTestDid,
  getTestLanding,
  getTestDid,
  updateTestLanding,
  updateTestDid,
} = require("../controllers/uat.controller");

// All protected
router.use(authMiddleware);

router.post("/landingCreate", validate(landingUatSchema), createTestLanding);
router.post("/didCreate", validate(didUatSchema), createTestDid);
router.get("/landingGet", getTestLanding);
router.get("/didGet", getTestDid);
router.put("/landingUpdate/:id", updateTestLanding);
router.put("/didUpdate/:id", updateTestDid);

module.exports = router;
