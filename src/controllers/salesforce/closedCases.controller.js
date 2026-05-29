const {
  getClosedCasesReport,
} = require("../../services/salesforce/closedCases.service");
const logger = require("../../utils/logger");

/**
 * GET /salesforce/closed-cases?date=YYYY-MM-DD&type=disqualified|rejected|signed&caseType=...
 */
async function getClosedCases(req, res, next) {
  logger.info("ClosedCasesController → getClosedCases() called");

  try {
    const { date, type, caseType } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: "Query param 'date' is required (format: YYYY-MM-DD)" });
    }

    if (!type) {
      return res.status(400).json({
        error:
          "Query param 'type' is required: disqualified | rejected | signed",
      });
    }

    const normalizedCaseType =
      typeof caseType === "string" && caseType.trim().length > 0
        ? caseType.trim()
        : undefined;

    const result = await getClosedCasesReport(
      date,
      type.toLowerCase(),
      normalizedCaseType,
    );

    logger.success(
      `ClosedCasesController → getClosedCases() | total=${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    logger.error(
      `ClosedCasesController → getClosedCases() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
  }
}

const {
  streamRecordingsZip,
} = require("../../services/vicidial/vicidialRecordingsDownload.service");
const {
  searchVicidialLeadByPhone,
} = require("../../services/vicidial/vicidialLeadSearch.service");
const { normalizeDigits } = require("../../utils/vicidialLeadSearchParser");

const VICIDIAL_CONCURRENCY = 2;
const VICIDIAL_BULK_TIMEOUT_MS = 60000;

function getMinimumRecordingSeconds(reportType) {
  if (reportType === "signed") return 120;
  if (reportType === "disqualified") return 60;
  return null;
}

function normalizePhone(value) {
  const digits = normalizeDigits(value);
  return digits || null;
}

async function mapWithConcurrency(items, limit, handler) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

function getBulkDownloadFilters(query) {
  const { date, type, caseType } = query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(
      new Error("Query param 'date' is required (format: YYYY-MM-DD)"),
      { statusCode: 400 },
    );
  }

  return {
    date,
    types: type ? [type.toLowerCase()] : ["disqualified", "signed", "rejected"],
    caseType:
      typeof caseType === "string" && caseType.trim().length > 0
        ? caseType.trim()
        : undefined,
  };
}

async function collectCasesForBulkDownload(date, types, caseType) {
  const groupedCases = await Promise.all(
    types.map(async (reportType) => {
      const result = await getClosedCasesReport(date, reportType, caseType);
      return Array.isArray(result.cases)
        ? result.cases.map((item) => ({ ...item, _reportType: reportType }))
        : [];
    }),
  );

  return groupedCases.flat();
}

function buildRecordingFileName(closedCase, date, recording) {
  return `${closedCase.caseNumber || closedCase.CaseNumber || "case"}_${closedCase._reportType}_${date}_${recording.dateTime ? recording.dateTime.replace(/[:\s]/g, "-") : ""}`.replace(
    /[^a-zA-Z0-9_\-.]/g,
    "_",
  );
}

async function getVicidialPhoneMapForBulkDownload(cases) {
  const phones = Array.from(
    new Set(
      cases.map((item) => normalizePhone(item.phoneNumber)).filter(Boolean),
    ),
  );
  const phoneMap = new Map();

  await mapWithConcurrency(phones, VICIDIAL_CONCURRENCY, async (phone) => {
    try {
      const payload = await searchVicidialLeadByPhone(phone, {
        resolveRecordingLocations: false,
        timeoutMs: VICIDIAL_BULK_TIMEOUT_MS,
      });
      phoneMap.set(phone, payload);
    } catch (error) {
      logger.warn(
        `ClosedCasesController → Vicidial lookup failed for ${phone}: ${error.message}`,
      );
      phoneMap.set(phone, null);
    }
  });

  return phoneMap;
}

function getQualifiedLeadRecordings(closedCase, lead, date) {
  if (!Array.isArray(lead.recordings)) {
    return [];
  }

  const minimumSeconds = getMinimumRecordingSeconds(closedCase._reportType);

  return lead.recordings
    .filter((recording) => {
      const duration = recording.seconds || 0;

      if (!recording.location) {
        return false;
      }

      if (typeof minimumSeconds === "number" && duration <= minimumSeconds) {
        return false;
      }

      return true;
    })
    .map((recording) => ({
      url: recording.location,
      fileName: buildRecordingFileName(closedCase, date, recording),
      sourceFileName: recording.fileName || null,
      durationSeconds: recording.seconds || 0,
    }));
}

async function collectRecordingsForCase(closedCase, date, vicidialPhoneMap) {
  const phone = normalizePhone(closedCase.phoneNumber);
  if (!phone) {
    return [];
  }

  try {
    const vicidialResult = vicidialPhoneMap.get(phone);
    if (!vicidialResult || !Array.isArray(vicidialResult.records)) {
      return [];
    }

    return vicidialResult.records.flatMap((lead) =>
      getQualifiedLeadRecordings(closedCase, lead, date),
    );
  } catch (error) {
    logger.warn(
      `bulkDownloadClosedCasesRecordings: error buscando grabaciones para ${phone}: ${error.message}`,
    );
    return [];
  }
}

/**
 * GET /salesforce/closed-cases/recordings-bulk-download?date=YYYY-MM-DD&type=disqualified|rejected|signed&caseType=...
 * Descarga todas las grabaciones de todos los casos cerrados (disqualified, signed, rejected) para la fecha y filtros dados.
 */
async function bulkDownloadClosedCasesRecordings(req, res, next) {
  logger.info(
    "ClosedCasesController → bulkDownloadClosedCasesRecordings() called",
  );
  try {
    const filters = getBulkDownloadFilters(req.query);
    const allCases = await collectCasesForBulkDownload(
      filters.date,
      filters.types,
      filters.caseType,
    );

    logger.info(
      `ClosedCasesController → bulk download candidate cases=${allCases.length}`,
    );

    const vicidialPhoneMap = await getVicidialPhoneMapForBulkDownload(allCases);

    const recordingsByCase = await Promise.all(
      allCases.map((closedCase) =>
        collectRecordingsForCase(closedCase, filters.date, vicidialPhoneMap),
      ),
    );
    const recordings = recordingsByCase.flat();

    logger.info(
      `ClosedCasesController → bulk download collected recordings=${recordings.length}`,
    );

    if (!recordings.length) {
      return res
        .status(404)
        .json({ error: "No recordings found for the given filters." });
    }

    // Descargar todas las grabaciones en un ZIP
    await streamRecordingsZip({
      recordings,
      minDurationSeconds: 0, // ya filtrado arriba
      zipName: `closed_cases_recordings_${filters.date}.zip`,
      res,
    });
  } catch (error) {
    logger.error(
      `ClosedCasesController → bulkDownloadClosedCasesRecordings() error: ${error.message}`,
    );
    next(error);
  }
}

module.exports = { getClosedCases, bulkDownloadClosedCasesRecordings };
