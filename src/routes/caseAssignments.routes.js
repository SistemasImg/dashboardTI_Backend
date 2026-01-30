const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  assignAgentToCase,
} = require("../controllers/caseAssignments.controller");

// All protected
router.use(authMiddleware);

router.post("/agent", assignAgentToCase);

module.exports = router;
