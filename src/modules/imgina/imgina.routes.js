const express = require("express");
const { startImginaSmsSession } = require("./imgina.controller");

const router = express.Router();

router.post("/sms", startImginaSmsSession);

module.exports = router;
