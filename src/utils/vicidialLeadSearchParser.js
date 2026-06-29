const cheerio = require("cheerio");
const logger = require("./logger");

const normalizeDigits = (value) => String(value || "").replaceAll(/\D/g, "");

function normalizeComparablePhoneDigits(value) {
  const digits = normalizeDigits(value);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function hasMatchingPhoneDigits(sourceDigits, phoneDigits) {
  if (!phoneDigits) return true;

  const comparablePhone = normalizeComparablePhoneDigits(phoneDigits);
  if (!comparablePhone) return true;

  if (sourceDigits.includes(comparablePhone)) return true;

  if (comparablePhone.length === 10) {
    return sourceDigits.includes(`1${comparablePhone}`);
  }

  if (comparablePhone.length === 11 && comparablePhone.startsWith("1")) {
    return sourceDigits.includes(comparablePhone.slice(1));
  }

  return false;
}

function extractLeadIdFromText(text) {
  const match = /lead[_\s-]?id\D*(\d{3,})/i.exec(String(text || ""));
  return match?.[1] || null;
}

function extractLeadIdFromHref(href) {
  const match = /[?&]lead_id=(\d+)/i.exec(String(href || ""));
  return match?.[1] || null;
}

function parseVicidialLeadSearch(html, phoneInput) {
  const $ = cheerio.load(String(html || ""));
  const phoneDigits = normalizeComparablePhoneDigits(phoneInput);
  const seen = new Set();
  const results = [];

  $("tr").each((_, row) => {
    const rowText = $(row).text().replaceAll(/\s+/g, " ").trim();
    if (!rowText) return;

    const rowDigits = normalizeDigits(rowText);
    if (!hasMatchingPhoneDigits(rowDigits, phoneDigits)) return;

    const rawCells = $(row)
      .find("td")
      .map((__, td) => $(td).text().replaceAll(/\s+/g, " ").trim())
      .get();
    const tds = rawCells.filter(Boolean);
    const headerCells = $(row)
      .closest("table")
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalizeHeader($(cell).text()))
      .get();
    const idxLeadId = getHeaderIndex(headerCells, ["LEAD ID", "LEAD"]);
    const idxLastAgent = getHeaderIndex(headerCells, ["LAST AGENT"]);
    const idxLastCall = getHeaderIndex(headerCells, ["LAST CALL"]);

    const firstLink = $(row).find("a[href]").first();
    const href = firstLink.attr("href") || null;

    const leadId =
      extractLeadIdFromHref(href) ||
      valueAt(rawCells, idxLeadId) ||
      extractLeadIdFromText(rowText) ||
      null;

    const key = `${leadId || "NA"}-${rowText}`;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      leadId,
      phone: phoneDigits || null,
      columns: tds,
      lastAgent: idxLastAgent >= 0 ? valueAt(rawCells, idxLastAgent) : null,
      lastCall: idxLastCall >= 0 ? valueAt(rawCells, idxLastCall) : null,
      hasLastAgentColumn: idxLastAgent >= 0,
      hasLastCallColumn: idxLastCall >= 0,
      rowText,
      link: href,
    });
  });

  // Fallback for pages where there is no table row match but lead id is visible in plain text.
  if (!results.length) {
    const bodyText = $("body").text().replaceAll(/\s+/g, " ").trim();
    const bodyDigits = normalizeDigits(bodyText);

    if (hasMatchingPhoneDigits(bodyDigits, phoneDigits)) {
      const leadId = extractLeadIdFromText(bodyText);
      if (leadId || phoneDigits) {
        results.push({
          leadId,
          phone: phoneDigits || null,
          columns: [],
          rowText: bodyText.slice(0, 500),
          link: null,
        });
      }
    }
  }

  return results;
}

function normalizeHeader(value) {
  return String(value || "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getHeaderIndex(headerCells, aliases) {
  for (const alias of aliases) {
    const index = headerCells.indexOf(alias);
    if (index >= 0) return index;
  }

  return -1;
}

function valueAt(values, index, fallbackIndex = -1) {
  if (index >= 0) return values[index] || null;
  if (fallbackIndex >= 0) return values[fallbackIndex] || null;
  return null;
}

function numberAt(values, index, fallbackIndex = -1) {
  const raw = valueAt(values, index, fallbackIndex);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVicidialUrl(rawUrl, baseUrl) {
  const vicidialConfig = require("../config/vicidial");
  const parsed = new URL(rawUrl, `${baseUrl}/`);

  if (parsed.hostname === vicidialConfig.ALLOWED_HOST) {
    if (parsed.pathname === "/recording_log_redirect.php") {
      parsed.pathname = "/admin/recording_log_redirect.php";
    }

    parsed.protocol = "https:";

    if (parsed.port === "80" || parsed.port === "443") {
      parsed.port = "";
    }
  }

  return parsed.toString();
}

function resolveLink(href) {
  if (!href) return null;

  try {
    const { ADMIN_BASE_URL } = require("../config/vicidial");
    return normalizeVicidialUrl(href, ADMIN_BASE_URL);
  } catch (error) {
    logger.warn(
      `VicidialLeadSearchParser → invalid location href: ${error.message}`,
    );
    return href;
  }
}

function resolveRecordingLocation(locationHref, locationText) {
  const resolvedHref = resolveLink(locationHref);
  const resolvedText = resolveLink(locationText);
  return resolvedHref || resolvedText || null;
}

function parseVicidialLeadRecordings(html) {
  const $ = cheerio.load(String(html || ""));
  const recordings = [];

  $("table").each((_, table) => {
    const headerCells = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalizeHeader($(cell).text()))
      .get();

    const hasRecordingHeaders =
      headerCells.includes("SECONDS") && headerCells.includes("LOCATION");

    if (!hasRecordingHeaders) return;

    const idxRowNumber = getHeaderIndex(headerCells, ["ROW", "#"]);
    const idxLeadId = getHeaderIndex(headerCells, ["LEAD ID", "LEAD", "ID"]);
    const idxDateTime = getHeaderIndex(headerCells, [
      "DATETIME",
      "DATE/TIME",
      "DATE TIME",
      "DATE",
    ]);
    const idxSeconds = getHeaderIndex(headerCells, ["SECONDS", "SEC"]);
    const idxRecId = getHeaderIndex(headerCells, [
      "REC ID",
      "RECID",
      "RECORDING ID",
    ]);
    const idxFileName = getHeaderIndex(headerCells, [
      "FILE NAME",
      "FILENAME",
      "RECORDING",
      "RECORDING FILE",
    ]);
    const idxLocation = getHeaderIndex(headerCells, [
      "LOCATION",
      "LINK",
      "URL",
    ]);
    const idxTsr = getHeaderIndex(headerCells, ["TSR", "USER", "AGENT USER"]);
    const idxAgent = getHeaderIndex(headerCells, [
      "AGENT",
      "AGENT NAME",
      "USER",
    ]);
    const idxStatus = getHeaderIndex(headerCells, [
      "STATUS",
      "SUB STATUS",
      "DISPOSITION",
      "CALL STATUS",
    ]);
    const idxMute = getHeaderIndex(headerCells, ["MUTE"]);

    const rows = $(table).find("tr").slice(1);

    rows.each((__, row) => {
      const cells = $(row).find("td");
      if (!cells.length) return;

      const values = cells
        .map((___, cell) => $(cell).text().replaceAll(/\s+/g, " ").trim())
        .get();

      if (!values.length) return;

      const locationCell = cells.eq(idxLocation >= 0 ? idxLocation : 6);
      const locationHref = locationCell.find("a[href]").attr("href") || null;
      const locationText = valueAt(values, idxLocation, 6);
      const fileName = valueAt(values, idxFileName, 5);

      recordings.push({
        rowNumber: valueAt(values, idxRowNumber, 0),
        leadId: valueAt(values, idxLeadId, 1),
        dateTime: valueAt(values, idxDateTime, 2),
        seconds: numberAt(values, idxSeconds, 3),
        recId: valueAt(values, idxRecId, 4),
        fileName,
        location: resolveRecordingLocation(locationHref, locationText),
        tsr: valueAt(values, idxTsr, 7),
        agent: valueAt(values, idxAgent, -1),
        status: valueAt(values, idxStatus, -1),
        mute: valueAt(values, idxMute, 8),
      });
    });
  });

  return recordings;
}

const LEAD_CALL_DATE_LABEL_REGEX =
  /last[\s\S]{0,12}?call[\s\S]{0,40}?(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)/gi;

function parseVicidialLeadCallDates(html) {
  const $ = cheerio.load(String(html || ""));
  const bodyText = $("body").text().replaceAll(/\s+/g, " ").trim();
  const sourceText = bodyText || String(html || "");
  const dates = [];

  let match = LEAD_CALL_DATE_LABEL_REGEX.exec(sourceText);
  while (match) {
    if (match[1]) {
      dates.push(match[1]);
    }
    match = LEAD_CALL_DATE_LABEL_REGEX.exec(sourceText);
  }

  return [...new Set(dates)];
}

function parseVicidialLeadDetailAttempts(html, fallbackLeadId = null) {
  const $ = cheerio.load(String(html || ""));
  const attempts = [];
  const resolvedFallbackLeadId =
    fallbackLeadId ||
    extractLeadIdFromText($("body").text().replaceAll(/\s+/g, " ").trim());

  $("table").each((_, table) => {
    const headerCells = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalizeHeader($(cell).text()))
      .get();

    const idxDateTime = getHeaderIndex(headerCells, [
      "DATE/TIME",
      "DATETIME",
      "DATE TIME",
      "DATE",
      "PARK TIME",
      "GRAB TIME",
    ]);
    const idxTsr = getHeaderIndex(headerCells, ["TSR", "USER", "AGENT"]);
    const idxLead = getHeaderIndex(headerCells, ["LEAD", "LEAD ID"]);

    if (idxDateTime < 0 || idxTsr < 0) return;

    const isCallTable =
      headerCells.includes("LENGTH") ||
      headerCells.includes("TALK") ||
      headerCells.includes("PARK TIME") ||
      headerCells.includes("GRAB TIME");

    if (!isCallTable) return;

    const idxStatus = getHeaderIndex(headerCells, ["STATUS", "DISPOSITION"]);
    const idxCampaign = getHeaderIndex(headerCells, ["CAMPAIGN"]);
    const idxPhone = getHeaderIndex(headerCells, ["PHONE", "PHONE NUMBER"]);

    $(table)
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const values = $(row)
          .find("td")
          .map((___, cell) => $(cell).text().replaceAll(/\s+/g, " ").trim())
          .get();

        const dateTime = valueAt(values, idxDateTime);
        const agentName = valueAt(values, idxTsr);
        const leadId = valueAt(values, idxLead) || resolvedFallbackLeadId;

        if (!dateTime || !agentName || !leadId) return;

        attempts.push({
          dateTime,
          agentName,
          leadId,
          status: valueAt(values, idxStatus),
          campaign: valueAt(values, idxCampaign),
          phone: valueAt(values, idxPhone),
        });
      });
  });

  return attempts;
}

function parseVicidialLeadFirstAgentLogAttempt(html, fallbackLeadId = null) {
  const $ = cheerio.load(String(html || ""));
  const resolvedFallbackLeadId =
    fallbackLeadId ||
    extractLeadIdFromText($("body").text().replaceAll(/\s+/g, " ").trim());

  let firstAttempt = null;

  $("table").each((_, table) => {
    if (firstAttempt) return;

    const headerCells = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalizeHeader($(cell).text()))
      .get();

    const idxDateTime = getHeaderIndex(headerCells, [
      "DATE/TIME",
      "DATETIME",
      "DATE TIME",
      "DATE",
    ]);
    const idxTsr = getHeaderIndex(headerCells, ["TSR"]);
    const isAgentLogTable =
      idxDateTime >= 0 &&
      idxTsr >= 0 &&
      headerCells.includes("PAUSE") &&
      headerCells.includes("WAIT") &&
      headerCells.includes("TALK") &&
      headerCells.includes("DISPO");

    if (!isAgentLogTable) return;

    const firstRowValues = $(table)
      .find("tr")
      .slice(1)
      .first()
      .find("td")
      .map((__, cell) => $(cell).text().replaceAll(/\s+/g, " ").trim())
      .get();

    const dateTime = valueAt(firstRowValues, idxDateTime);
    const agentName = valueAt(firstRowValues, idxTsr);

    if (!dateTime && !agentName) return;

    firstAttempt = {
      dateTime,
      agentName,
      leadId: resolvedFallbackLeadId,
    };
  });

  return firstAttempt;
}

module.exports = {
  parseVicidialLeadSearch,
  parseVicidialLeadRecordings,
  parseVicidialLeadCallDates,
  parseVicidialLeadDetailAttempts,
  parseVicidialLeadFirstAgentLogAttempt,
  normalizeDigits,
  normalizeComparablePhoneDigits,
};
