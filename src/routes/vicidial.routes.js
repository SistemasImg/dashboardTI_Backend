const express = require("express");
const router = express.Router();
const {
  getAllAgentsRealtime,
} = require("../controllers/vicidial/vicidialAgents.controller");

const {
  getRealtime,
} = require("../controllers/vicidial/vicidialRealtime.controller");

router.get("/agents/realtime", getRealtime);

router.get("/agents", getAllAgentsRealtime);

module.exports = router;
