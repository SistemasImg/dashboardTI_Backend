const axios = require("axios");
const crypto = require("node:crypto");
const logger = require("../../utils/logger");
const mailchimpConfig = require("../../config/mailchimp");
const SYNC_BATCH_SIZE = 25;

// Validate minimum Mailchimp configuration required to run API operations.
function isConfigured() {
  return Boolean(
    mailchimpConfig.apiKey &&
    mailchimpConfig.serverPrefix &&
    mailchimpConfig.audienceId,
  );
}

// Build Mailchimp REST base URL using the account datacenter prefix.
function buildBaseUrl() {
  return `https://${mailchimpConfig.serverPrefix}.api.mailchimp.com/3.0`;
}

// Build Basic auth header expected by Mailchimp API.
function buildAuthHeader() {
  const token = Buffer.from(`x:${mailchimpConfig.apiKey}`).toString("base64");
  return `Basic ${token}`;
}

// Build contact tags for date, group and selected case types.
function buildTags(types, groupTag) {
  const dateTag = `DATE:${new Date().toISOString().slice(0, 10)}`;
  const typeTags = (types || []).map((item) => `TYPE:${item}`);

  return [dateTag, `GROUP:${groupTag}`, ...typeTags].map((name) => ({
    name,
    status: "active",
  }));
}

// Sanitize, deduplicate and normalize contact input list.
function normalizeContacts(records) {
  const seen = new Set();
  const cleaned = [];

  for (const row of records || []) {
    const email = String(row.email || "")
      .trim()
      .toLowerCase();
    if (!email?.includes("@")) continue;
    if (seen.has(email)) continue;

    seen.add(email);
    cleaned.push({
      email,
      firstName: String(row.firstName || "").trim(),
      lastName: String(row.lastName || "").trim(),
    });
  }

  return cleaned;
}

// Generate Mailchimp member hash from lowercase email.
function subscriberHash(email) {
  return crypto.createHash("md5").update(email.toLowerCase()).digest("hex");
}

// Execute a generic Mailchimp API request.
async function callMailchimp(method, path, data) {
  const response = await axios({
    method,
    url: `${buildBaseUrl()}${path}`,
    headers: {
      Authorization: buildAuthHeader(),
      "Content-Type": "application/json",
    },
    data,
    timeout: 30000,
  });

  return response.data;
}

// Create or update a list member by email.
async function upsertMember(contact) {
  const hash = subscriberHash(contact.email);
  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const firstNameTagValue = mailchimpConfig.useFullNameInFirstNameTag
    ? fullName || contact.firstName
    : contact.firstName;
  const mergeFields = {
    [mailchimpConfig.firstNameMergeTag]: firstNameTagValue,
    [mailchimpConfig.lastNameMergeTag]: contact.lastName,
  };

  await callMailchimp(
    "put",
    `/lists/${mailchimpConfig.audienceId}/members/${hash}`,
    {
      email_address: contact.email,
      status_if_new: "subscribed",
      merge_fields: mergeFields,
    },
  );

  return hash;
}

// Attach a list of tags to an existing member.
async function tagMember(hash, tags) {
  await callMailchimp(
    "post",
    `/lists/${mailchimpConfig.audienceId}/members/${hash}/tags`,
    { tags },
  );
}

// Create a static segment with the synced email list.
async function createStaticSegment(name, emails) {
  const created = await callMailchimp(
    "post",
    `/lists/${mailchimpConfig.audienceId}/segments`,
    {
      name,
      static_segment: emails,
    },
  );

  return created.id;
}

// Apply inline HTML content to the campaign.
async function applyInlineContent(campaignId, html, plainText) {
  await callMailchimp("put", `/campaigns/${campaignId}/content`, {
    html,
    plain_text: plainText,
  });
}

// Split large arrays into smaller batches to keep API calls stable.
function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

// Sync contacts in batches and collect successes/failures.
async function syncContactsWithTags(contacts, tags) {
  const synced = [];
  const failed = [];
  const batches = chunkArray(contacts, SYNC_BATCH_SIZE);

  for (const batch of batches) {
    const settled = await Promise.allSettled(
      batch.map(async (contact) => {
        const hash = await upsertMember(contact);
        await tagMember(hash, tags);
        return contact.email;
      }),
    );

    settled.forEach((item, index) => {
      const contact = batch[index];

      if (item.status === "fulfilled") {
        synced.push(item.value);
        return;
      }

      const reason = item.reason;
      failed.push({
        email: contact.email,
        message: reason.response?.data?.detail || reason.message,
      });
    });
  }

  return { synced, failed };
}

// Create campaign, assign inline content and send immediately.
async function createCampaign({
  segmentId,
  title,
  htmlContent,
  plainTextContent,
}) {
  const campaign = await callMailchimp("post", "/campaigns", {
    type: "regular",
    recipients: {
      list_id: mailchimpConfig.audienceId,
      segment_opts: {
        saved_segment_id: segmentId,
      },
    },
    settings: {
      title,
      from_name: mailchimpConfig.fromName,
      reply_to: mailchimpConfig.fromEmail,
      subject_line: mailchimpConfig.subject,
      preview_text: mailchimpConfig.previewText,
    },
  });

  await applyInlineContent(campaign.id, htmlContent, plainTextContent);
  await callMailchimp("post", `/campaigns/${campaign.id}/actions/send`);

  return campaign.id;
}

// Sync one audience group and dispatch its campaign.
async function processGroup({
  groupName,
  contacts,
  htmlContent,
  plainTextContent,
  types,
}) {
  if (!htmlContent) {
    return {
      group: groupName,
      status: "skipped",
      reason: `Missing inline html for ${groupName}`,
      contacts: 0,
    };
  }

  const normalizedContacts = normalizeContacts(contacts);
  if (!normalizedContacts.length) {
    return {
      group: groupName,
      status: "skipped",
      reason: "No valid contacts",
      contacts: 0,
    };
  }

  const tags = buildTags(types, groupName.toUpperCase());
  const { synced, failed } = await syncContactsWithTags(
    normalizedContacts,
    tags,
  );

  if (!synced.length) {
    return {
      group: groupName,
      status: "failed",
      reason: "No contacts were synced",
      contacts: normalizedContacts.length,
      failed,
    };
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const groupLabel =
    groupName.charAt(0).toUpperCase() + groupName.slice(1).toLowerCase();
  const typesLabel = (types || []).join(" ");
  const segmentName = `${groupLabel} ${typesLabel} - ${dateLabel}`;
  const segmentId = await createStaticSegment(segmentName, synced);
  const campaignId = await createCampaign({
    segmentId,
    title: segmentName,
    htmlContent,
    plainTextContent,
  });

  return {
    group: groupName,
    status: "sent",
    total: normalizedContacts.length,
    sent: synced.length,
    failed: failed.length,
    failedDetails: failed,
    types,
    trackingLabel: segmentName,
    campaignId,
    segmentId,
  };
}

// Main Mailchimp workflow for pending and unresponsive groups.
async function dispatchAudienceToMailchimp({
  pendingContacts,
  unresponsiveContacts,
  types,
}) {
  logger.info("MailchimpService → dispatchAudienceToMailchimp() started");

  if (!isConfigured()) {
    logger.warn("MailchimpService → skipped: missing configuration");

    return {
      status: "skipped",
      reason:
        "MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX y MAILCHIMP_AUDIENCE_ID son requeridos",
    };
  }

  const pending =
    pendingContacts.length > 0
      ? await processGroup({
          groupName: "pending",
          contacts: pendingContacts,
          htmlContent: mailchimpConfig.pendingInlineHtml,
          plainTextContent: mailchimpConfig.pendingInlinePlainText,
          types,
        })
      : { group: "pending", status: "disabled", reason: "Group not selected" };

  const unresponsive =
    unresponsiveContacts.length > 0
      ? await processGroup({
          groupName: "unresponsive",
          contacts: unresponsiveContacts,
          htmlContent: mailchimpConfig.unresponsiveInlineHtml,
          plainTextContent: mailchimpConfig.unresponsiveInlinePlainText,
          types,
        })
      : {
          group: "unresponsive",
          status: "disabled",
          reason: "Group not selected",
        };

  const result = {
    status: "processed",
    pending,
    unresponsive,
  };

  logger.success("MailchimpService → dispatchAudienceToMailchimp() finished");

  return result;
}

module.exports = {
  dispatchAudienceToMailchimp,
};
