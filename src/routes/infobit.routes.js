const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  sendInfobitMessage,
  sendInfobitBulkMessage,
  logMessageRecords,
  infobitStatusWebhook,
  infobitInboundWebhook,
  getInfobitMessageStatus,
  getInfobitConversations,
  getInfobitConversationHistory,
  getInfobitInboundNotifications,
  sendInfobitConversationMessage,
} = require("../controllers/infobit.controller");

// Public webhooks for Infobit callbacks
router.post("/status", infobitStatusWebhook);
router.post("/inbound", infobitInboundWebhook);

// Protected endpoints for frontend/internal usage
router.use(authMiddleware);
router.post("/send", sendInfobitMessage);
router.post("/send/bulk", sendInfobitBulkMessage);
router.get("/log", logMessageRecords);
router.get("/status/:messageId", getInfobitMessageStatus);
router.get("/conversations", getInfobitConversations);
router.get(
  "/conversations/:numberPhone/history",
  getInfobitConversationHistory,
);
router.post("/conversations/:numberPhone/send", sendInfobitConversationMessage);
router.get("/notifications/inbound", getInfobitInboundNotifications);

module.exports = router;
