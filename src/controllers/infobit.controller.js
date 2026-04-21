const logger = require("../utils/logger");
const {
  InfobitService,
  sendBulkInfobitMessages,
  logMessageRecord,
  updateMessageStatus,
  saveInboundMessages,
  getMessageStatusByMessageId,
  getConversationHistoryByNumber,
  getConversationsSummary,
  getInboundNotifications,
  sendConversationMessage,
} = require("../services/infobit.service");

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.split(" ")[1];
}

function extractWebhookResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload)) return payload;
  if (payload?.result && typeof payload.result === "object") {
    return [payload.result];
  }

  return [];
}

async function sendInfobitBulkMessage(req, res, next) {
  logger.info("InfobitController → sendInfobitBulkMessage() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const result = await sendBulkInfobitMessages(req.body, token);

    logger.success("InfobitController → sendInfobitBulkMessage() success");
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → sendInfobitBulkMessage() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

//CREATE MESSAGE INFOBIT
async function sendInfobitMessage(req, res, next) {
  logger.info("InfobitController → sendInfobitMessage() called");
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const result = await InfobitService(req.body, token);

    logger.success(`InfobitController → sendInfobitMessage() success`);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → sendInfobitMessage() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

// LOG MESSAGE RECORDS
async function logMessageRecords(req, res, next) {
  logger.info("InfobitController → logMessageRecords() called");
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const result = await logMessageRecord(token);
    logger.success(`InfobitController → logMessageRecords() success`);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → logMessageRecords() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

// UPDATED MESSAGE STATUS
async function infobitStatusWebhook(req, res, next) {
  logger.info("InfobitController → status webhook");

  try {
    const results = extractWebhookResults(req.body);
    logger.info("InfobitController → status webhook payload", {
      received: results.length,
    });

    const result = await updateMessageStatus(results);

    return res.status(200).json(result);
  } catch (error) {
    logger.error("Status webhook error", error);
    next(error);
  }
}

async function getInfobitMessageStatus(req, res, next) {
  logger.info("InfobitController → getInfobitMessageStatus() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const { messageId } = req.params;
    const result = await getMessageStatusByMessageId(messageId, token);

    logger.success("InfobitController → getInfobitMessageStatus() success");
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitMessageStatus() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getInfobitConversations(req, res, next) {
  logger.info("InfobitController → getInfobitConversations() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const limit = Number(req.query.limit) || 100;
    const result = await getConversationsSummary(token, limit);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitConversations() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getInfobitConversationHistory(req, res, next) {
  logger.info("InfobitController → getInfobitConversationHistory() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
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
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getInfobitInboundNotifications(req, res, next) {
  logger.info("InfobitController → getInfobitInboundNotifications() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const sinceId = Number(req.query.sinceId) || 0;
    const limit = Number(req.query.limit) || 100;
    const result = await getInboundNotifications(token, sinceId, limit);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → getInfobitInboundNotifications() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function sendInfobitConversationMessage(req, res, next) {
  logger.info("InfobitController → sendInfobitConversationMessage() called");

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const { numberPhone } = req.params;
    const { message } = req.body;

    const result = await sendConversationMessage(numberPhone, message, token);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → sendInfobitConversationMessage() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

//METHOD TO SAVE INBOUND MESSAGES
async function infobitInboundWebhook(req, res, next) {
  logger.info("InfobitController → inbound webhook");

  try {
    const results = extractWebhookResults(req.body);
    logger.info("InfobitController → inbound webhook payload", {
      received: results.length,
    });

    const saved = await saveInboundMessages(results);

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

module.exports = {
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
};
