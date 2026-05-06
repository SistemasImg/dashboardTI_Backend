const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs");
const logger = require("../../utils/logger");
const { DateTime } = require("luxon");

const DOWNLOADS_DIR = path.join(__dirname, "../../uploads/excel-exports");
const REPORT_FILE_NAME = "case_report.xlsx";
const REPORT_FILE_URL = `/api/chatbot/download-excel/${REPORT_FILE_NAME}`;
const ATTEMPTS_REPORT_FILE_NAME = "attempts_report.xlsx";
const ATTEMPTS_REPORT_FILE_URL = `/api/chatbot/download-excel/${ATTEMPTS_REPORT_FILE_NAME}`;
const VENDORS_REPORT_FILE_NAME = "vendors_report.xlsx";
const VENDORS_REPORT_FILE_URL = `/api/chatbot/download-excel/${VENDORS_REPORT_FILE_NAME}`;
const VENDOR_CASES_REPORT_FILE_NAME = "vendor_cases_report.xlsx";
const VENDOR_CASES_REPORT_FILE_URL = `/api/chatbot/download-excel/${VENDOR_CASES_REPORT_FILE_NAME}`;
const VENDOR_ATTEMPTS_REPORT_FILE_NAME = "vendor_attempts_report.xlsx";
const VENDOR_ATTEMPTS_REPORT_FILE_URL = `/api/chatbot/download-excel/${VENDOR_ATTEMPTS_REPORT_FILE_NAME}`;

// Create download folder if it does not exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Format a date string to a readable format: DD/MM/YYYY HH:mm
 * @param {String} dateString - ISO date string from Salesforce
 * @returns {String} Formatted date or "N/A" if invalid
 */
function formatDate(dateString) {
  if (!dateString) return "N/A";

  try {
    const date = DateTime.fromISO(dateString);
    if (!date.isValid) return "N/A";

    return date.toFormat("dd/MM/yyyy HH:mm");
  } catch (error) {
    logger.warn(`Error formatting date: ${dateString} - ${error.message}`);
    return "N/A";
  }
}

function getCellTextLength(cellValue) {
  if (cellValue === null || cellValue === undefined) return 0;
  if (typeof cellValue === "string" || typeof cellValue === "number") {
    return String(cellValue).length;
  }

  if (cellValue?.text) {
    return String(cellValue.text).length;
  }

  return 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

/**
 * Generate a single Excel report file for cases.
 * The file is always saved as a fixed short name so it is replaced on each export.
 * @param {Array} cases - Array of case objects
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateCasesExcel = async (cases) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Cases");

    const includeDisqualificationReasons = (cases || []).some((caseItem) => {
      return (
        Object.prototype.hasOwnProperty.call(
          caseItem || {},
          "Reason_for_DQ__c",
        ) ||
        Object.prototype.hasOwnProperty.call(
          caseItem || {},
          "Reason_for_Doesn_t_meet_criteria__c",
        )
      );
    });

    const allSent =
      (cases || []).length > 0 &&
      (cases || []).every(
        (c) =>
          String(c.Status || "")
            .trim()
            .toLowerCase() === "sent",
      );
    const dateFieldLabel = allSent ? "Sent Date" : "Created Date";
    const dateFieldKey = dateFieldLabel.toLowerCase().replaceAll(" ", "_");

    // Define headers for the report
    const headers = [
      "Case Number",
      "Status",
      "Substatus",
      "Type",
      "Tier",
      "Origin",
      "Supplier",
      "Owner",
      "Email",
      "Phone",
      dateFieldLabel,
    ];

    if (includeDisqualificationReasons) {
      headers.push("Reason_for_DQ__c", "Reason_for_Doesn_t_meet_criteria__c");
    }

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 20,
    }));

    // Style headers
    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };

    // Add rows
    cases.forEach((caseItem) => {
      const emailValue = firstNonEmpty(
        caseItem.Email__c,
        caseItem.email,
        caseItem.Owner?.Email,
        caseItem.Owner?.Email__c,
      );

      const phoneValue = firstNonEmpty(
        caseItem.Phone_Numbercontact__c,
        caseItem.phone,
        caseItem.Phone,
      );

      const row = {
        case_number: caseItem.CaseNumber,
        status: caseItem.Status || "N/A",
        substatus: caseItem.Substatus__c || "N/A",
        type: caseItem.Type || "N/A",
        tier: caseItem.Tier__c || "N/A",
        origin: caseItem.Origin || "N/A",
        supplier: caseItem.Supplier_Segment__c || "N/A",
        owner: caseItem.Owner?.Name || "N/A",
        email: emailValue || "N/A",
        phone: phoneValue || "N/A",
      };

      // Use dynamic key based on label (sent_date or created_date)
      row[dateFieldKey] = formatDate(
        String(caseItem.Status || "")
          .trim()
          .toLowerCase() === "sent"
          ? caseItem.Sent_Date2__c
          : caseItem.CreatedDate,
      );

      if (includeDisqualificationReasons) {
        row.reason_for_dq__c = caseItem.Reason_for_DQ__c || "N/A";
        row.reason_for_doesn_t_meet_criteria__c =
          caseItem.Reason_for_Doesn_t_meet_criteria__c || "N/A";
      }

      worksheet.addRow(row);
    });

    // Auto-adjust column widths
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = getCellTextLength(cell.value);
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    // Save report using a fixed short filename
    const filePath = path.join(DOWNLOADS_DIR, REPORT_FILE_NAME);

    await workbook.xlsx.writeFile(filePath);

    logger.info(`Excel file generated: ${REPORT_FILE_NAME}`);

    return {
      filePath,
      fileName: REPORT_FILE_NAME,
      fileUrl: REPORT_FILE_URL,
    };
  } catch (error) {
    logger.error(`Error generating Excel: ${error.message}`);
    throw error;
  }
};

/**
 * Generate a single Excel report file for attempts.
 * @param {Array} attempts - Array of attempts objects
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateAttemptsExcel = async (attempts) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Attempts");

    const headers = [
      "Case Number",
      "Phone",
      "Call Date",
      "Attempts",
      "Status",
      "Substatus",
      "Owner",
      "Created Date",
    ];

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 20,
    }));

    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };

    attempts.forEach((item) => {
      const attemptsValue =
        item.attempts ?? item.ATTEMPTS ?? item.totalAttempts ?? 0;

      worksheet.addRow({
        case_number: item.CaseNumber || item.caseNumber || "N/A",
        phone:
          item.phone ||
          item.Phone_Numbercontact__c ||
          item["PHONE NUMBER"] ||
          "N/A",
        call_date: item.call_date || item.date || "N/A",
        attempts: attemptsValue,
        status: item.Status || "N/A",
        substatus: item.Substatus__c || "N/A",
        owner: item.Owner?.Name || "N/A",
        created_date: formatDate(item.CreatedDate || item.createdDate),
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = getCellTextLength(cell.value);
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    const filePath = path.join(DOWNLOADS_DIR, ATTEMPTS_REPORT_FILE_NAME);
    await workbook.xlsx.writeFile(filePath);

    logger.info(`Excel attempts file generated: ${ATTEMPTS_REPORT_FILE_NAME}`);

    return {
      filePath,
      fileName: ATTEMPTS_REPORT_FILE_NAME,
      fileUrl: ATTEMPTS_REPORT_FILE_URL,
    };
  } catch (error) {
    logger.error(`Error generating attempts Excel: ${error.message}`);
    throw error;
  }
};

/**
 * Generate a single Excel report file for vendors aggregation results.
 * @param {Array} vendors - Array of vendor rows
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateVendorsExcel = async (vendors) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Vendors");

    const headers = ["Vendor", "Supplier Segment", "Total Leads", "Period"];

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 24,
    }));

    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };

    vendors.forEach((item) => {
      worksheet.addRow({
        vendor: item.vendor || "N/A",
        supplier_segment: item.segment || "N/A",
        total_leads: item.totalLeads ?? 0,
        period: item.scope || "N/A",
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = getCellTextLength(cell.value);
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    const filePath = path.join(DOWNLOADS_DIR, VENDORS_REPORT_FILE_NAME);
    await workbook.xlsx.writeFile(filePath);

    logger.info(`Excel vendors file generated: ${VENDORS_REPORT_FILE_NAME}`);

    return {
      filePath,
      fileName: VENDORS_REPORT_FILE_NAME,
      fileUrl: VENDORS_REPORT_FILE_URL,
    };
  } catch (error) {
    logger.error(`Error generating vendors Excel: ${error.message}`);
    throw error;
  }
};

/**
 * Generate Excel report with vendor lead details (case number + phone).
 * @param {Array} rows - Array of vendor case rows
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateVendorCasesExcel = async (rows) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Vendor Cases");

    const headers = [
      "Vendor",
      "Case Number",
      "Phone",
      "Supplier Segment",
      "Created Date",
      "Period",
    ];

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 24,
    }));

    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };

    rows.forEach((item) => {
      worksheet.addRow({
        vendor: item.vendor || "N/A",
        case_number: item.caseNumber || "N/A",
        phone: item.phone || "N/A",
        supplier_segment: item.segment || "N/A",
        created_date: formatDate(item.createdDate),
        period: item.scope || "N/A",
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = getCellTextLength(cell.value);
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    const filePath = path.join(DOWNLOADS_DIR, VENDOR_CASES_REPORT_FILE_NAME);
    await workbook.xlsx.writeFile(filePath);

    return {
      filePath,
      fileName: VENDOR_CASES_REPORT_FILE_NAME,
      fileUrl: VENDOR_CASES_REPORT_FILE_URL,
    };
  } catch (error) {
    logger.error(`Error generating vendor cases Excel: ${error.message}`);
    throw error;
  }
};

/**
 * Generate Excel report with attempts by lead for a vendor.
 * @param {Array} rows - Array of vendor attempt rows
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateVendorAttemptsExcel = async (rows) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Vendor Attempts");

    const headers = [
      "Vendor",
      "Case Number",
      "Phone",
      "Attempts",
      "Call Date",
      "Hour",
      "Agent Name",
      "Call Center",
      "Supplier Segment",
      "Assignment Type",
      "Created Date",
      "Period",
    ];

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 24,
    }));

    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };

    rows.forEach((item) => {
      worksheet.addRow({
        vendor: item.vendor || "N/A",
        case_number: item.caseNumber || "N/A",
        phone: item.phone || "N/A",
        attempts: item.attempts ?? 0,
        call_date: item.callDate || "N/A",
        hour:
          item.hour === null || item.hour === undefined
            ? "N/A"
            : String(item.hour).padStart(2, "0") + ":00",
        agent_name: item.agentName || "N/A",
        call_center: item.callCenter || "N/A",
        supplier_segment: item.segment || "N/A",
        assignment_type: item.assignmentType || "N/A",
        created_date: formatDate(item.createdDate),
        period: item.scope || "N/A",
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = getCellTextLength(cell.value);
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    const filePath = path.join(DOWNLOADS_DIR, VENDOR_ATTEMPTS_REPORT_FILE_NAME);
    await workbook.xlsx.writeFile(filePath);

    return {
      filePath,
      fileName: VENDOR_ATTEMPTS_REPORT_FILE_NAME,
      fileUrl: VENDOR_ATTEMPTS_REPORT_FILE_URL,
    };
  } catch (error) {
    logger.error(`Error generating vendor attempts Excel: ${error.message}`);
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
 * List all available Excel files
 * @returns {Array} Array of file names
 */
exports.listExcelFiles = async () => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    return files.filter((f) => f.endsWith(".xlsx"));
  } catch (error) {
    logger.error(`Error listing Excel files: ${error.message}`);
    return [];
  }
};

/**
 * Delete Excel files older than 24 hours
 */
exports.cleanupOldExcelFiles = async () => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

    files.forEach((file) => {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > MAX_AGE) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted old Excel file: ${file}`);
      }
    });
  } catch (error) {
    logger.error(`Error cleaning up Excel files: ${error.message}`);
  }
};
