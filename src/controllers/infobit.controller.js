const logger = require("../utils/logger");
const { verifyAccessToken } = require("../utils/verifyAccessToken");
const {
  saveInboundMessages,
  getConversationHistoryByNumber,
  getConversationsSummary,
  getInboundNotifications,
  sendConversationMessage,
} = require("../services/infobit.service");

const sseClients = new Map();

function getAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  const queryToken = String(req.query.token || "").trim();
  return queryToken || null;
}

function verifyJwtToken(token) {
  return verifyAccessToken(token);
}

function canReceiveInboundEvent(clientUser, messageRow) {
  if (!clientUser || !messageRow) return false;

  const roleId = Number(clientUser.role_id);
  if (roleId === 4 || roleId === 5) {
    return Number(clientUser.id) === Number(messageRow.id_agent);
  }

  return true;
}

function toInboundEventPayload(messageRow) {
  return {
    eventId: Number(messageRow.id) || null,
    messageId: String(messageRow.messageId || ""),
    numberPhone: String(messageRow.numberphone || ""),
    conversationId: messageRow.conversationId || null,
    message: String(messageRow.message || ""),
    createdAt: messageRow.created_at
      ? new Date(messageRow.created_at).toISOString()
      : new Date().toISOString(),
    direction: "INBOUND",
    agentId: messageRow.id_agent ?? null,
  };
}

function sendSseEvent(res, eventName, payload, eventId) {
  if (eventId != null) {
    res.write(`id: ${eventId}\n`);
  }
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function publishInboundEvents(savedRows) {
  if (!Array.isArray(savedRows) || !savedRows.length || !sseClients.size) {
    return;
  }

  for (const rowRaw of savedRows) {
    const row = rowRaw?.dataValues || rowRaw;
    if (!row) continue;

    for (const client of sseClients.values()) {
      if (!canReceiveInboundEvent(client.user, row)) continue;

      const payload = toInboundEventPayload(row);
      sendSseEvent(client.res, "inbound_message", payload, payload.eventId);
    }
  }
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.split(" ")[1];
}

// Normalizes different Infobip webhook payload shapes into a flat message array
// consumed by saveInboundMessages().
function extractWebhookResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (
    payload?.type &&
    payload?.payload &&
    typeof payload.payload === "object"
  ) {
    return [payload.payload];
  }
  if (Array.isArray(payload?.events)) {
    return payload.events
      .map((event) =>
        event?.payload && typeof event.payload === "object"
          ? event.payload
          : event,
      )
      .filter(Boolean);
  }
  if (Array.isArray(payload)) return payload;
  if (payload?.result && typeof payload.result === "object") {
    return [payload.result];
  }

  return [];
}

function normalizeNumberList(input) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

// POST /conversations/:numberPhone/send - Send message via CCAAS (with optional SMS fallback)
async function sendInfobitConversationMessage(req, res, next) {
  logger.info("InfobitController → sendInfobitConversationMessage() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }

    const { numberPhone } = req.params;
    const { message, conversationId, agentId, strictCcaas } = req.body;
    const bodyNumbers = normalizeNumberList(
      req.body.numberPhones || req.body.numbers,
    );
    const targetNumbers = [
      ...new Set([numberPhone, ...bodyNumbers].filter(Boolean)),
    ];

    if (!targetNumbers.length) {
      return res.status(400).json({
        error: "At least one number is required in URL or numberPhones",
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Field message is required" });
    }

    const sendOptions = {
      conversationId,
      agentId,
      strictCcaas,
    };

    if (targetNumbers.length === 1) {
      const result = await sendConversationMessage(
        targetNumbers[0],
        message,
        token,
        sendOptions,
      );
      return res.json(result);
    }

    const results = await Promise.allSettled(
      targetNumbers.map((target) =>
        sendConversationMessage(target, message, token, sendOptions),
      ),
    );

    const items = results.map((item, index) => {
      const destination = targetNumbers[index];
      if (item.status === "fulfilled") {
        return {
          numberPhone: destination,
          ok: true,
          result: item.value,
        };
      }

      return {
        numberPhone: destination,
        ok: false,
        error: item.reason?.message || "Error sending message",
        status: item.reason?.status || 500,
      };
    });

    const successCount = items.filter((item) => item.ok).length;
    const failureCount = items.length - successCount;

    return res.status(failureCount ? 207 : 200).json({
      message: "Bulk send processed",
      total: items.length,
      successCount,
      failureCount,
      items,
    });
  } catch (error) {
    logger.error(
      `InfobitController → sendInfobitConversationMessage() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
        details: error.details,
      },
    );
    next(error);
  }
}

// GET /events - Server-Sent Events stream for inbound notifications
async function infobitEventsStream(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }

    let decoded;
    try {
      decoded = verifyJwtToken(token);
    } catch (error) {
      const message =
        error.name === "TokenVersionMismatchError"
          ? "Session expired due to deployment update"
          : "Invalid or expired token";
      return res.status(401).json({ error: message });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    res.write("retry: 5000\n\n");

    const clientId = `${decoded.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client = {
      id: clientId,
      user: decoded,
      res,
      heartbeat: setInterval(() => {
        res.write(": ping\n\n");
      }, 25000),
    };
    sseClients.set(clientId, client);

    sendSseEvent(
      res,
      "connected",
      {
        ok: true,
        clientId,
        serverTime: new Date().toISOString(),
      },
      null,
    );

    const lastEventId =
      Number(req.headers["last-event-id"] || req.query.sinceId) || 0;
    if (lastEventId > 0) {
      const missed = await getInboundNotifications(token, lastEventId, 200, {
        sync: false,
        onlyApiLinked: false,
      });

      for (const row of missed.notifications || []) {
        const payload = toInboundEventPayload(row);
        sendSseEvent(res, "inbound_message", payload, payload.eventId);
      }
    }

    req.on("close", () => {
      const current = sseClients.get(clientId);
      if (current?.heartbeat) {
        clearInterval(current.heartbeat);
      }
      sseClients.delete(clientId);
    });
  } catch (error) {
    next(error);
  }
}

// Webhook handler for inbound messages sent by Infobip.
// Flow:
// 1) Receive POST /infobit/inbound payload from Infobip.
// 2) Normalize payload shape with extractWebhookResults().
// 3) Persist inbound rows with saveInboundMessages().
// 4) Push real-time SSE notifications to connected clients.
async function infobitInboundWebhook(req, res, next) {
  logger.info("InfobitController → inbound webhook");

  try {
    logger.info("InfobitController → inbound webhook raw shape", {
      bodyKeys: Object.keys(req.body || {}),
      hasResultsArray: Array.isArray(req.body?.results),
      hasMessagesArray: Array.isArray(req.body?.messages),
      isArrayPayload: Array.isArray(req.body),
    });

    const results = extractWebhookResults(req.body);
    logger.info("InfobitController → inbound webhook payload", {
      received: results.length,
      firstMessageKeys:
        results.length && results[0] && typeof results[0] === "object"
          ? Object.keys(results[0])
          : [],
    });

    const saved = await saveInboundMessages(results);
    publishInboundEvents(saved);

    logger.info("InfobitController → inbound webhook persisted", {
      saved: saved.length,
    });

    return res
      .status(200)
      .json({ success: true, received: results.length, saved: saved.length });
  } catch (error) {
    logger.error("Inbound webhook error", error);
    next(error);
  }
}

// GET /inbound - Backfill inbound notifications after disconnect
async function getInfobitInboundBackfill(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }

    const sinceId = Number(req.query.sinceId) || 0;
    const limit = Number(req.query.limit) || 200;
    const result = await getInboundNotifications(token, sinceId, limit, {
      sync: false,
      onlyApiLinked: false,
    });

    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitInboundBackfill() error: ${error.message}`,
      {
        stack: error.stack,
      },
    );
    next(error);
  }
}

// GET /conversations - List all conversation summaries
async function getInfobitConversations(req, res, next) {
  logger.info("InfobitController → getInfobitConversations() called");
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }
    const limit = Number(req.query.limit) || 100;
    const result = await getConversationsSummary(token, limit);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitConversations() error: ${error.message}`,
      {
        stack: error.stack,
      },
    );
    next(error);
  }
}

// GET /conversations/:numberPhone/history - Get full history for one phone number
async function getInfobitConversationHistory(req, res, next) {
  logger.info("InfobitController → getInfobitConversationHistory() called");
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }
    const { numberPhone } = req.params;
    const limit = Number(req.query.limit) || 200;
    const result = await getConversationHistoryByNumber(
      numberPhone,
      token,
      limit,
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitConversationHistory() error: ${error.message}`,
      {
        stack: error.stack,
      },
    );
    next(error);
  }
}

module.exports = {
  sendInfobitConversationMessage,
  getInfobitConversations,
  getInfobitConversationHistory,
  getInfobitInboundBackfill,
  infobitEventsStream,
  infobitInboundWebhook,
};
