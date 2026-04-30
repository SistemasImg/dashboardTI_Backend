const express = require("express");
const { apiLimiter } = require("../config/rateLimiter.config");
const { submitRideshareLead } = require("../controllers/publicLead.controller");

const router = express.Router();

router.post("/rideshare", apiLimiter, submitRideshareLead);

module.exports = router;
