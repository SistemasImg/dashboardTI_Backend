const express = require("express");
const router = express.Router();
const {
  getAllAgentsRealtime,
} = require("../controllers/vicidial/vicidialAgents.controller");

router.get("/agents", getAllAgentsRealtime);

module.exports = router;
