const axios = require("axios");
const https = require("node:https");
const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const { MessageRecords, User } = require("../models");
const { Op } = require("sequelize");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const INFOBIP_API_KEY =
  process.env.INFOBIP_API_KEY ||
  "App 95cd9e5ab9b979b42403ef6d8ff68464-c833e533-3301-4d55-84a1-92520cef9647";

const INFOBIP_HEADERS = {
  Authorization: INFOBIP_API_KEY,
  "Content-Type": "application/json",
};

const FINAL_GROUPS = ["DELIVERED", "UNDELIVERABLE", "REJECTED", "EXPIRED"];

function normalizeUsPhone(phone) {
  if (!phone) return "";

  const digits = String(phone).replaceAll(/\D/g, "");

  // US numbers can come as 10 digits or 11 with country code 1.
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  // Fallback for non-standard inputs: keep the last 10 digits.
  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return "";
}

function toConversationPhone(phone) {
  const normalized = normalizeUsPhone(phone);
  if (!normalized) return "";

  // Keep a canonical US local number key.
  if (normalized.length >= 10) {
    return normalized.slice(-10);
  }

  return normalized;
}

function buildPhoneVariants(phone) {
  const canonical = toConversationPhone(phone);
  if (!canonical) return [];

  return [canonical, `1${canonical}`, `+1${canonical}`];
}

async function resolveUserContext(user) {
  const decoded = jwt.verify(user, process.env.JWT_SECRET);
  const userId = decoded.id;
  const dbUser = await User.findByPk(userId, { raw: true });

  if (!dbUser) throw new Error("Usuario no encontrado");

  return { decoded, dbUser };
}

function parsePhoneList(numberPhonesInput) {
  if (Array.isArray(numberPhonesInput)) {
    return numberPhonesInput;
  }

  if (typeof numberPhonesInput === "string") {
    return numberPhonesInput
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

//CREATE MESSAGE INFOBIT
async function InfobitService(payload, user) {
  const { dbUser } = await resolveUserContext(user);
  logger.info("InfobitService → InfobitService() started");
  const { numberPhone, message } = payload;
  const normalizedPhone = toConversationPhone(numberPhone);

  console.log("InfobitService → normalizedPhone:", normalizedPhone);
  if (!normalizedPhone) {
    const error = new Error("Número de teléfono inválido");
    error.status = 400;
    throw error;
  }

  try {
    const { data } = await axios.post(
      "https://api.infobip.com/sms/3/messages",
      {
        messages: [
          {
            from: "+17576599670",
            destinations: [{ to: `+1${normalizedPhone}` }],
            content: {
              text: `${message}`,
            },
          },
        ],
      },
      {
        headers: INFOBIP_HEADERS,
        httpsAgent,
        timeout: 30000,
      },
    );
    logger.success("InfobitService → InfobitService() SUCCESS");
    const infoMessage = data.messages[0];
    const response = { bulkId: data.bulkId, ...infoMessage };
    await MessageRecords.create({
      numberphone: normalizedPhone,
      message,
      id_agent: dbUser.id || 1,
      bulkId: data.bulkId,
      messageId: response.messageId,
      groupName: response.status.groupName,
      status: response.status.name,
      description: response.status.description,
      groupId: response.status.groupId,
      id_extern: response.status.id,
      direction: "OUTBOUND",
    });

    logger.success("InfobitService → Message saved successfully");
    return response;
  } catch (error) {
    logger.error(
      "InfobitService → error",
      error.response?.data || error.message,
    );
    console.error(error);
    throw error;
  }
}

async function sendBulkInfobitMessages(payload, user) {
  const { dbUser } = await resolveUserContext(user);
  logger.info("InfobitService → sendBulkInfobitMessages() started");

  const { message } = payload;
  const rawPhones = parsePhoneList(
    payload.numberPhones || payload.numbers || payload.phones,
  );

  if (!rawPhones.length) {
    const error = new Error("Debe enviar al menos un número de teléfono");
    error.status = 400;
    throw error;
  }

  if (!message || !String(message).trim()) {
    const error = new Error("El mensaje es obligatorio");
    error.status = 400;
    throw error;
  }

  const normalizedPhones = [
    ...new Set(
      rawPhones.map((phone) => toConversationPhone(phone)).filter(Boolean),
    ),
  ];

  if (!normalizedPhones.length) {
    const error = new Error("No se encontraron números válidos");
    error.status = 400;
    throw error;
  }

  const destinations = normalizedPhones.map((phone) => ({
    to: `+1${phone}`,
  }));

  try {
    const { data } = await axios.post(
      "https://api.infobip.com/sms/3/messages",
      {
        messages: [
          {
            from: "+17576599670",
            destinations,
            content: {
              text: String(message),
            },
          },
        ],
      },
      {
        headers: INFOBIP_HEADERS,
        httpsAgent,
        timeout: 30000,
      },
    );

    const providerMessages = Array.isArray(data?.messages) ? data.messages : [];
    const persistedMessages = [];

    for (const item of providerMessages) {
      const normalizedDestination = toConversationPhone(item.destination);
      if (!normalizedDestination) continue;

      const currentStatus = item.status || {};

      const created = await MessageRecords.create({
        numberphone: normalizedDestination,
        message: String(message),
        id_agent: dbUser.id || 1,
        bulkId: data.bulkId,
        messageId: item.messageId,
        groupName: currentStatus.groupName || "UNKNOWN",
        status: currentStatus.name || "UNKNOWN",
        description: currentStatus.description || "No description",
        groupId: currentStatus.groupId ?? 0,
        id_extern: currentStatus.id ?? 0,
        direction: "OUTBOUND",
      });

      persistedMessages.push({
        id: created.id,
        numberphone: created.numberphone,
        messageId: created.messageId,
        status: created.status,
        description: created.description,
        groupName: created.groupName,
      });
    }

    logger.success("InfobitService → sendBulkInfobitMessages() SUCCESS", {
      requested: normalizedPhones.length,
      accepted: providerMessages.length,
    });

    return {
      bulkId: data.bulkId,
      requested: normalizedPhones.length,
      accepted: providerMessages.length,
      messages: providerMessages,
      persisted: persistedMessages,
    };
  } catch (error) {
    logger.error(
      "InfobitService → sendBulkInfobitMessages() error",
      error.response?.data || error.message,
    );
    throw error;
  }
}

// LOG MESSAGE RECORDS
async function logMessageRecord(user) {
  logger.info("InfobitService → logMessageRecord() started");
  await resolveUserContext(user);

  try {
    await syncPendingOutboundStatuses();
  } catch (error) {
    logger.warn(
      "InfobitService → logMessageRecord() sync warning",
      error.response?.data || error.message,
    );
  }

  const conversations = await getConversationsSummary(user, 1000);

  logger.success("InfobitService → logMessageRecord() OK");
  return conversations;
}

// UPDATED MESSAGE STATUS
async function updateMessageStatus(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return { success: true, updated: 0 };
  }

  let updated = 0;

  for (const item of results) {
    const [affectedRows] = await MessageRecords.update(
      {
        status: item.status.name,
        description: item.status.description,
        groupName: item.status.groupName,
        groupId: item.status.groupId,
        id_extern: item.status.id,
      },
      {
        where: { messageId: item.messageId },
      },
    );

    updated += affectedRows;
  }

  return { success: true, updated };
}

async function getMessageStatusByMessageId(messageId, user) {
  logger.info("InfobitService → getMessageStatusByMessageId() started");

  const { decoded, dbUser } = await resolveUserContext(user);

  const where = { messageId };

  if (decoded.role_id === 4 || decoded.role_id === 5) {
    where.id_agent = dbUser.id;
  }

  let record = await MessageRecords.findOne({
    where,
    raw: true,
  });

  if (!record) {
    const error = new Error("Mensaje no encontrado");
    error.status = 404;
    throw error;
  }

  if (record.direction === "OUTBOUND") {
    try {
      const refreshed = await syncStatusFromInfobip(record.messageId);

      if (refreshed) {
        await applyInfobipStatusToMessage(record.messageId, refreshed);

        record = await MessageRecords.findOne({
          where,
          raw: true,
        });
      }
    } catch (error) {
      logger.warn(
        "InfobitService → getMessageStatusByMessageId() sync warning",
        error.response?.data || error.message,
      );
    }
  }

  logger.success("InfobitService → getMessageStatusByMessageId() OK");
  return {
    messageId: record.messageId,
    bulkId: record.bulkId,
    status: record.status,
    description: record.description,
    groupName: record.groupName,
    groupId: record.groupId,
    id_extern: record.id_extern,
    updated_at: record.updated_at,
    direction: record.direction,
  };
}

async function syncStatusFromInfobip(messageId) {
  const { data } = await axios.get("https://api.infobip.com/sms/1/reports", {
    params: { messageId },
    headers: INFOBIP_HEADERS,
    httpsAgent,
    timeout: 30000,
  });

  if (!Array.isArray(data?.results) || data.results.length === 0) {
    return null;
  }

  return data.results[0];
}

async function applyInfobipStatusToMessage(messageId, report) {
  if (!report?.status) return 0;

  const [affectedRows] = await MessageRecords.update(
    {
      status: report.status.name,
      description: report.status.description,
      groupName: report.status.groupName,
      groupId: report.status.groupId,
      id_extern: report.status.id,
    },
    {
      where: { messageId },
    },
  );

  return affectedRows;
}

async function syncPendingOutboundStatuses(limit = 100) {
  const pendingMessages = await MessageRecords.findAll({
    where: {
      direction: "OUTBOUND",
      groupName: {
        [Op.notIn]: FINAL_GROUPS,
      },
    },
    attributes: ["messageId"],
    order: [["updated_at", "ASC"]],
    limit,
    raw: true,
  });

  if (!pendingMessages.length) {
    return { processed: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const row of pendingMessages) {
    try {
      const report = await syncStatusFromInfobip(row.messageId);
      if (!report) continue;

      updated += await applyInfobipStatusToMessage(row.messageId, report);
    } catch (error) {
      failed += 1;
      logger.warn("InfobitService → syncPendingOutboundStatuses() warning", {
        messageId: row.messageId,
        error: error.response?.data || error.message,
      });
    }
  }

  return {
    processed: pendingMessages.length,
    updated,
    failed,
  };
}

//METHOD TO SAVE INBOUND MESSAGES
async function saveInboundMessages(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const messages = [];

  for (const msg of results) {
    const fromPhone =
      msg.from ||
      msg.msisdn ||
      msg.source?.address ||
      msg.sender ||
      msg.originator;

    const normalizedPhone = toConversationPhone(fromPhone);

    if (!normalizedPhone) continue;

    const phoneVariants = buildPhoneVariants(normalizedPhone);

    const latestOutbound = await MessageRecords.findOne({
      where: {
        numberphone: {
          [Op.in]: phoneVariants,
        },
        direction: "OUTBOUND",
      },
      attributes: ["id_agent"],
      order: [["id", "DESC"]],
      raw: true,
    });

    const newMessage = await MessageRecords.create({
      numberphone: normalizedPhone,
      message:
        msg.text || msg.cleanText || msg.message || msg.content?.text || "",
      id_agent: latestOutbound?.id_agent || 1,
      bulkId: msg.bulkId || "inbound",
      messageId:
        msg.messageId ||
        `in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      groupName: "INBOUND",
      status: "RECEIVED",
      description: "Incoming message",
      groupId: 0,
      id_extern: 0,
      direction: "INBOUND",
    });

    messages.push(newMessage);
  }

  return messages;
}

async function getConversationHistoryByNumber(numberPhone, user, limit = 200) {
  const { decoded, dbUser } = await resolveUserContext(user);
  const normalizedPhone = toConversationPhone(numberPhone);

  if (!normalizedPhone) {
    const error = new Error("Número de teléfono inválido");
    error.status = 400;
    throw error;
  }

  const where = {
    numberphone: {
      [Op.in]: buildPhoneVariants(normalizedPhone),
    },
  };

  if (decoded.role_id === 4 || decoded.role_id === 5) {
    where.id_agent = dbUser.id;
  }

  return MessageRecords.findAll({
    where,
    raw: true,
    order: [["created_at", "ASC"]],
    limit,
  });
}

async function getConversationsSummary(user, limit = 100) {
  const { decoded, dbUser } = await resolveUserContext(user);

  const where = {};
  if (decoded.role_id === 4 || decoded.role_id === 5) {
    where.id_agent = dbUser.id;
  }

  const rows = await MessageRecords.findAll({
    where,
    raw: true,
    order: [["created_at", "DESC"]],
    limit: 2000,
  });

  const grouped = new Map();

  for (const row of rows) {
    const conversationPhone = toConversationPhone(row.numberphone);
    if (!conversationPhone) continue;

    if (!grouped.has(conversationPhone)) {
      grouped.set(conversationPhone, {
        numberphone: conversationPhone,
        agentId: row.id_agent || null,
        agentName: null,
        lastMessage: row.message,
        lastDirection: row.direction,
        lastStatus: row.status,
        lastDescription: row.description,
        updated_at: row.updated_at,
        created_at: row.created_at,
        inboundCount: 0,
        outboundCount: 0,
      });
    }

    const conv = grouped.get(conversationPhone);
    if (row.direction === "INBOUND") conv.inboundCount += 1;
    if (row.direction === "OUTBOUND") conv.outboundCount += 1;
  }

  const conversations = Array.from(grouped.values()).slice(0, limit);
  const agentIds = [
    ...new Set(conversations.map((item) => item.agentId).filter(Boolean)),
  ];

  if (agentIds.length) {
    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: agentIds,
        },
      },
      attributes: ["id", "fullname"],
      raw: true,
    });

    const userMap = new Map(users.map((item) => [item.id, item.fullname]));

    for (const conversation of conversations) {
      conversation.agentName = userMap.get(conversation.agentId) || null;
    }
  }

  return conversations;
}

async function getInboundNotifications(user, sinceId = 0, limit = 100) {
  const { decoded, dbUser } = await resolveUserContext(user);

  const where = {
    direction: "INBOUND",
    id: {
      [Op.gt]: Number(sinceId) || 0,
    },
  };

  if (decoded.role_id === 4 || decoded.role_id === 5) {
    where.id_agent = dbUser.id;
  }

  const rows = await MessageRecords.findAll({
    where,
    raw: true,
    order: [["id", "ASC"]],
    limit,
  });

  return {
    count: rows.length,
    lastId: rows.length ? rows.at(-1).id : Number(sinceId) || 0,
    notifications: rows,
  };
}

async function sendConversationMessage(numberPhone, message, user) {
  return InfobitService({ numberPhone, message }, user);
}

module.exports = {
  InfobitService,
  sendBulkInfobitMessages,
  logMessageRecord,
  updateMessageStatus,
  saveInboundMessages,
  getMessageStatusByMessageId,
  syncPendingOutboundStatuses,
  getConversationHistoryByNumber,
  getConversationsSummary,
  getInboundNotifications,
  sendConversationMessage,
};
