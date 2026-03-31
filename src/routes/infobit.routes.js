const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  sendInfobitMessage,
  logMessageRecords,
  infobitStatusWebhook,
  infobitInboundWebhook,
} = require("../controllers/infobit.controller");

// All protected
router.use(authMiddleware);

router.post("/send", sendInfobitMessage);
router.get("/log", logMessageRecords);
router.post("/status", infobitStatusWebhook);
router.post("/inbound", infobitInboundWebhook);

module.exports = router;
