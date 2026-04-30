const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/authMiddleware");
const {
  chat,
  downloadExcel,
  getHistory,
  clearHistory,
} = require("./chatbot.controller.js");

// All chatbot endpoints are protected and require a valid JWT.
router.use(authMiddleware);

router.post("/", chat);
router.get("/download-excel/:fileName", downloadExcel);
router.get("/history", getHistory);
router.delete("/history", clearHistory);

module.exports = router;
