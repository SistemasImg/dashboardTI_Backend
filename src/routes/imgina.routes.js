const express = require("express");
const { startImginaSmsSession } = require("../controllers/imgina.controller");

const router = express.Router();

router.post("/sms", startImginaSmsSession);

module.exports = router;
