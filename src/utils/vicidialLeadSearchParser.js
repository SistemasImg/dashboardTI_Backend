const cheerio = require("cheerio");
const logger = require("./logger");

const normalizeDigits = (value) => String(value || "").replaceAll(/\D/g, "");

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
  const phoneDigits = normalizeDigits(phoneInput);
  const seen = new Set();
  const results = [];

  $("tr").each((_, row) => {
    const rowText = $(row).text().replaceAll(/\s+/g, " ").trim();
    if (!rowText) return;

    const rowDigits = normalizeDigits(rowText);
    if (phoneDigits && !rowDigits.includes(phoneDigits)) return;

    const tds = $(row)
      .find("td")
      .map((__, td) => $(td).text().replaceAll(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);

    const firstLink = $(row).find("a[href]").first();
    const href = firstLink.attr("href") || null;

    const leadId =
      extractLeadIdFromHref(href) || extractLeadIdFromText(rowText) || null;

    const key = `${leadId || "NA"}-${rowText}`;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      leadId,
      phone: phoneDigits || null,
      columns: tds,
      rowText,
      link: href,
    });
  });

  // Fallback for pages where there is no table row match but lead id is visible in plain text.
  if (!results.length) {
    const bodyText = $("body").text().replaceAll(/\s+/g, " ").trim();
    const bodyDigits = normalizeDigits(bodyText);

    if (!phoneDigits || bodyDigits.includes(phoneDigits)) {
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

function resolveLink(href) {
  if (!href) return null;

  try {
    const { ADMIN_BASE_URL } = require("../config/vicidial");
    return new URL(href, `${ADMIN_BASE_URL}/`).toString();
  } catch (error) {
    logger.warn(
      `VicidialLeadSearchParser → invalid location href: ${error.message}`,
    );
    return href;
  }
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

      recordings.push({
        rowNumber: valueAt(values, idxRowNumber, 0),
        leadId: valueAt(values, idxLeadId, 1),
        dateTime: valueAt(values, idxDateTime, 2),
        seconds: numberAt(values, idxSeconds, 3),
        recId: valueAt(values, idxRecId, 4),
        fileName: valueAt(values, idxFileName, 5),
        location: resolveLink(locationHref) || valueAt(values, idxLocation, 6),
        tsr: valueAt(values, idxTsr, 7),
        agent: valueAt(values, idxAgent, -1),
        status: valueAt(values, idxStatus, -1),
        mute: valueAt(values, idxMute, 8),
      });
    });
  });

  return recordings;
}

module.exports = {
  parseVicidialLeadSearch,
  parseVicidialLeadRecordings,
  normalizeDigits,
};
