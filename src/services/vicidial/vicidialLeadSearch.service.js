const axios = require("axios");
const logger = require("../../utils/logger");
const {
  parseVicidialLeadSearch,
  parseVicidialLeadRecordings,
  normalizeDigits,
} = require("../../utils/vicidialLeadSearchParser");

const SEARCH_URL = "https://img.integradial.us/admin/admin_search_lead.php";
const LEAD_DETAIL_URL =
  "https://img.integradial.us/admin/admin_modify_lead.php";

function getVicidialHeaders() {
  const username = process.env.VICIDIAL_USER;
  const password = process.env.VICIDIAL_PASS;

  const token = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    Authorization: `Basic ${token}`,
    "User-Agent": "Mozilla/5.0",
    Referer: "https://img.integradial.us/admin/",
    Origin: "https://img.integradial.us",
  };
}

function buildSearchPayload(phone) {
  return {
    phone,
    phone_number: phone,
    search_phone: phone,
    search_phone_number: phone,
    search_query: phone,
    query: phone,
    term: phone,
    lead_phone: phone,
    lead_phone_number: phone,
  };
}

async function requestVicidialLeadSearch(phone) {
  const params = buildSearchPayload(phone);
  const headers = getVicidialHeaders();

  const [getResult, postResult] = await Promise.allSettled([
    axios.get(SEARCH_URL, {
      headers,
      params,
      timeout: 30000,
    }),
    axios.post(SEARCH_URL, new URLSearchParams(params), {
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 30000,
    }),
  ]);

  const htmlCandidates = [getResult, postResult]
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value?.data)
    .filter(Boolean);

  if (!htmlCandidates.length) {
    let firstError = new Error("Vicidial search failed");

    if (getResult.status === "rejected") {
      firstError = getResult.reason;
    } else if (postResult.status === "rejected") {
      firstError = postResult.reason;
    }

    throw firstError;
  }

  return htmlCandidates;
}

async function requestVicidialLeadDetail(leadId) {
  const headers = getVicidialHeaders();

  const response = await axios.get(LEAD_DETAIL_URL, {
    headers,
    params: {
      lead_id: leadId,
    },
    timeout: 30000,
  });

  return response.data;
}

async function enrichLeadWithRecordings(record) {
  if (!record?.leadId) {
    return {
      ...record,
      recordingsTotal: 0,
      durationSeconds: null,
      location: null,
      recordings: [],
    };
  }

  try {
    const detailHtml = await requestVicidialLeadDetail(record.leadId);
    const recordings = parseVicidialLeadRecordings(detailHtml);
    const latestRecording = recordings[0] || null;

    return {
      ...record,
      recordingsTotal: recordings.length,
      durationSeconds: latestRecording?.seconds ?? null,
      location: latestRecording?.location ?? null,
      recordings,
    };
  } catch (error) {
    logger.warn(
      `VicidialLeadSearchService → recording detail unavailable for lead ${record.leadId}: ${error.message}`,
    );

    return {
      ...record,
      recordingsTotal: 0,
      durationSeconds: null,
      location: null,
      recordings: [],
    };
  }
}

async function searchVicidialLeadByPhone(phone) {
  const phoneDigits = normalizeDigits(phone);

  if (!phoneDigits) {
    throw Object.assign(new Error("phone is required"), { statusCode: 400 });
  }

  logger.info(`VicidialLeadSearchService → search by phone: ${phoneDigits}`);

  const htmlResponses = await requestVicidialLeadSearch(phoneDigits);

  const merged = [];
  const seen = new Set();

  htmlResponses.forEach((html) => {
    const parsed = parseVicidialLeadSearch(html, phoneDigits);
    parsed.forEach((item) => {
      const key = `${item.leadId || "NA"}-${item.rowText}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });

  logger.success(
    `VicidialLeadSearchService → found ${merged.length} possible matches for ${phoneDigits}`,
  );

  const enrichedRecords = await Promise.all(
    merged.map((item) => enrichLeadWithRecordings(item)),
  );
  const filteredRecords = enrichedRecords.filter(
    (item) => Array.isArray(item.recordings) && item.recordings.length > 0,
  );

  return {
    phone: phoneDigits,
    total: filteredRecords.length,
    records: filteredRecords,
  };
}

module.exports = {
  searchVicidialLeadByPhone,
};
