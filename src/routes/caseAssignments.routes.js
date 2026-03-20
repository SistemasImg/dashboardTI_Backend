const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  assignAgentToCase,
  activeAssignments,
  AllactiveAssignments,
} = require("../controllers/caseAssignments.controller");

// All protected
router.use(authMiddleware);

router.post("/agent", assignAgentToCase);
router.get("/cases", activeAssignments);
router.get("/", AllactiveAssignments);

module.exports = router;
