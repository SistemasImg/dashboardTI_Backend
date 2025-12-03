const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

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

router.post("/landingCreate", createTestLanding);
router.post("/didCreate", createTestDid);
router.get("/landingGet", getTestLanding);
router.get("/didGet", getTestDid);
router.put("/landingUpdate/:id", updateTestLanding);
router.put("/didUpdate/:id", updateTestDid);

module.exports = router;
