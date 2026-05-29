const axios = require("axios");
const https = require("node:https");
const logger = require("../utils/logger");
const { verifyAccessToken } = require("../utils/verifyAccessToken");
const { MessageRecords, User } = require("../models");
const { Op } = require("sequelize");
const infobipConfig = require("../config/infobip");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const INFOBIP_HEADERS = {
  Authorization: String(infobipConfig.apiKey || "")
    .trim()
    .startsWith("App ")
    ? String(infobipConfig.apiKey || "").trim()
    : `App ${String(infobipConfig.apiKey || "").trim()}`,
  "Content-Type": "application/json",
};

const FINAL_GROUPS = ["DELIVERED", "UNDELIVERABLE", "REJECTED", "EXPIRED"];
const SEND_TIMEOUT_MS = 10000;
const SCAN_TIMEOUT_MS = 6000;

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
  const decoded = verifyAccessToken(user);
  const userId = decoded.id;
  const dbUser = await User.findByPk(userId, { raw: true });

  if (!dbUser) throw new Error("User not found");

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

function toE164WithoutPlus(phone) {
  const normalized = toConversationPhone(phone);
  if (!normalized) return "";
  return `1${normalized}`;
}

function buildCcaasHeaders(agentId) {
  if (!agentId) return INFOBIP_HEADERS;

  return {
    ...INFOBIP_HEADERS,
    "x-agent-id": agentId,
  };
}

function safeTimestamp(value) {
  const ts = Date.parse(value || "");
  return Number.isFinite(ts) ? ts : 0;
}

function extractConversationAndMessageIds(data) {
  if (!data || typeof data !== "object") {
    return { conversationId: null, messageId: null };
  }

  const directConversationId =
    data.conversationId ||
    data.conversation?.id ||
    data.payload?.conversationId;
  const directMessageId =
    data.id || data.messageId || data.message?.id || data.payload?.messageId;

  if (directConversationId || directMessageId) {
    return {
      conversationId: directConversationId || null,
      messageId: directMessageId || null,
    };
  }

  const list =
    (Array.isArray(data.messages) && data.messages) ||
    (Array.isArray(data.results) && data.results) ||
    [];

  if (!list.length) {
    return { conversationId: null, messageId: null };
  }

  const item = list[0] || {};
  return {
    conversationId: item.conversationId || item.conversation?.id || null,
    messageId: item.id || item.messageId || null,
  };
}

const INBOUND_TEXT_KEYS = [
  "text",
  "body",
  "message",
  "caption",
  "title",
  "description",
  "value",
];

function pickFirstTextFromList(list, depth) {
  for (const item of list) {
    const candidate = extractTextDeep(item, depth + 1);
    if (candidate) return candidate;
  }
  return "";
}

function pickPreferredObjectText(obj, depth) {
  for (const key of INBOUND_TEXT_KEYS) {
    const candidate = extractTextDeep(obj[key], depth + 1);
    if (candidate) return candidate;
  }
  return "";
}

function extractTextDeep(value, depth = 0) {
  if (depth > 4 || value == null) return "";

  if (typeof value === "string") {
    return value.trim() ? value : "";
  }

  if (Array.isArray(value)) {
    return pickFirstTextFromList(value, depth);
  }

  if (typeof value !== "object") return "";

  const preferred = pickPreferredObjectText(value, depth);
  if (preferred) return preferred;

  return pickFirstTextFromList(Object.values(value), depth);
}

async function startConversationForPhone(numberPhone, message, agentId) {
  const from = toE164WithoutPlus(infobipConfig.sender);
  const to = toE164WithoutPlus(numberPhone);
  if (!from || !to) return null;

  const attempts = [];
  const headers = buildCcaasHeaders(agentId);
  const candidates = [
    {
      endpoint: "/conversations/1/messages",
      body: {
        channel: "SMS",
        from,
        to,
        message: { text: String(message) },
      },
    },
    {
      endpoint: "/conversations/2/messages",
      body: {
        channel: "SMS",
        from,
        to,
        message: { text: String(message) },
      },
    },
    {
      endpoint: "/ccaas/1/messages",
      body: {
        channel: "SMS",
        contentType: "TEXT",
        from,
        to,
        content: String(message),
      },
    },
  ];

  for (const candidate of candidates) {
    try {
      const { data } = await axios.post(
        `${infobipConfig.baseUrl}${candidate.endpoint}`,
        candidate.body,
        {
          headers,
          httpsAgent,
          timeout: SEND_TIMEOUT_MS,
        },
      );

      const ids = extractConversationAndMessageIds(data);
      if (ids.conversationId && ids.messageId) {
        return {
          conversationId: ids.conversationId,
          messageId: ids.messageId,
          to,
          response: data,
          endpoint: candidate.endpoint,
          attempts,
        };
      }

      attempts.push({
        endpoint: candidate.endpoint,
        ok: false,
        reason: "missing_ids",
      });
    } catch (error) {
      attempts.push({
        endpoint: candidate.endpoint,
        ok: false,
        status: error.response?.status || null,
        message:
          error.response?.data?.requestError?.serviceException?.text ||
          error.response?.data?.message ||
          error.message,
      });
    }
  }

  return { conversationId: null, messageId: null, attempts };
}

async function findConversationIdInDbByPhone(numberPhone) {
  const variants = buildPhoneVariants(numberPhone);
  if (!variants.length) return null;

  const latest = await MessageRecords.findOne({
    where: {
      numberphone: { [Op.in]: variants },
      conversationId: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] },
    },
    attributes: ["conversationId", "id"],
    order: [["id", "DESC"]],
    raw: true,
  });

  return latest?.conversationId || null;
}

async function findCcaasConversationByPhone(numberPhone, limit = 30) {
  const target = toConversationPhone(numberPhone);
  if (!target) return null;

  const phoneVariants = new Set(buildPhoneVariants(target));

  const { data } = await axios.get(
    `${infobipConfig.baseUrl}/ccaas/1/conversations`,
    {
      headers: INFOBIP_HEADERS,
      httpsAgent,
      timeout: SCAN_TIMEOUT_MS,
      params: { limit: Math.min(Math.max(Number(limit) || 30, 5), 100) },
    },
  );

  const conversations = Array.isArray(data?.conversations)
    ? data.conversations
    : [];

  const candidates = [];

  for (const conv of conversations) {
    if (!conv?.id) continue;

    try {
      const messagesResp = await axios.get(
        `${infobipConfig.baseUrl}/ccaas/1/conversations/${encodeURIComponent(conv.id)}/messages`,
        {
          headers: INFOBIP_HEADERS,
          httpsAgent,
          timeout: SCAN_TIMEOUT_MS,
          params: { limit: 20 },
        },
      );

      const messages = Array.isArray(messagesResp.data?.messages)
        ? messagesResp.data.messages
        : [];

      const matches = messages.some((msg) => {
        const from = toConversationPhone(msg?.from);
        const to = toConversationPhone(msg?.to);
        return phoneVariants.has(from) || phoneVariants.has(to);
      });

      if (matches) {
        const latestMessageTimestamp = messages.reduce(
          (maxTs, msg) =>
            Math.max(
              maxTs,
              safeTimestamp(
                msg?.createdAt || msg?.created_at || msg?.sentAt || msg?.time,
              ),
            ),
          0,
        );

        const conversationTimestamp = Math.max(
          latestMessageTimestamp,
          safeTimestamp(conv.updatedAt || conv.lastMessageAt || conv.createdAt),
        );

        candidates.push({
          id: conv.id,
          agentId: conv.agentId || infobipConfig.ccaasAgentId || null,
          timestamp: conversationTimestamp,
        });
      }
    } catch (error) {
      logger.warn(
        "InfobitService → findCcaasConversationByPhone() conversation scan warning",
        {
          conversationId: conv.id,
          error: error.response?.data || error.message,
        },
      );
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0];
}

async function updateLatestConversationIdForPhone(numberPhone, conversationId) {
  const normalizedPhone = toConversationPhone(numberPhone);
  if (!normalizedPhone || !conversationId) return 0;

  const variants = buildPhoneVariants(normalizedPhone);

  const [affectedRows] = await MessageRecords.update(
    { conversationId },
    {
      where: {
        numberphone: { [Op.in]: variants },
        direction: "OUTBOUND",
        conversationId: { [Op.or]: [null, ""] },
      },
      order: [["id", "DESC"]],
      limit: 1,
    },
  );

  return affectedRows;
}

function scheduleConversationBackfill(numberPhone) {
  setImmediate(async () => {
    try {
      const conversation = await findCcaasConversationByPhone(numberPhone, 10);
      if (conversation?.id) {
        await updateLatestConversationIdForPhone(numberPhone, conversation.id);
      }
    } catch (error) {
      logger.warn("InfobitService → conversationId backfill warning", {
        numberPhone,
        error: error.response?.data || error.message,
      });
    }
  });
}

async function sendMessageViaCcaas(numberPhone, message, options = {}) {
  const explicitConversationId = String(options.conversationId || "").trim();
  const explicitAgentId = String(options.agentId || "").trim();
  const strictCcaas = Boolean(options.strictCcaas);
  const dbConversationId = explicitConversationId
    ? ""
    : await findConversationIdInDbByPhone(numberPhone);

  let conversation;
  if (explicitConversationId) {
    conversation = {
      id: explicitConversationId,
      agentId: explicitAgentId || infobipConfig.ccaasAgentId || null,
    };
  } else if (dbConversationId) {
    conversation = {
      id: dbConversationId,
      agentId: explicitAgentId || infobipConfig.ccaasAgentId || null,
    };
  } else if (strictCcaas) {
    conversation = await findCcaasConversationByPhone(numberPhone);
  } else {
    conversation = null;
  }

  const bootstrapAgentId = explicitAgentId || infobipConfig.ccaasAgentId || "";

  if (!conversation?.id) {
    const started = await startConversationForPhone(
      numberPhone,
      message,
      bootstrapAgentId,
    );

    if (started?.conversationId && started?.messageId) {
      return {
        provider: "CCAAS",
        conversationId: started.conversationId,
        response: {
          id: started.messageId,
          to: started.to,
          sourceEndpoint: started.endpoint,
        },
      };
    }
  }

  if (!conversation?.id) {
    if (strictCcaas) {
      const error = new Error(
        "conversationId was not found for this number and a new conversation could not be created automatically. Configure the line/channel in Conversations or send a valid conversationId.",
      );
      error.status = 409;
      throw error;
    }
    return null;
  }

  const resolvedAgentId =
    explicitAgentId || conversation.agentId || infobipConfig.ccaasAgentId || "";

  if (!resolvedAgentId && strictCcaas) {
    const error = new Error(
      "Missing x-agent-id for Conversations send. Configure INFOBIP_CCAAS_AGENT_ID or provide agentId in the request.",
    );
    error.status = 409;
    throw error;
  }

  const from = toE164WithoutPlus(infobipConfig.sender);
  const to = toE164WithoutPlus(numberPhone);
  if (!from || !to) return null;

  const body = {
    channel: "SMS",
    contentType: "TEXT",
    from,
    to,
    content: String(message),
  };

  const { data } = await axios.post(
    `${infobipConfig.baseUrl}/ccaas/1/conversations/${encodeURIComponent(conversation.id)}/messages`,
    body,
    {
      headers: buildCcaasHeaders(resolvedAgentId),
      httpsAgent,
      timeout: SEND_TIMEOUT_MS,
    },
  );

  return {
    provider: "CCAAS",
    conversationId: conversation.id,
    response: data,
  };
}

function mapInfobipProviderAuthError(error) {
  if (!error?.isAxiosError) return null;

  const status = error?.response?.status;
  if (status !== 401 && status !== 403) return null;

  const providerError = new Error(
    status === 401
      ? "Infobip authentication failed (invalid/expired API key or unauthorized resource)."
      : "Infobip request was forbidden (check sender/channel permissions).",
  );

  providerError.status = 502;
  providerError.details = {
    provider: "INFOBIP",
    endpoint: error.config?.url || null,
    providerStatus: status,
    providerCode: error.response?.data?.errorCode || null,
    providerMessage: error.response?.data?.description || error.message,
    providerAction: error.response?.data?.action || null,
    providerResources: error.response?.data?.resources || null,
  };

  return providerError;
}

function buildCcaasResponse(ccaasResult) {
  const ids = extractConversationAndMessageIds(ccaasResult?.response || {});
  const resolvedMessageId = ids.messageId || ccaasResult?.response?.id || null;
  const resolvedConversationId =
    ids.conversationId || ccaasResult?.conversationId || null;

  if (!resolvedMessageId) {
    return null;
  }

  const ccaasMessageId = String(resolvedMessageId);
  return {
    bulkId: `ccaas-${ccaasMessageId}`,
    messageId: ccaasMessageId,
    destination: ccaasResult.response.to,
    provider: "CCAAS",
    conversationId: resolvedConversationId,
    status: {
      groupName: "SENT",
      name: "SENT",
      description: "Message sent via CCAAS",
      groupId: 1,
      id: 1,
    },
  };
}

async function trySendViaCcaas(normalizedPhone, message, options) {
  try {
    const ccaasResult = await sendMessageViaCcaas(
      normalizedPhone,
      message,
      options,
    );
    return buildCcaasResponse(ccaasResult);
  } catch (error) {
    if (options.strictCcaas) {
      throw error;
    }

    logger.warn("InfobitService → CCAAS send failed, fallback to SMS API", {
      error: error.response?.data || error.message,
    });
    return null;
  }
}

async function sendViaSmsApiFallback(normalizedPhone, message) {
  const { data } = await axios.post(
    `${infobipConfig.baseUrl}/sms/3/messages`,
    {
      messages: [
        {
          from: infobipConfig.sender,
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
      timeout: SEND_TIMEOUT_MS,
    },
  );

  const infoMessage = data.messages[0];
  return { bulkId: data.bulkId, ...infoMessage, provider: "SMS_API" };
}

//CREATE MESSAGE INFOBIT
async function InfobitService(payload, user, options = {}) {
  const { dbUser } = await resolveUserContext(user);
  logger.info("InfobitService → InfobitService() started");
  const { numberPhone, message, conversationId, agentId } = payload;
  const normalizedPhone = toConversationPhone(numberPhone);
  const strictCcaas = Boolean(options.strictCcaas);

  if (!normalizedPhone) {
    const error = new Error("Invalid phone number");
    error.status = 400;
    throw error;
  }

  try {
    let response = await trySendViaCcaas(normalizedPhone, message, {
      conversationId,
      agentId,
      strictCcaas,
    });

    if (!response) {
      if (strictCcaas) {
        const error = new Error(
          "Could not send through CCAAS. For visibility in Infobip Conversations, use valid conversationId and agentId.",
        );
        error.status = 409;
        throw error;
      }

      response = await sendViaSmsApiFallback(normalizedPhone, message);
    }

    logger.success("InfobitService → InfobitService() SUCCESS", {
      provider: response.provider,
    });
    const persistedBulkId =
      response.bulkId || `fallback-${response.messageId || Date.now()}`;
    await MessageRecords.create({
      numberphone: normalizedPhone,
      message,
      id_agent: dbUser.id || 1,
      bulkId: persistedBulkId,
      messageId: response.messageId,
      conversationId: response.conversationId || null,
      groupName: response.status.groupName,
      status: response.status.name,
      description: response.status.description,
      groupId: response.status.groupId,
      id_extern: response.status.id,
      direction: "OUTBOUND",
    });

    if (!response.conversationId) {
      scheduleConversationBackfill(normalizedPhone);
    }

    logger.success("InfobitService → Message saved successfully");
    return response;
  } catch (error) {
    logger.error(
      "InfobitService → error",
      error.response?.data || error.message,
    );
    const providerError = mapInfobipProviderAuthError(error);
    if (providerError) throw providerError;

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
    const error = new Error("At least one phone number is required");
    error.status = 400;
    throw error;
  }

  if (!message || !String(message).trim()) {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }

  const normalizedPhones = [
    ...new Set(
      rawPhones.map((phone) => toConversationPhone(phone)).filter(Boolean),
    ),
  ];

  if (!normalizedPhones.length) {
    const error = new Error("No valid phone numbers were found");
    error.status = 400;
    throw error;
  }

  const destinations = normalizedPhones.map((phone) => ({
    to: `+1${phone}`,
  }));

  try {
    const { data } = await axios.post(
      `${infobipConfig.baseUrl}/sms/3/messages`,
      {
        messages: [
          {
            from: infobipConfig.sender,
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
        conversationId: item.conversationId || null,
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
    const error = new Error("Message not found");
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
  const { data } = await axios.get(`${infobipConfig.baseUrl}/sms/1/reports`, {
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

function normalizeInboundItem(rawItem = {}) {
  const envelope =
    rawItem?.payload && typeof rawItem.payload === "object"
      ? rawItem.payload
      : rawItem;
  const nestedMessage =
    envelope?.message && typeof envelope.message === "object"
      ? envelope.message
      : {};

  const textCandidates = [
    nestedMessage?.content?.text,
    nestedMessage?.content?.body,
    nestedMessage?.text,
    extractTextDeep(nestedMessage?.content),
    envelope?.text,
    envelope?.cleanText,
    envelope?.messageText,
    envelope?.content?.text,
    extractTextDeep(envelope?.content),
    typeof envelope?.message === "string" ? envelope.message : "",
  ];

  const text =
    textCandidates.find((value) => typeof value === "string" && value.trim()) ||
    "";

  const from =
    nestedMessage?.from ||
    envelope?.from ||
    envelope?.msisdn ||
    envelope?.source?.address ||
    envelope?.sender ||
    envelope?.originator ||
    "";

  const conversationId =
    nestedMessage?.conversationId ||
    envelope?.conversationId ||
    envelope?.id ||
    null;

  const messageId =
    nestedMessage?.messageId ||
    nestedMessage?.id ||
    envelope?.messageId ||
    envelope?.id ||
    envelope?.smsMessageId ||
    null;

  const receivedAt =
    nestedMessage?.createdAt ||
    nestedMessage?.updatedAt ||
    envelope?.receivedAt ||
    envelope?.timestamp ||
    rawItem?.timestamp ||
    null;

  return {
    from,
    text,
    conversationId,
    messageId,
    receivedAt,
    bulkId: envelope?.bulkId || rawItem?.bulkId || null,
  };
}

//METHOD TO SAVE INBOUND MESSAGES
async function saveInboundMessages(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const messages = [];

  for (const msg of results) {
    const normalizedInbound = normalizeInboundItem(msg);
    const fromPhone = normalizedInbound.from;

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

    // Skip inbound messages not linked to a previous outbound message from our API.
    if (!latestOutbound?.id_agent) {
      continue;
    }

    const inboundMessageId =
      normalizedInbound.messageId ||
      (normalizedInbound.receivedAt
        ? `in_${normalizedPhone}_${String(normalizedInbound.receivedAt).replaceAll(/\D/g, "")}`
        : `in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const existingInbound = await MessageRecords.findOne({
      where: { messageId: inboundMessageId },
      attributes: ["id"],
      raw: true,
    });

    if (existingInbound) {
      continue;
    }

    if (normalizedInbound.conversationId) {
      await updateLatestConversationIdForPhone(
        normalizedPhone,
        normalizedInbound.conversationId,
      );
    }

    const newMessage = await MessageRecords.create({
      numberphone: normalizedPhone,
      message: normalizedInbound.text,
      id_agent: latestOutbound?.id_agent || 1,
      bulkId: normalizedInbound.bulkId || "inbound",
      conversationId: normalizedInbound.conversationId,
      messageId: inboundMessageId,
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

async function fetchInboundFromInfobip(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const endpoints = [
    "/sms/1/inbox/reports",
    "/sms/3/inbound/messages",
    "/sms/2/inbound/messages",
  ];

  const attempts = [];

  for (const endpoint of endpoints) {
    const url = `${infobipConfig.baseUrl}${endpoint}`;

    try {
      const { data } = await axios.get(url, {
        headers: INFOBIP_HEADERS,
        httpsAgent,
        timeout: 30000,
        params: {
          limit: safeLimit,
        },
      });

      let results = [];
      if (Array.isArray(data?.results)) {
        results = data.results;
      } else if (Array.isArray(data?.messages)) {
        results = data.messages;
      } else if (Array.isArray(data)) {
        results = data;
      }

      attempts.push({ endpoint, ok: true, count: results.length });

      if (results.length > 0) {
        return { results, endpoint, attempts };
      }
    } catch (error) {
      attempts.push({
        endpoint,
        ok: false,
        status: error.response?.status || null,
        message:
          error.response?.data?.requestError?.serviceException?.text ||
          error.response?.data?.message ||
          error.message,
      });
    }
  }

  return { results: [], endpoint: null, attempts };
}

async function fetchInboundFromCcaas(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const attempts = [];

  const knownOutboundRows = await MessageRecords.findAll({
    where: { direction: "OUTBOUND" },
    attributes: ["numberphone"],
    raw: true,
    limit: 50000,
  });

  const knownOutboundPhones = new Set(
    knownOutboundRows
      .map((row) => toConversationPhone(row.numberphone))
      .filter(Boolean),
  );

  try {
    const conversationsResp = await axios.get(
      `${infobipConfig.baseUrl}/ccaas/1/conversations`,
      {
        headers: INFOBIP_HEADERS,
        httpsAgent,
        timeout: 30000,
        params: {
          limit: Math.min(Math.max(Math.ceil(safeLimit / 10), 10), 100),
        },
      },
    );

    const conversations = Array.isArray(conversationsResp.data?.conversations)
      ? conversationsResp.data.conversations
      : [];

    attempts.push({
      endpoint: "/ccaas/1/conversations",
      ok: true,
      count: conversations.length,
    });

    if (!conversations.length) {
      return { results: [], endpoint: "/ccaas/1/conversations", attempts };
    }

    const inboundResults = [];

    const appendInboundFromMessages = (messages, convId) => {
      for (const msg of messages) {
        if (String(msg?.direction || "").toUpperCase() !== "INBOUND") continue;

        const normalizedFrom = toConversationPhone(msg.from);
        if (!normalizedFrom || !knownOutboundPhones.has(normalizedFrom)) {
          continue;
        }

        inboundResults.push({
          messageId: msg.id,
          from: msg.from,
          to: msg.to,
          text: msg.content?.text || "",
          receivedAt: msg.createdAt,
          conversationId: msg.conversationId || convId,
        });

        if (inboundResults.length >= safeLimit) {
          return true;
        }
      }

      return false;
    };

    for (const conv of conversations) {
      if (!conv?.id) continue;

      try {
        const messagesResp = await axios.get(
          `${infobipConfig.baseUrl}/ccaas/1/conversations/${encodeURIComponent(conv.id)}/messages`,
          {
            headers: INFOBIP_HEADERS,
            httpsAgent,
            timeout: 30000,
            params: { limit: Math.min(Math.max(safeLimit, 10), 200) },
          },
        );

        const messages = Array.isArray(messagesResp.data?.messages)
          ? messagesResp.data.messages
          : [];

        attempts.push({
          endpoint: `/ccaas/1/conversations/${conv.id}/messages`,
          ok: true,
          count: messages.length,
        });

        if (appendInboundFromMessages(messages, conv.id)) {
          return {
            results: inboundResults,
            endpoint: "/ccaas/1/conversations/:id/messages",
            attempts,
          };
        }
      } catch (error) {
        attempts.push({
          endpoint: `/ccaas/1/conversations/${conv.id}/messages`,
          ok: false,
          status: error.response?.status || null,
          message:
            error.response?.data?.requestError?.serviceException?.text ||
            error.response?.data?.message ||
            error.message,
        });
      }
    }

    return {
      results: inboundResults,
      endpoint: "/ccaas/1/conversations/:id/messages",
      attempts,
    };
  } catch (error) {
    attempts.push({
      endpoint: "/ccaas/1/conversations",
      ok: false,
      status: error.response?.status || null,
      message:
        error.response?.data?.requestError?.serviceException?.text ||
        error.response?.data?.message ||
        error.message,
    });

    return { results: [], endpoint: null, attempts };
  }
}

async function syncInboundFromInfobip(limit = 200) {
  try {
    // Priority: CCAAS (Conversations) because replies are stored there in this tenant.
    const ccaasData = await fetchInboundFromCcaas(limit);
    const fetchedData = ccaasData.results?.length
      ? ccaasData
      : await fetchInboundFromInfobip(limit);
    const inboundResults = fetchedData.results || [];

    if (!inboundResults.length) {
      return {
        fetched: 0,
        saved: 0,
        sourceEndpoint: fetchedData.endpoint,
        attempts: fetchedData.attempts || [],
      };
    }

    const savedRows = await saveInboundMessages(inboundResults);
    return {
      fetched: inboundResults.length,
      saved: savedRows.length,
      sourceEndpoint: fetchedData.endpoint,
      attempts: fetchedData.attempts || [],
    };
  } catch (error) {
    const errorMessage =
      error.response?.data?.requestError?.serviceException?.text ||
      error.response?.data?.message ||
      error.message;

    logger.warn("InfobitService → syncInboundFromInfobip() warning", {
      error: errorMessage,
    });
    return { fetched: 0, saved: 0, error: errorMessage, attempts: [] };
  }
}

function mapInboundFromCcaasMessage(msg, fallbackConversationId) {
  return {
    messageId: msg.id,
    from: msg.from,
    to: msg.to,
    text: msg.content?.text || "",
    receivedAt: msg.createdAt,
    conversationId: msg.conversationId || fallbackConversationId,
  };
}

function isInboundForPhone(msg, targetPhone, sinceMs) {
  if (String(msg?.direction || "").toUpperCase() !== "INBOUND") return false;

  const normalizedFrom = toConversationPhone(msg.from);
  if (normalizedFrom !== targetPhone) return false;

  const createdMs = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
  if (sinceMs && createdMs && createdMs < sinceMs) return false;

  return true;
}

async function getCcaasConversationsForScan() {
  const conversationsResp = await axios.get(
    `${infobipConfig.baseUrl}/ccaas/1/conversations`,
    {
      headers: INFOBIP_HEADERS,
      httpsAgent,
      timeout: 30000,
      params: { limit: 50 },
    },
  );

  return Array.isArray(conversationsResp.data?.conversations)
    ? conversationsResp.data.conversations
    : [];
}

async function getCcaasConversationMessages(conversationId) {
  const messagesResp = await axios.get(
    `${infobipConfig.baseUrl}/ccaas/1/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      headers: INFOBIP_HEADERS,
      httpsAgent,
      timeout: 30000,
      params: { limit: 100 },
    },
  );

  return Array.isArray(messagesResp.data?.messages)
    ? messagesResp.data.messages
    : [];
}

async function processCcaasConversationForPhone(
  conv,
  targetPhone,
  sinceMs,
  safeLimit,
  inboundResults,
  attempts,
) {
  const messages = await getCcaasConversationMessages(conv.id);

  attempts.push({
    endpoint: `/ccaas/1/conversations/${conv.id}/messages`,
    ok: true,
    count: messages.length,
  });

  for (const msg of messages) {
    if (!isInboundForPhone(msg, targetPhone, sinceMs)) continue;

    inboundResults.push(mapInboundFromCcaasMessage(msg, conv.id));

    if (inboundResults.length >= safeLimit) {
      return true;
    }
  }

  return false;
}

async function fetchCcaasInboundByPhone(numberPhone, sinceDate, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const targetPhone = toConversationPhone(numberPhone);
  const attempts = [];

  if (!targetPhone) {
    return { results: [], attempts, endpoint: null };
  }

  try {
    const conversations = await getCcaasConversationsForScan();

    attempts.push({
      endpoint: "/ccaas/1/conversations",
      ok: true,
      count: conversations.length,
    });

    const inboundResults = [];
    const sinceMs = sinceDate ? new Date(sinceDate).getTime() : 0;

    for (const conv of conversations) {
      if (!conv?.id) continue;

      try {
        const reachedLimit = await processCcaasConversationForPhone(
          conv,
          targetPhone,
          sinceMs,
          safeLimit,
          inboundResults,
          attempts,
        );

        if (reachedLimit) {
          return {
            results: inboundResults,
            attempts,
            endpoint: "/ccaas/1/conversations/:id/messages",
          };
        }
      } catch (error) {
        attempts.push({
          endpoint: `/ccaas/1/conversations/${conv.id}/messages`,
          ok: false,
          status: error.response?.status || null,
          message:
            error.response?.data?.requestError?.serviceException?.text ||
            error.response?.data?.message ||
            error.message,
        });
      }
    }

    return {
      results: inboundResults,
      attempts,
      endpoint: "/ccaas/1/conversations/:id/messages",
    };
  } catch (error) {
    attempts.push({
      endpoint: "/ccaas/1/conversations",
      ok: false,
      status: error.response?.status || null,
      message:
        error.response?.data?.requestError?.serviceException?.text ||
        error.response?.data?.message ||
        error.message,
    });

    return { results: [], attempts, endpoint: null };
  }
}

function extractConversationMessages(payload) {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

// Get messages from an Infobip Conversations API conversation
async function getConversationMessages(conversationId, limit = 100) {
  if (!conversationId) {
    const error = new Error("conversationId is required");
    error.status = 400;
    throw error;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const encodedConversationId = encodeURIComponent(String(conversationId));
  const candidates = [
    {
      endpoint: `/ccaas/1/conversations/${encodedConversationId}/messages`,
      params: { limit: safeLimit },
    },
    {
      endpoint: "/conversations/1/messages",
      params: { conversationId: String(conversationId), limit: safeLimit },
    },
    {
      endpoint: `/conversations/1/conversations/${encodedConversationId}/messages`,
      params: { limit: safeLimit },
    },
    {
      endpoint: "/conversations/2/messages",
      params: { conversationId: String(conversationId), limit: safeLimit },
    },
    {
      endpoint: `/conversations/2/conversations/${encodedConversationId}/messages`,
      params: { limit: safeLimit },
    },
  ];

  const attempts = [];

  for (const candidate of candidates) {
    const url = `${infobipConfig.baseUrl}${candidate.endpoint}`;

    try {
      const { data } = await axios.get(url, {
        headers: INFOBIP_HEADERS,
        httpsAgent,
        timeout: 30000,
        params: candidate.params,
      });

      const messages = extractConversationMessages(data);
      attempts.push({
        endpoint: candidate.endpoint,
        ok: true,
        status: 200,
        count: messages.length,
      });

      return {
        messages,
        sourceEndpoint: candidate.endpoint,
        attempts,
      };
    } catch (error) {
      attempts.push({
        endpoint: candidate.endpoint,
        ok: false,
        status: error.response?.status || null,
        message:
          error.response?.data?.requestError?.serviceException?.text ||
          error.response?.data?.message ||
          error.message,
      });
    }
  }

  logger.error("Error retrieving Conversations messages", {
    conversationId,
    attempts,
  });

  const error = new Error("Could not retrieve messages from Conversations API");
  error.status = 404;
  error.details = { conversationId, attempts };
  throw error;
}

async function getConversationHistoryByNumber(numberPhone, user, limit = 200) {
  const { decoded, dbUser } = await resolveUserContext(user);
  const normalizedPhone = toConversationPhone(numberPhone);

  if (!normalizedPhone) {
    const error = new Error("Invalid phone number");
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

  const where = {
    direction: "OUTBOUND",
  };
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
        conversationId: row.conversationId || null,
        lastMessageId: row.messageId || null,
        updated_at: row.updated_at,
        created_at: row.created_at,
        inboundCount: 0,
        outboundCount: 0,
      });
    }

    const conv = grouped.get(conversationPhone);
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

async function getInboundNotifications(
  user,
  sinceId = 0,
  limit = 100,
  options = {},
) {
  const shouldSync = options?.sync === true;
  const syncResult = shouldSync
    ? await syncInboundFromInfobip(
        Math.min(Math.max(Number(limit) || 100, 1), 500),
      )
    : {
        fetched: 0,
        saved: 0,
        skipped: true,
      };

  const { decoded, dbUser } = await resolveUserContext(user);
  const includeAll = options?.all === true;
  const safeSinceId = includeAll ? 0 : Math.max(Number(sinceId) || 0, 0);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 5000);

  const where = {
    direction: "INBOUND",
    id: {
      [Op.gt]: safeSinceId,
    },
  };

  if (options?.mine === true) {
    where.id_agent = dbUser.id;
  }

  if (
    !options?.mine &&
    !includeAll &&
    (decoded.role_id === 4 || decoded.role_id === 5)
  ) {
    const outboundRows = await MessageRecords.findAll({
      where: {
        direction: "OUTBOUND",
        id_agent: dbUser.id,
      },
      attributes: ["numberphone"],
      raw: true,
      limit: 10000,
    });

    const outboundPhones = [
      ...new Set(outboundRows.map((row) => row.numberphone).filter(Boolean)),
    ];

    if (outboundPhones.length) {
      where[Op.or] = [
        { id_agent: dbUser.id },
        {
          numberphone: {
            [Op.in]: outboundPhones,
          },
        },
      ];
    } else {
      where.id_agent = dbUser.id;
    }
  }

  if (options?.onlyApiLinked !== false) {
    const outboundWhere = { direction: "OUTBOUND" };
    if (options?.mine === true) {
      outboundWhere.id_agent = dbUser.id;
    }

    const outboundRows = await MessageRecords.findAll({
      where: outboundWhere,
      attributes: ["numberphone"],
      raw: true,
      limit: 50000,
    });

    const outboundPhones = [
      ...new Set(
        outboundRows
          .map((row) => toConversationPhone(row.numberphone))
          .filter(Boolean),
      ),
    ];

    if (!outboundPhones.length) {
      return {
        count: 0,
        lastId: safeSinceId,
        sinceId: safeSinceId,
        limit: safeLimit,
        all: includeAll,
        sync: syncResult,
        notifications: [],
      };
    }

    where.numberphone = {
      [Op.in]: outboundPhones,
    };
  }

  const rows = await MessageRecords.findAll({
    where,
    raw: true,
    order: [["id", "ASC"]],
    limit: safeLimit,
  });

  return {
    count: rows.length,
    lastId: rows.length ? rows.at(-1).id : safeSinceId,
    sinceId: safeSinceId,
    limit: safeLimit,
    all: includeAll,
    sync: syncResult,
    notifications: rows,
  };
}

async function getInboundRepliesByMessageId(messageId, user, limit = 100) {
  const { decoded, dbUser } = await resolveUserContext(user);

  const outboundWhere = {
    messageId,
    direction: "OUTBOUND",
  };

  if (decoded.role_id === 4 || decoded.role_id === 5) {
    outboundWhere.id_agent = dbUser.id;
  }

  const outboundMessage = await MessageRecords.findOne({
    where: outboundWhere,
    raw: true,
  });

  if (!outboundMessage) {
    const error = new Error("Sent message not found");
    error.status = 404;
    throw error;
  }

  const phone = toConversationPhone(outboundMessage.numberphone);
  if (!phone) {
    return {
      messageId,
      numberphone: outboundMessage.numberphone,
      count: 0,
      replies: [],
    };
  }

  const replies = await MessageRecords.findAll({
    where: {
      direction: "INBOUND",
      numberphone: {
        [Op.in]: buildPhoneVariants(phone),
      },
      created_at: {
        [Op.gte]: outboundMessage.created_at,
      },
    },
    raw: true,
    order: [["created_at", "ASC"]],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
  });

  if (replies.length > 0) {
    return {
      messageId,
      numberphone: phone,
      outboundCreatedAt: outboundMessage.created_at,
      count: replies.length,
      replies,
      sync: { skipped: true, reason: "already_in_db" },
    };
  }

  const syncLive = await fetchCcaasInboundByPhone(
    phone,
    outboundMessage.created_at,
    Math.min(Math.max(Number(limit) || 100, 1), 200),
  );

  if (syncLive.results.length) {
    await saveInboundMessages(syncLive.results);
  }

  const refreshedReplies = await MessageRecords.findAll({
    where: {
      direction: "INBOUND",
      numberphone: {
        [Op.in]: buildPhoneVariants(phone),
      },
      created_at: {
        [Op.gte]: outboundMessage.created_at,
      },
    },
    raw: true,
    order: [["created_at", "ASC"]],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
  });

  return {
    messageId,
    numberphone: phone,
    outboundCreatedAt: outboundMessage.created_at,
    count: refreshedReplies.length,
    replies: refreshedReplies,
    sync: {
      fetched: syncLive.results.length,
      sourceEndpoint: syncLive.endpoint,
      attempts: syncLive.attempts,
    },
  };
}

async function sendConversationMessage(
  numberPhone,
  message,
  user,
  options = {},
) {
  return InfobitService(
    {
      numberPhone,
      message,
      conversationId: options.conversationId,
      agentId: options.agentId,
    },
    user,
    { strictCcaas: options.strictCcaas === true },
  );
}

module.exports = {
  sendConversationMessage,
  getInboundNotifications,
  saveInboundMessages,
  getConversationHistoryByNumber,
  getConversationsSummary,
  // Used by internal jobs
  syncPendingOutboundStatuses,
  syncInboundFromInfobip,
};
