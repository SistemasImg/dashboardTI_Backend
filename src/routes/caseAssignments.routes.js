const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  assignAgentToCase,
  activeAssignments,
} = require("../controllers/caseAssignments.controller");

// All protected
router.use(authMiddleware);

router.post("/agent", assignAgentToCase);
router.get("/cases", activeAssignments);

module.exports = router;
