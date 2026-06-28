const axios = require("axios");
const logger = require("../utils/logger");
const infobipConfig = require("../config/infobip");
const ImginaSmsSession = require("../models/imginaSmsSession");
const MessageRecords = require("../models/messageRecords");
const {
  buildPrequalContext,
  buildSmsSystemPrompt,
} = require("./imginaPrompt.service");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 30000;
const inboundLocks = new Map();

function getAnthropicKey() {
  return String(
    process.env.IMGINA_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || "",
  ).trim();
}

function getImginaSystemAgentId() {
  return Number(process.env.IMGINA_SYSTEM_AGENT_ID) || 1;
}

function normalizePhone10(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  let normalized = digits;

  if (normalized.length === 11 && normalized.startsWith("1")) {
    normalized = normalized.slice(1);
  }

  if (normalized.length > 10) {
    normalized = normalized.slice(-10);
  }

  return normalized.length === 10 ? normalized : "";
}

function toE164(digits) {
  return `+1${digits}`;
}

function stripEntitiesBlock(text) {
  return String(text || "")
    .replace(/%%ENTITIES%%.*?%%END%%/gs, "")
    .trim();
}

function normalizeHistory(messages) {
  const merged = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.role || !message?.content) {
      continue;
    }

    if (!merged.length) {
      merged.push({ role: message.role, content: message.content });
      continue;
    }

    const last = merged.at(-1);
    if (last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
      continue;
    }

    merged.push({ role: message.role, content: message.content });
  }

  if (merged.length && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "[intake start]" });
  }

  return merged;
}

function ensureImginaConfigured() {
  const anthropicKey = getAnthropicKey();

  if (!anthropicKey) {
    return { ok: false, reason: "missing_anthropic_key" };
  }

  if (
    !infobipConfig.baseUrl ||
    !infobipConfig.apiKey ||
    !infobipConfig.sender
  ) {
    return { ok: false, reason: "missing_infobip_config" };
  }

  return { ok: true, anthropicKey };
}

async function callClaude(system, messages, maxTokens = 600) {
  const config = ensureImginaConfigured();
  if (!config.ok) {
    throw new Error(config.reason);
  }

  const { data } = await axios.post(
    ANTHROPIC_URL,
    {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: normalizeHistory(messages),
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      timeout: 60000,
    },
  );

  return data?.content?.[0]?.text || null;
}

async function persistOutboundRecord(digits, message, providerResponse) {
  const status = providerResponse?.status || {};

  await MessageRecords.create({
    numberphone: digits,
    message: String(message || ""),
    id_agent: getImginaSystemAgentId(),
    bulkId:
      providerResponse?.bulkId ||
      `imgina-${providerResponse?.messageId || Date.now()}`,
    messageId: providerResponse?.messageId || `imgina-${Date.now()}`,
    conversationId: providerResponse?.conversationId || null,
    groupName: status.groupName || "PENDING",
    status: status.name || "PENDING",
    description: status.description || "Message sent by IMGina backend",
    groupId: Number(status.groupId || 1),
    id_extern: Number(status.id || 1),
    direction: "OUTBOUND",
  });
}

async function sendSmsText(phoneE164, message, digits) {
  const config = ensureImginaConfigured();
  if (!config.ok) {
    return { ok: false, error: config.reason };
  }

  try {
    const { data } = await axios.post(
      `${infobipConfig.baseUrl}/sms/3/messages`,
      {
        messages: [
          {
            from: infobipConfig.sender,
            destinations: [{ to: phoneE164 }],
            content: { text: String(message || "") },
          },
        ],
      },
      {
        headers: {
          Authorization: String(infobipConfig.apiKey || "")
            .trim()
            .startsWith("App ")
            ? String(infobipConfig.apiKey || "").trim()
            : `App ${String(infobipConfig.apiKey || "").trim()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: SEND_TIMEOUT_MS,
      },
    );

    const providerMessage = Array.isArray(data?.messages)
      ? data.messages[0]
      : null;
    if (providerMessage) {
      await persistOutboundRecord(digits, message, {
        ...providerMessage,
        bulkId: data?.bulkId,
      });
    }

    return {
      ok: true,
      bulkId: data?.bulkId || null,
      messageId: providerMessage?.messageId || null,
      status: providerMessage?.status || null,
      conversationId: providerMessage?.conversationId || null,
    };
  } catch (error) {
    logger.warn("ImginaSmsService -> sendSmsText failed", {
      error: error.response?.data || error.message,
      phone: digits,
    });

    return {
      ok: false,
      error:
        error.response?.data?.requestError?.serviceException?.text ||
        error.response?.data?.description ||
        error.message,
    };
  }
}

function arrayGet(value, path) {
  let cursor = value;

  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }
    cursor = cursor[key];
  }

  return cursor;
}

function isListArray(value) {
  return Array.isArray(value);
}

function payloadEvents(body) {
  const events = [];

  if (isListArray(body)) {
    events.push(...body);
  }

  if (Array.isArray(body?.results)) {
    events.push(...body.results);
  }
  if (Array.isArray(body?.messages)) {
    events.push(...body.messages);
  }
  if (Array.isArray(body?.events)) {
    events.push(...body.events);
  }
  if (body?.result && typeof body.result === "object") {
    events.push(body.result);
  }
  if (body?.payload && typeof body.payload === "object") {
    events.push(body.payload);
  }
  if (body && typeof body === "object") {
    events.push(body);
  }

  return events.flatMap((event) => {
    if (!event || typeof event !== "object") {
      return [];
    }

    const expanded = [];
    if (event.payload && typeof event.payload === "object") {
      expanded.push(event.payload);
    }
    if (event.message && typeof event.message === "object") {
      expanded.push(event.message);
    }
    expanded.push(event);
    return expanded;
  });
}

function extractTextDeep(value, depth = 0) {
  if (depth > 5 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const preferredKeys = [
    "cleanedText",
    "cleanText",
    "messageText",
    "text",
    "body",
    "value",
    "content",
    "message",
  ];

  for (const key of preferredKeys) {
    if (key in value) {
      const candidate = extractTextDeep(value[key], depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractTextDeep(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  return "";
}

function extractPhoneDeep(value, depth = 0) {
  if (depth > 5 || value == null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value).trim();
    return normalizePhone10(raw) ? raw : "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const preferredKeys = [
    "phone",
    "phoneNumber",
    "number",
    "msisdn",
    "address",
    "id",
    "identifier",
    "from",
    "sender",
    "originator",
    "source",
    "contact",
    "customer",
    "author",
  ];

  for (const key of preferredKeys) {
    if (key in value) {
      const candidate = extractPhoneDeep(value[key], depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  for (const item of Object.values(value)) {
    const candidate = extractPhoneDeep(item, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function firstPayloadEvent(body) {
  const events = payloadEvents(body);
  return events[0] || {};
}

function inboundEventType(event, body) {
  const candidates = [
    event?.event,
    event?.eventType,
    event?.type,
    event?.direction,
    body?.event,
    body?.eventType,
    body?.type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }

  return "";
}

function extractMessageId(event, body) {
  const candidates = [
    event?.messageId,
    event?.message_id,
    event?.id,
    arrayGet(event, ["message", "messageId"]),
    arrayGet(event, ["message", "id"]),
    body?.messageId,
    body?.id,
    arrayGet(body, ["payload", "messageId"]),
    arrayGet(body, ["payload", "message", "id"]),
  ];

  for (const candidate of candidates) {
    if (
      (typeof candidate === "string" || typeof candidate === "number") &&
      String(candidate).trim()
    ) {
      return String(candidate).trim();
    }
  }

  return "";
}

function extractInboundText(body) {
  for (const event of payloadEvents(body)) {
    const textCandidates = [
      event?.cleanedText,
      event?.cleanText,
      event?.messageText,
      event?.text,
      event?.body,
      event?.content,
      event?.message,
      arrayGet(event, ["message", "content"]),
      arrayGet(event, ["message", "content", "text"]),
      arrayGet(event, ["content", "text"]),
      arrayGet(event, ["content", "body"]),
    ];

    for (const candidate of textCandidates) {
      const candidateText = extractTextDeep(candidate);
      if (candidateText) {
        return candidateText;
      }
    }
  }

  return "";
}

function extractInboundFrom(body) {
  for (const event of payloadEvents(body)) {
    const fromCandidates = [
      event?.from,
      event?.sender,
      event?.msisdn,
      event?.originator,
      event?.contact,
      event?.customer,
      event?.author,
      event?.source,
      arrayGet(event, ["source", "address"]),
      arrayGet(event, ["message", "from"]),
      arrayGet(event, ["message", "contact"]),
      arrayGet(event, ["message", "customer"]),
      arrayGet(event, ["message", "author"]),
    ];

    for (const candidate of fromCandidates) {
      const candidateFrom = extractPhoneDeep(candidate);
      if (candidateFrom) {
        return candidateFrom;
      }
    }
  }

  return "";
}

function extractInbound(body) {
  return {
    from: extractInboundFrom(body),
    text: extractInboundText(body),
  };
}

function acquireInboundLock(digits) {
  const current = inboundLocks.get(digits);
  const now = Date.now();

  if (current && now - current < 30000) {
    return false;
  }

  inboundLocks.set(digits, now);
  return true;
}

function releaseInboundLock(digits) {
  inboundLocks.delete(digits);
}

function isExpired(session) {
  const updatedAt =
    session?.updated_at || session?.updatedAt || session?.created_at;
  if (!updatedAt) {
    return true;
  }

  return Date.now() - new Date(updatedAt).getTime() > SESSION_TTL_MS;
}

function buildInitialUserMessage(name, prequalData) {
  if (prequalData && Object.keys(prequalData).length) {
    return buildPrequalContext(prequalData);
  }

  return `[SMS intake initiated. Lead name on file: ${name}. Begin the intake at Step 1: greet warmly and ask for their first name to confirm.]`;
}

async function upsertSession({
  digits,
  phoneE164,
  leadName,
  systemPrompt,
  messages,
  recentMessageIds,
}) {
  await ImginaSmsSession.upsert({
    phone_digits: digits,
    phone_e164: phoneE164,
    lead_name: leadName || null,
    system_prompt: systemPrompt,
    messages,
    recent_message_ids: recentMessageIds || [],
  });
}

async function startSmsSession({ phone, name, prequalData }) {
  const config = ensureImginaConfigured();
  if (!config.ok) {
    const error = new Error(config.reason);
    error.status = 500;
    throw error;
  }

  const digits = normalizePhone10(phone);
  if (!digits) {
    const error = new Error("Only US phone numbers are supported.");
    error.status = 400;
    throw error;
  }

  const phoneE164 = toE164(digits);
  const leadName = String(name || "there").trim() || "there";
  const systemPrompt = buildSmsSystemPrompt();
  const messages = [
    {
      role: "user",
      content: buildInitialUserMessage(leadName, prequalData),
    },
  ];

  const firstResponse = await callClaude(systemPrompt, messages);
  if (!firstResponse) {
    const error = new Error("Could not generate intake message.");
    error.status = 502;
    throw error;
  }

  const cleanResponse = stripEntitiesBlock(firstResponse);
  const storedMessages = [
    ...messages,
    { role: "assistant", content: cleanResponse },
  ];

  await upsertSession({
    digits,
    phoneE164,
    leadName,
    systemPrompt,
    messages: storedMessages,
    recentMessageIds: [],
  });

  const smsResult = await sendSmsText(phoneE164, cleanResponse, digits);
  if (!smsResult.ok) {
    const error = new Error(smsResult.error || "SMS send failed");
    error.status = 502;
    throw error;
  }

  logger.info("ImginaSmsService -> SMS session started", {
    digits: `****${digits.slice(-4)}`,
  });

  return {
    ok: true,
    handled: true,
    target: "imgina",
    reason: "session_started",
  };
}

function classifyWebhookEvent(firstResult, body) {
  const eventType = inboundEventType(firstResult, body);

  if (eventType.includes("DELIVERY")) {
    return {
      ok: true,
      handled: false,
      target: "imgina",
      reason: "delivery_report",
    };
  }

  if (eventType.includes("CLICK") || firstResult?.clickedAt) {
    return {
      ok: true,
      handled: false,
      target: "imgina",
      reason: "click_event",
    };
  }

  return null;
}

function validateInboundMessage(extracted) {
  const fromDigits = normalizePhone10(extracted.from);
  const senderDigits = normalizePhone10(infobipConfig.sender);

  if (senderDigits && fromDigits && senderDigits === fromDigits) {
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "echo_skip",
      },
    };
  }

  if (!extracted.from || !extracted.text) {
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "unrecognized_inbound",
      },
    };
  }

  if (!fromDigits) {
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "invalid_phone",
      },
    };
  }

  return { fromDigits };
}

async function loadActiveSession(fromDigits) {
  const session = await ImginaSmsSession.findByPk(fromDigits);
  if (!session) {
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "no_session",
      },
    };
  }

  if (isExpired(session)) {
    await session.destroy();
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "session_expired",
      },
    };
  }

  const messages = Array.isArray(session.messages) ? [...session.messages] : [];
  if (!messages.length) {
    await session.destroy();
    return {
      result: {
        ok: true,
        handled: false,
        target: "imgina",
        reason: "corrupt_session",
      },
    };
  }

  return { session, messages };
}

function getRecentMessageIds(session) {
  return Array.isArray(session.recent_message_ids)
    ? [...session.recent_message_ids]
    : [];
}

async function continueSmsSession({
  session,
  messages,
  fromDigits,
  text,
  messageId,
}) {
  const recentMessageIds = getRecentMessageIds(session);
  if (messageId && recentMessageIds.includes(messageId)) {
    return {
      ok: true,
      handled: false,
      target: "imgina",
      reason: "duplicate_message",
    };
  }

  messages.push({ role: "user", content: text });
  const responseText = await callClaude(
    session.system_prompt || buildSmsSystemPrompt(),
    messages,
  );

  if (!responseText) {
    return {
      ok: false,
      handled: false,
      target: "imgina",
      reason: "claude_empty",
    };
  }

  const cleanResponse = stripEntitiesBlock(responseText);
  messages.push({ role: "assistant", content: cleanResponse });

  await session.update({
    messages,
    recent_message_ids: messageId
      ? [...recentMessageIds, messageId].slice(-50)
      : recentMessageIds,
    phone_e164: session.phone_e164 || toE164(fromDigits),
  });

  const smsResult = await sendSmsText(
    session.phone_e164 || toE164(fromDigits),
    cleanResponse,
    fromDigits,
  );

  if (!smsResult.ok) {
    return {
      ok: false,
      handled: false,
      target: "imgina",
      reason: "sms_send_failed",
      error: smsResult.error,
    };
  }

  return { ok: true, handled: true, target: "imgina", reason: "reply_sent" };
}

async function processInboundPayload(body) {
  const config = ensureImginaConfigured();
  if (!config.ok) {
    return {
      ok: false,
      handled: false,
      target: "imgina",
      reason: config.reason,
    };
  }

  const firstResult = firstPayloadEvent(body);
  const webhookEvent = classifyWebhookEvent(firstResult, body);
  if (webhookEvent) {
    return webhookEvent;
  }

  const extracted = extractInbound(body);
  const messageId = extractMessageId(firstResult, body);
  const validation = validateInboundMessage(extracted);
  if (validation.result) {
    return validation.result;
  }

  const { fromDigits } = validation;

  if (!acquireInboundLock(fromDigits)) {
    return {
      ok: true,
      handled: false,
      target: "imgina",
      reason: "session_locked",
    };
  }

  try {
    const activeSession = await loadActiveSession(fromDigits);
    if (activeSession.result) {
      return activeSession.result;
    }

    return await continueSmsSession({
      session: activeSession.session,
      messages: activeSession.messages,
      fromDigits,
      text: extracted.text,
      messageId,
    });
  } catch (error) {
    logger.error("ImginaSmsService -> processInboundPayload error", {
      error: error.message,
      stack: error.stack,
    });

    return {
      ok: false,
      handled: false,
      target: "imgina",
      reason: "imgina_processing_error",
      error: error.message,
    };
  } finally {
    releaseInboundLock(fromDigits);
  }
}

module.exports = {
  normalizePhone10,
  startSmsSession,
  processInboundPayload,
  processInboundPayloadToImgina: processInboundPayload,
};
