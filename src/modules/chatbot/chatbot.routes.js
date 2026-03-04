const express = require("express");
const router = express.Router();
const { chat } = require("./chatbot.controller.js");

router.post("/", chat);

module.exports = router;
