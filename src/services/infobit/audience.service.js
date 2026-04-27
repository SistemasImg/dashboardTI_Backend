const axios = require("axios");
const https = require("node:https");
const logger = require("../../utils/logger");
const infobipConfig = require("../../config/infobip");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const SEND_BATCH_SIZE = 50;

function buildHeaders() {
  return {
    Authorization: infobipConfig.apiKey,
    "Content-Type": "application/json",
  };
}

function normalizeUsPhone(phone) {
  const digits = String(phone || "").replaceAll(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);

  return "";
}

function toE164(phone) {
  const normalized = normalizeUsPhone(phone);
  return normalized ? `+1${normalized}` : "";
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getPendingMessage(firstName = "there") {
  return `Hi ${firstName},\nWe recently attempted to reach you by phone but were unable to connect.\nBased on the information you provided, you may pre-qualify for compensation and legal help. However, we need to speak with you directly first to complete the process. If so, please call ${infobipConfig.phoneLine}\nOne of our legal advisors will be calling you soon to speak with you completely confidential.\n\nWe are here to help you!\nYou can also click below to book the best time to reach you.\n${infobipConfig.bookingUrl}`;
}

function getUnresponsiveMessage(firstName = "there") {
  return `Hi ${firstName}, there's only one step left to move forward with your claim!\nWe'll be reaching out shortly, but if you're ready, you can call us now at ${infobipConfig.phoneLine} to finish your process.\nWe are here to help you!\nYou can also click below to book the best time to reach you.\n${infobipConfig.bookingUrl}`;
}

function normalizeContacts(records) {
  const seen = new Set();
  const contacts = [];

  for (const row of records || []) {
    const to = toE164(row.phoneNumber);
    if (!to) continue;
    if (seen.has(to)) continue;

    seen.add(to);
    contacts.push({
      to,
      firstName: String(row.firstName || "").trim(),
    });
  }

  return contacts;
}

async function sendBatch(messages) {
  const { data } = await axios.post(
    `${infobipConfig.baseUrl}/sms/3/messages`,
    { messages },
    {
      headers: buildHeaders(),
      httpsAgent,
      timeout: 30000,
    },
  );

  return Array.isArray(data?.messages) ? data.messages : [];
}

async function sendGroup({ groupName, contacts, messageBuilder }) {
  const normalizedContacts = normalizeContacts(contacts);

  if (!normalizedContacts.length) {
    return {
      group: groupName,
      status: "skipped",
      reason: "No valid phone numbers",
      contacts: 0,
    };
  }

  const batches = chunkArray(normalizedContacts, SEND_BATCH_SIZE);
  const failed = [];
  let accepted = 0;

  for (const batch of batches) {
    const payloadMessages = batch.map((contact) => ({
      from: infobipConfig.sender,
      destinations: [{ to: contact.to }],
      content: {
        text: messageBuilder(contact.firstName),
      },
    }));

    try {
      const providerMessages = await sendBatch(payloadMessages);
      accepted += providerMessages.length;

      if (providerMessages.length !== payloadMessages.length) {
        failed.push({
          message:
            "Provider accepted fewer messages than requested in at least one batch",
        });
      }
    } catch (error) {
      failed.push({
        message:
          error.response?.data?.requestError?.serviceException?.text ||
          error.message,
      });
    }
  }

  return {
    group: groupName,
    status: accepted ? "sent" : "failed",
    total: normalizedContacts.length,
    sent: accepted,
    failed: failed.length,
    failedDetails: failed,
  };
}

async function dispatchAudienceToInfobip({
  pendingContacts,
  unresponsiveContacts,
  types,
}) {
  logger.info("InfobipAudienceService → dispatchAudienceToInfobip() started");

  if (!infobipConfig.apiKey || !infobipConfig.sender) {
    return {
      status: "skipped",
      reason: "INFOBIP_API_KEY y INFOBIP_SENDER son requeridos",
    };
  }

  if (!infobipConfig.phoneLine || !infobipConfig.bookingUrl) {
    return {
      status: "skipped",
      reason: "INFOBIP_CALL_PHONE y INFOBIP_BOOKING_URL son requeridos",
    };
  }

  const pending =
    pendingContacts.length > 0
      ? await sendGroup({
          groupName: "pending",
          contacts: pendingContacts,
          messageBuilder: getPendingMessage,
        })
      : { group: "pending", status: "disabled", reason: "Group not selected" };

  pending.types = types;
  pending.trackingLabel = "PENDING";

  const unresponsive =
    unresponsiveContacts.length > 0
      ? await sendGroup({
          groupName: "unresponsive",
          contacts: unresponsiveContacts,
          messageBuilder: getUnresponsiveMessage,
        })
      : {
          group: "unresponsive",
          status: "disabled",
          reason: "Group not selected",
        };

  unresponsive.types = types;
  unresponsive.trackingLabel = "UNRESPONSIVE";

  logger.success(
    "InfobipAudienceService → dispatchAudienceToInfobip() finished",
  );

  return {
    status: "processed",
    pending,
    unresponsive,
  };
}

module.exports = {
  dispatchAudienceToInfobip,
};
