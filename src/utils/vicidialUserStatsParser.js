const cheerio = require("cheerio");
const { DateTime } = require("luxon");

const OUTBOUND_SECTION_TITLE = /OUTBOUND CALLS FOR THIS TIME PERIOD/i;
const OTHER_SECTION_TITLE = /CALLS FOR THIS TIME PERIOD/i;
const ISO_DATE_TIME_REGEX = /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\b/g;
const SLASH_DATE_TIME_REGEX =
  /\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapm]{2})?\b/g;
const OUTBOUND_ROW_START_REGEX =
  /(?:^|\s)\d+\s*-\s*\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?/g;

function normalizeSpaces(value) {
  return String(value || "")
    .replaceAll("\u00a0", " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  return null;
}

function extractPhoneFromText(value) {
  const text = String(value || "")
    .replace(ISO_DATE_TIME_REGEX, " ")
    .replace(SLASH_DATE_TIME_REGEX, " ");
  const phonePatterns = [
    /\b(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g,
    /\b1?\d{10}\b/g,
  ];

  const matches = [];
  phonePatterns.forEach((pattern) => {
    let match = pattern.exec(text);

    while (match) {
      matches.push(match[0]);
      match = pattern.exec(text);
    }
  });

  for (const match of matches) {
    const normalized = normalizePhone(match);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractDateCandidates(value) {
  const text = normalizeSpaces(value);
  const matches = [];

  [ISO_DATE_TIME_REGEX, SLASH_DATE_TIME_REGEX].forEach((pattern) => {
    let match = pattern.exec(text);

    while (match) {
      matches.push(match[0]);
      match = pattern.exec(text);
    }
  });

  return [...new Set(matches)];
}

function parseDateTime(value, zone) {
  const normalized = normalizeSpaces(value);
  if (!normalized) return null;

  const candidates = [
    DateTime.fromFormat(normalized, "yyyy-LL-dd HH:mm:ss", { zone }),
    DateTime.fromFormat(normalized, "yyyy-LL-dd HH:mm", { zone }),
    DateTime.fromFormat(normalized, "L/d/yyyy h:mm:ss a", { zone }),
    DateTime.fromFormat(normalized, "L/d/yyyy h:mm a", { zone }),
    DateTime.fromFormat(normalized, "LL/dd/yyyy hh:mm:ss a", { zone }),
    DateTime.fromFormat(normalized, "LL/dd/yyyy hh:mm a", { zone }),
    DateTime.fromISO(normalized, { zone }),
  ];

  return candidates.find((item) => item.isValid) || null;
}

function extractDateTimeFromCells(cells, zone) {
  for (const cell of cells) {
    const matches = extractDateCandidates(cell);

    for (const match of matches) {
      const parsed = parseDateTime(match, zone);
      if (parsed?.isValid) {
        return parsed;
      }
    }
  }

  return null;
}

function extractRowsFromTable($, table, reportUser, zone) {
  const rows = [];
  const seen = new Set();

  $(table)
    .find("tr")
    .each((_, row) => {
      const cells = $(row)
        .find("th, td")
        .map((__, cell) => normalizeSpaces($(cell).text()))
        .get()
        .filter(Boolean);

      if (cells.length < 2) {
        return;
      }

      const rowText = normalizeSpaces(cells.join(" | "));
      if (!rowText || OUTBOUND_SECTION_TITLE.test(rowText)) {
        return;
      }

      const phoneNumber = cells
        .map((cell) => extractPhoneFromText(cell))
        .find(Boolean);
      const dateTime = extractDateTimeFromCells(cells, zone);

      if (!phoneNumber || !dateTime?.isValid) {
        return;
      }

      const key = `${phoneNumber}-${dateTime.toISO()}-${reportUser}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      rows.push({
        phoneNumber,
        dateTime,
        agentName: reportUser,
        source: "vicidial_user_stats",
        rowText,
      });
    });

  return rows;
}

function buildUserStatsEntryBlocks(text) {
  const sourceText = normalizeSpaces(text);
  const starts = [...sourceText.matchAll(OUTBOUND_ROW_START_REGEX)].map(
    (match) => match.index + (match[0].startsWith(" ") ? 1 : 0),
  );

  return starts.map((start, index) => {
    const nextStart = starts[index + 1] || sourceText.length;
    return sourceText.slice(start, nextStart).trim();
  });
}

function buildGenericDatePhoneBlocks(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(
      (line) =>
        extractDateCandidates(line).length > 0 && extractPhoneFromText(line),
    );
}

function extractRowsFromText(text, reportUser, zone) {
  const rows = [];
  const seen = new Set();
  const blocks = [
    ...buildUserStatsEntryBlocks(text),
    ...buildGenericDatePhoneBlocks(text),
  ];

  blocks.forEach((block) => {
    const dateTime = extractDateTimeFromCells([block], zone);
    const phoneNumber = extractPhoneFromText(block);

    if (!phoneNumber || !dateTime?.isValid) {
      return;
    }

    const key = `${phoneNumber}-${dateTime.toISO()}-${reportUser}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    rows.push({
      phoneNumber,
      dateTime,
      agentName: reportUser,
      source: "vicidial_user_stats",
      rowText: block,
    });
  });

  return rows;
}

function collectCandidateTables($) {
  const tables = [];
  const seen = new Set();

  function addTable(table) {
    if (!table) return;
    const html = $.html(table);
    if (!html || seen.has(html)) return;
    seen.add(html);
    tables.push(table);
  }

  $("body *")
    .filter((_, element) =>
      OUTBOUND_SECTION_TITLE.test(normalizeSpaces($(element).text())),
    )
    .each((_, element) => {
      const table = $(element).nextAll("table").first();
      const tableText = normalizeSpaces(table.text());

      if (
        table.length &&
        (!OTHER_SECTION_TITLE.test(tableText) ||
          OUTBOUND_SECTION_TITLE.test(tableText))
      ) {
        addTable(table.get(0));
      }
    });

  if (!tables.length) {
    $("table").each((_, table) => {
      const tableText = normalizeSpaces($(table).text());
      if (OUTBOUND_SECTION_TITLE.test(tableText)) {
        addTable(table);
      }
    });
  }

  return tables;
}

function parseVicidialUserStatsOutboundCalls(html, { reportUser, zone }) {
  const $ = cheerio.load(String(html || ""));
  const tables = collectCandidateTables($);
  const rows = tables.flatMap((table) =>
    extractRowsFromTable($, table, reportUser, zone),
  );
  const textRows = extractRowsFromText(
    $("body").text() || String(html || ""),
    reportUser,
    zone,
  );
  const seen = new Set();

  return [...rows, ...textRows].filter((row) => {
    const key = `${row.phoneNumber}-${row.dateTime.toISO()}-${row.agentName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  extractPhoneFromText,
  parseVicidialUserStatsOutboundCalls,
};
