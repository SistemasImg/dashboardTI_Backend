const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs");
const logger = require("../../utils/logger");
const { DateTime } = require("luxon");

const DOWNLOADS_DIR = path.join(__dirname, "../../uploads/excel-exports");
const REPORT_FILE_NAME = "case_report.xlsx";
const REPORT_FILE_URL = `/api/chatbot/download-excel/${REPORT_FILE_NAME}`;

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

    // Define headers for the report
    const headers = [
      "Case Number",
      "Status",
      "Substatus",
      "Type",
      "Origin",
      "Supplier",
      "Owner",
      "Email",
      "Phone",
      "Created Date",
    ];

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
      worksheet.addRow({
        case_number: caseItem.CaseNumber,
        status: caseItem.Status || "N/A",
        substatus: caseItem.Substatus__c || "N/A",
        type: caseItem.Type || "N/A",
        origin: caseItem.Origin || "N/A",
        supplier: caseItem.Supplier_Segment__c || "N/A",
        owner: caseItem.Owner?.Name || "N/A",
        email: caseItem.Owner?.Email__c || "N/A",
        phone: caseItem.Phone_Numbercontact__c || "N/A",
        created_date: formatDate(caseItem.CreatedDate),
      });
    });

    // Auto-adjust column widths
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? cell.value.toString().length : 0;
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
