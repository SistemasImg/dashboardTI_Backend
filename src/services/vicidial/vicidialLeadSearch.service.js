const axios = require("axios");
const logger = require("../../utils/logger");
const vicidialConfig = require("../../config/vicidial");
const {
  parseVicidialLeadSearch,
  parseVicidialLeadRecordings,
  normalizeComparablePhoneDigits,
} = require("../../utils/vicidialLeadSearchParser");
const {
  resolveRecordingAccessUrl,
} = require("./vicidialRecordingsDownload.service");

const SEARCH_URL = `${vicidialConfig.ADMIN_BASE_URL}/admin_search_lead.php`;
const LEAD_DETAIL_URL = `${vicidialConfig.ADMIN_BASE_URL}/admin_modify_lead.php`;

function classifyRecordingResolutionError(error) {
  const message = String(error?.message || "");

  if (message.includes("URL host is not allowed")) {
    return "host_not_allowed";
  }

  if (
    message.includes("Unable to extract audio URL from Vicidial HTML response")
  ) {
    return "html_without_audio_url";
  }

  if (message.includes("Invalid url")) {
    return "invalid_url";
  }

  return "unexpected";
}

function registerResolutionIssue(stats, reason) {
  stats.total += 1;
  stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
}

function formatResolutionIssueSummary(stats) {
  return Object.entries(stats.byReason)
    .map(([reason, total]) => `${reason}=${total}`)
    .join(", ");
}

function getVicidialHeaders() {
  const username = process.env.VICIDIAL_USER;
  const password = process.env.VICIDIAL_PASS;

  const token = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    Authorization: `Basic ${token}`,
    "User-Agent": "Mozilla/5.0",
    Referer: `${vicidialConfig.ADMIN_BASE_URL}/`,
    Origin: vicidialConfig.ORIGIN,
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

function buildPhoneSearchVariants(phone) {
  const phoneDigits = normalizeComparablePhoneDigits(phone);

  if (!phoneDigits) return [];
  if (phoneDigits.length !== 10) return [phoneDigits];

  const areaCode = phoneDigits.slice(0, 3);
  const prefix = phoneDigits.slice(3, 6);
  const lineNumber = phoneDigits.slice(6);

  return [
    phoneDigits,
    `1${phoneDigits}`,
    `${areaCode}${prefix}-${lineNumber}`,
    `(${areaCode}) ${prefix}-${lineNumber}`,
    `${areaCode}-${prefix}-${lineNumber}`,
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function mergeLeadSearchResults(htmlResponsesByVariant, phoneDigits) {
  const merged = [];
  const seen = new Set();

  htmlResponsesByVariant.forEach(({ htmlResponses }) => {
    htmlResponses.forEach((html) => {
      const parsed = parseVicidialLeadSearch(html, phoneDigits);
      parsed.forEach((item) => {
        const key = `${item.leadId || "NA"}-${item.rowText}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
    });
  });

  return merged;
}

async function requestVicidialLeadSearch(phone, options = {}) {
  const params = buildSearchPayload(phone);
  const headers = getVicidialHeaders();
  const timeout =
    Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

  const [getResult, postResult] = await Promise.allSettled([
    axios.get(SEARCH_URL, {
      headers,
      params,
      timeout,
    }),
    axios.post(SEARCH_URL, new URLSearchParams(params), {
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout,
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

async function requestVicidialLeadDetail(leadId, options = {}) {
  const headers = getVicidialHeaders();
  const timeout =
    Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

  const response = await axios.get(LEAD_DETAIL_URL, {
    headers,
    params: {
      lead_id: leadId,
    },
    timeout,
  });

  return response.data;
}

async function resolveRecordingLocation(recording, resolutionStats) {
  if (!recording?.location) {
    return recording;
  }

  try {
    const resolvedLocation = await resolveRecordingAccessUrl(
      recording.location,
      { suppressWarnings: true },
    );
    return {
      ...recording,
      location: resolvedLocation,
    };
  } catch (error) {
    const reason = classifyRecordingResolutionError(error);

    if (reason === "unexpected") {
      logger.warn(
        `VicidialLeadSearchService → unable to resolve direct recording URL for recId ${recording.recId || "unknown"}: ${error.message}`,
      );
    } else {
      registerResolutionIssue(resolutionStats, reason);
    }

    return recording;
  }
}

async function enrichLeadWithRecordings(record, resolutionStats, options = {}) {
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
    const detailHtml = await requestVicidialLeadDetail(record.leadId, options);
    const parsedRecordings = parseVicidialLeadRecordings(detailHtml);
    const shouldResolveRecordingLocations =
      options.resolveRecordingLocations !== false;
    const recordings = shouldResolveRecordingLocations
      ? await Promise.all(
          parsedRecordings.map((item) =>
            resolveRecordingLocation(item, resolutionStats),
          ),
        )
      : parsedRecordings;
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

async function searchVicidialLeadByPhone(phone, options = {}) {
  const phoneDigits = normalizeComparablePhoneDigits(phone);

  if (!phoneDigits) {
    throw Object.assign(new Error("phone is required"), { statusCode: 400 });
  }

  logger.info(`VicidialLeadSearchService → search by phone: ${phoneDigits}`);

  const searchVariants = buildPhoneSearchVariants(phoneDigits);
  const primaryVariant = searchVariants[0];
  const htmlResponsesByVariant = [
    {
      variant: primaryVariant,
      htmlResponses: await requestVicidialLeadSearch(primaryVariant, options),
    },
  ];
  let merged = mergeLeadSearchResults(htmlResponsesByVariant, phoneDigits);

  if (!merged.length && searchVariants.length > 1) {
    const fallbackVariants = searchVariants.slice(1);

    logger.info(
      `VicidialLeadSearchService → retrying phone search with formatted variants for ${phoneDigits}: ${fallbackVariants.join(", ")}`,
    );

    const fallbackResults = await Promise.allSettled(
      fallbackVariants.map(async (variant) => ({
        variant,
        htmlResponses: await requestVicidialLeadSearch(variant, options),
      })),
    );

    fallbackResults.forEach((result) => {
      if (result.status === "fulfilled") {
        htmlResponsesByVariant.push(result.value);
        return;
      }

      logger.warn(
        `VicidialLeadSearchService → formatted phone variant lookup failed for ${phoneDigits}: ${result.reason?.message || result.reason}`,
      );
    });

    merged = mergeLeadSearchResults(htmlResponsesByVariant, phoneDigits);
  }

  logger.success(
    `VicidialLeadSearchService → found ${merged.length} possible matches for ${phoneDigits}`,
  );

  const resolutionStats = {
    total: 0,
    byReason: {},
  };

  const enrichedRecords = await Promise.all(
    merged.map((item) =>
      enrichLeadWithRecordings(item, resolutionStats, options),
    ),
  );
  const filteredRecords = enrichedRecords.filter(
    (item) => Array.isArray(item.recordings) && item.recordings.length > 0,
  );

  if (
    options.resolveRecordingLocations !== false &&
    resolutionStats.total > 0
  ) {
    logger.info(
      `VicidialLeadSearchService → kept original recording URLs for ${resolutionStats.total} recordings (${formatResolutionIssueSummary(resolutionStats)})`,
    );
  }

  return {
    phone: phoneDigits,
    total: filteredRecords.length,
    records: filteredRecords,
  };
}

module.exports = {
  searchVicidialLeadByPhone,
};
