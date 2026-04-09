const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/authMiddleware");

const {
  getAgentsAttempts,
} = require("../../controllers/sqlserver/queries.controller");

// All protected
router.use(authMiddleware);

router.get("/agents-attempts", getAgentsAttempts);

module.exports = router;
