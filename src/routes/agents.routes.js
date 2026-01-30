const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allAgent } = require("../controllers/agents.controller");

// All protected
router.use(authMiddleware);

router.get("/all", allAgent);

module.exports = router;
