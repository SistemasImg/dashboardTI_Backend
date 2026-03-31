const express = require("express");
const router = express.Router();

const {
  insertAgentTime,
} = require("../../controllers/sqlserver/insertApi.controller");

// No authMiddleware here
router.post("/insert", insertAgentTime);

module.exports = router;
