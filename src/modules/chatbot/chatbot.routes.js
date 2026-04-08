const express = require("express");
const router = express.Router();
const { chat, downloadExcel } = require("./chatbot.controller.js");

router.post("/", chat);
router.get("/download-excel/:fileName", downloadExcel);

module.exports = router;
