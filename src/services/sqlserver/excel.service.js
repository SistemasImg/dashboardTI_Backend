const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs");
const logger = require("../../utils/logger");

const DOWNLOADS_DIR = path.join(__dirname, "../../uploads/excel-exports");
const REPORT_START_HOUR = 8;
const REPORT_END_HOUR = 20;
const REPORT_HOURS = Array.from(
  { length: REPORT_END_HOUR - REPORT_START_HOUR + 1 },
  (_, index) => REPORT_START_HOUR + index,
);

// Create download folder if it does not exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function createEmptyHourlyAttempts() {
  return REPORT_HOURS.reduce((hours, hour) => {
    hours[hour] = 0;
    return hours;
  }, {});
}

function getPrintableCellValue(cellValue) {
  if (cellValue == null) {
    return "";
  }

  if (typeof cellValue === "string" || typeof cellValue === "number") {
    return String(cellValue);
  }

  if (typeof cellValue === "object") {
    if ("richText" in cellValue && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((part) => part.text).join("");
    }

    if ("text" in cellValue && typeof cellValue.text === "string") {
      return cellValue.text;
    }

    if ("result" in cellValue && cellValue.result != null) {
      return String(cellValue.result);
    }

    return JSON.stringify(cellValue);
  }

  return String(cellValue);
}

/**
 * Sanitize a string to be a valid Excel sheet name (max 31 chars, no special chars).
 * @param {String} name
 * @returns {String}
 */
function sanitizeSheetName(name) {
  return name
    .replace(/[\\/?*[\]:]/g, "")
    .trim()
    .slice(0, 31);
}

/**
 * Build a summary matrix grouped only by Call Center with one column per hour.
 * @param {Array} records - Raw records from database
 * @returns {Array} One row per call center
 */
function buildCallCenterSummaryMatrix(records) {
  const grouped = new Map();

  records.forEach((record) => {
    const hour = Number(record.HOUR);

    if (
      !Number.isInteger(hour) ||
      hour < REPORT_START_HOUR ||
      hour > REPORT_END_HOUR
    ) {
      return;
    }

    const callCenter = record["CALL CENTER"] || "No call center";
    const attempts = Number(record.ATTEMPTS) || 0;

    if (!grouped.has(callCenter)) {
      grouped.set(callCenter, {
        callCenter,
        hourlyAttempts: createEmptyHourlyAttempts(),
      });
    }

    grouped.get(callCenter).hourlyAttempts[hour] += attempts;
  });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      totalAttempts: REPORT_HOURS.reduce(
        (sum, hour) => sum + row.hourlyAttempts[hour],
        0,
      ),
    }))
    .sort((a, b) => a.callCenter.localeCompare(b.callCenter));
}

/**
 * Build a detail matrix by Agent and Phone Number for a given call center.
 * @param {Array} records - Raw records from database
 * @param {String} callCenterFilter - Call center to filter by
 * @returns {Array} One row per agent+phone combination
 */
function buildAgentsAttemptsMatrix(records, callCenterFilter = null) {
  const grouped = new Map();

  records.forEach((record) => {
    const hour = Number(record.HOUR);

    if (
      !Number.isInteger(hour) ||
      hour < REPORT_START_HOUR ||
      hour > REPORT_END_HOUR
    ) {
      return;
    }

    const callCenter = record["CALL CENTER"] || "No call center";

    if (callCenterFilter !== null && callCenter !== callCenterFilter) {
      return;
    }

    const agentName = record["AGENT NAME"] || "No agent";
    const phoneNumber = record["PHONE NUMBER"] || "No number";
    const attempts = Number(record.ATTEMPTS) || 0;
    const key = `${agentName}__${phoneNumber}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        agentName,
        phoneNumber,
        hourlyAttempts: createEmptyHourlyAttempts(),
      });
    }

    grouped.get(key).hourlyAttempts[hour] += attempts;
  });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      totalAttempts: REPORT_HOURS.reduce(
        (sum, hour) => sum + row.hourlyAttempts[hour],
        0,
      ),
    }))
    .sort((a, b) => {
      if (a.agentName !== b.agentName) {
        return a.agentName.localeCompare(b.agentName);
      }
      return a.phoneNumber.localeCompare(b.phoneNumber, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

/**
 * Add a styled header row to a worksheet.
 * @param {ExcelJS.Worksheet} worksheet
 * @param {Array} columnHeaders - Array of header strings
 * @param {String} fillColor - ARGB color for background
 * @returns {ExcelJS.Row}
 */
function addHeaderRow(worksheet, columnHeaders, fillColor = "FF4472C4") {
  const headerRow = worksheet.addRow(columnHeaders);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fillColor },
  };
  return headerRow;
}

/**
 * Add a title + subtitle block to a worksheet (rows 1-3).
 * @param {ExcelJS.Worksheet} worksheet
 * @param {String} title
 * @param {Number} totalCols - number of columns (for merge)
 * @param {Number} totalAttempts
 */
function addTitleBlock(worksheet, title, totalCols, totalAttempts) {
  const titleRow = worksheet.addRow([title]);
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
  titleRow.font = { bold: true, size: 13, color: { argb: "FF1F1F1F" } };
  titleRow.alignment = { horizontal: "center", vertical: "middle" };
  titleRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9EAF7" },
  };

  const summaryRow = worksheet.addRow([`Total attempts: ${totalAttempts}`]);
  worksheet.mergeCells(summaryRow.number, 1, summaryRow.number, totalCols);
  summaryRow.font = { italic: true, color: { argb: "FF4F4F4F" } };
  summaryRow.alignment = { horizontal: "center" };

  worksheet.addRow([]);
}

/**
 * Populate a worksheet with the hourly-attempts matrix.
 * @param {ExcelJS.Worksheet} worksheet
 * @param {String} title - Sheet title text
 * @param {Array} columnDefs - Array of { header, key, width }
 * @param {Array} matrixRows - Each row has: hourlyAttempts, totalAttempts, and the identifier fields matching columnDefs keys
 * @param {Function} buildRowValues - (row) => object with column key → value
 * @param {Number} frozenCols - How many columns to freeze (xSplit)
 * @param {Boolean} enableFilter - Whether to add autoFilter on the header row
 */
function populateMatrixSheet(
  worksheet,
  title,
  columnDefs,
  matrixRows,
  buildRowValues,
  frozenCols,
  enableFilter = false,
) {
  const totalAttempts = matrixRows.reduce(
    (sum, row) => sum + row.totalAttempts,
    0,
  );
  const totalCols = columnDefs.length;

  worksheet.columns = columnDefs.map(({ key, width }) => ({ key, width }));

  addTitleBlock(worksheet, title, totalCols, totalAttempts);

  const headerRow = addHeaderRow(
    worksheet,
    columnDefs.map((col) => col.header),
  );

  const totalsByHour = createEmptyHourlyAttempts();

  matrixRows.forEach((row, index) => {
    const rowValues = buildRowValues(row);
    REPORT_HOURS.forEach((hour) => {
      rowValues[`hour_${hour}`] = row.hourlyAttempts[hour] || 0;
      totalsByHour[hour] += row.hourlyAttempts[hour] || 0;
    });

    const worksheetRow = worksheet.addRow(rowValues);
    if (index % 2 === 0) {
      worksheetRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF7F9FC" },
      };
    }
  });

  // Totals row
  const totalRowValues = buildRowValues({
    hourlyAttempts: totalsByHour,
    totalAttempts,
  });
  REPORT_HOURS.forEach((hour) => {
    totalRowValues[`hour_${hour}`] = totalsByHour[hour];
  });
  const totalRow = worksheet.addRow(totalRowValues);
  totalRow.font = { bold: true, color: { argb: "FF1F1F1F" } };
  totalRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2F0D9" },
  };

  worksheet.views = [{ state: "frozen", ySplit: 4, xSplit: frozenCols }];

  if (enableFilter) {
    // Filter buttons only on identifier columns (Agent and Phone Number),
    // excluding Total and hour columns to keep the header clean.
    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: frozenCols - 1 },
    };
  }
}

// Column definitions reused across sheets
const HOUR_COLUMNS = REPORT_HOURS.map((hour) => ({
  header: `${String(hour).padStart(2, "0")}:00`,
  key: `hour_${hour}`,
  width: 7,
}));

const SUMMARY_COLUMNS = [
  { header: "Call Center", key: "call_center", width: 16 },
  { header: "Total", key: "total", width: 8 },
  ...HOUR_COLUMNS,
];

const DETAIL_COLUMNS = [
  { header: "Agent", key: "agent_name", width: 22 },
  { header: "Phone Number", key: "phone_number", width: 15 },
  { header: "Total", key: "total", width: 8 },
  ...HOUR_COLUMNS,
];

/**
 * Generate Excel report for agents attempts (multi-sheet)
 * Sheet 1: summary by call center (attempts per hour)
 * Sheet N+1: detail for each call center (agent + phone + hours)
 * @param {Array} records - Records from the database
 * @param {String} date - Date for the report (YYYY-MM-DD)
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateAgentsAttemptsExcel = async (records, date) => {
  try {
    logger.info(`🔄 Generating agents attempts Excel for date: ${date}`);

    const summaryData = buildCallCenterSummaryMatrix(records);

    if (summaryData.length === 0) {
      throw new Error(
        `No data available between ${REPORT_START_HOUR}:00 and ${REPORT_END_HOUR}:00 for ${date}`,
      );
    }

    const workbook = new ExcelJS.Workbook();

    // ── Sheet 1: Summary by call center (no filter) ──────────────────────────
    const summarySheet = workbook.addWorksheet("Summary");
    populateMatrixSheet(
      summarySheet,
      `Summary by Call Center - ${date}`,
      SUMMARY_COLUMNS,
      summaryData,
      (row) => ({
        call_center: row.callCenter ?? "TOTAL",
        total: row.totalAttempts,
      }),
      2,
      false,
    );

    // ── Sheets per call center ────────────────────────────────────────────────
    const callCenters = summaryData.map((row) => row.callCenter);

    for (const callCenter of callCenters) {
      const detailData = buildAgentsAttemptsMatrix(records, callCenter);

      if (detailData.length === 0) {
        continue;
      }

      const sheetName = sanitizeSheetName(callCenter);
      const detailSheet = workbook.addWorksheet(sheetName);

      populateMatrixSheet(
        detailSheet,
        `${callCenter} - Attempts by Agent and Hour - ${date}`,
        DETAIL_COLUMNS,
        detailData,
        (row) => ({
          agent_name: row.agentName ?? "",
          phone_number: row.phoneNumber ?? "",
          total: row.totalAttempts,
        }),
        3,
        true,
      );
    }

    // Generate a single reusable filename so the report is overwritten on every request
    const fileName = `agents_attempts.xlsx`;
    const filePath = path.join(DOWNLOADS_DIR, fileName);
    const fileUrl = `/sqlserver/queries/download-agents-attempts/${fileName}`;

    // If the file already exists, overwrite it by removing first
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Save to file
    await workbook.xlsx.writeFile(filePath);

    logger.info(`✅ Excel file generated: ${fileName}`);

    // Cleanup old temporary Excel files after generation
    await exports.cleanupOldExcelFiles();

    return {
      fileName,
      fileUrl,
      filePath,
    };
  } catch (error) {
    logger.error(`❌ Error generating agents attempts Excel: ${error.message}`);
    throw error;
  }
};

/**
 * Get the full path for an Excel file
 * @param {String} fileName - File name
 * @returns {String} Full path to the file
 */
exports.getExcelFilePath = (fileName) => {
  return path.join(DOWNLOADS_DIR, fileName);
};

/**
 * Delete Excel files older than 24 hours
 */
exports.cleanupOldExcelFiles = async () => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    files.forEach((file) => {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted old Excel file: ${file}`);
      }
    });
  } catch (error) {
    logger.warn(`Error cleaning up old Excel files: ${error.message}`);
  }
};
