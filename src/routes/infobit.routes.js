const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  sendInfobitConversationMessage,
  getInfobitConversations,
  getInfobitConversationHistory,
  getInfobitInboundBackfill,
  infobitEventsStream,
  infobitInboundWebhook,
} = require("../controllers/infobit.controller");

// Public webhook - Infobip posts here when a customer reply arrives
router.post("/inbound", infobitInboundWebhook);

// SSE stream auth supports query token for browser EventSource
router.get("/events", infobitEventsStream);

// Protected endpoints
router.use(authMiddleware);

// POST /infobit/conversations/:numberPhone/send - Send a message
router.post("/conversations/:numberPhone/send", sendInfobitConversationMessage);

// POST /infobit/conversations/send — Send same message to one or many numbers (numberPhones[])
router.post("/conversations/send", sendInfobitConversationMessage);

// GET /infobit/conversations - Summary list of all conversations
router.get("/conversations", getInfobitConversations);

// GET /infobit/conversations/:numberPhone/history - History for one specific number
router.get(
  "/conversations/:numberPhone/history",
  getInfobitConversationHistory,
);

// GET /infobit/inbound?sinceId=123&limit=200 — Backfill inbound notifications
router.get("/inbound", getInfobitInboundBackfill);

module.exports = router;
