const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs");
const logger = require("../../utils/logger");

const DOWNLOADS_DIR = path.join(__dirname, "../../uploads/excel-exports");

// Create download folder if it does not exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Group agents attempts data by Call Center, Agent, Hour, and Phone Number
 * Each unique combination gets its own row (no aggregation by phone)
 * @param {Array} records - Raw records from database
 * @returns {Array} Grouped and organized data
 */
function groupAgentsAttempts(records) {
  const grouped = {};

  records.forEach((record) => {
    // Include PHONE NUMBER in the key to separate records by phone
    const key = `${record["CALL CENTER"]}_${record["AGENT NAME"]}_${record.HOUR}_${record["PHONE NUMBER"]}`;

    if (!grouped[key]) {
      grouped[key] = {
        callCenter: record["CALL CENTER"],
        agentName: record["AGENT NAME"],
        hour: record.HOUR,
        phoneNumber: record["PHONE NUMBER"],
        attempts: 0,
      };
    }

    grouped[key].attempts += record.ATTEMPTS || 0;
  });

  // Convert to array and sort by Call Center, then Agent, then Hour
  return Object.values(grouped).sort((a, b) => {
    if (a.callCenter !== b.callCenter) {
      return a.callCenter.localeCompare(b.callCenter);
    }
    if (a.agentName !== b.agentName) {
      return a.agentName.localeCompare(b.agentName);
    }
    return a.hour - b.hour;
  });
}

/**
 * Generate Excel report for agents attempts
 * @param {Array} records - Records from the database
 * @param {String} date - Date for the report (YYYY-MM-DD)
 * @returns {Object} { filePath, fileName, fileUrl }
 */
exports.generateAgentsAttemptsExcel = async (records, date) => {
  try {
    logger.info(`🔄 Generating agents attempts Excel for date: ${date}`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Agents Attempts");

    // Group and organize data
    const groupedData = groupAgentsAttempts(records);

    // Define headers
    const headers = [
      "Call Center",
      "Agent Name",
      "Hour",
      "Phone Number",
      "Total Attempts",
    ];

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h.toLowerCase().replaceAll(" ", "_"),
      width: 18,
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

    // Add summary row
    const totalAttempts = groupedData.reduce(
      (sum, row) => sum + row.attempts,
      0,
    );
    worksheet.addRow({
      call_center: `Report Date: ${date}`,
      agent_name: `Total Attempts: ${totalAttempts}`,
      hour: "",
      phone_number: "",
      total_attempts: "",
    });

    // Add empty row for spacing
    worksheet.addRow({});

    // Add data rows
    let currentCallCenter = null;
    let callCenterAttempts = 0;

    groupedData.forEach((row, index) => {
      // If call center changed, add subtotal
      if (currentCallCenter && currentCallCenter !== row.callCenter) {
        worksheet.addRow({
          call_center: `${currentCallCenter} Subtotal:`,
          agent_name: callCenterAttempts,
          hour: "",
          phone_number: "",
          total_attempts: "",
        });
        worksheet.addRow({});
        callCenterAttempts = 0;
      }

      currentCallCenter = row.callCenter;
      callCenterAttempts += row.attempts;

      // Add data row
      const rowNum = worksheet.addRow({
        call_center: row.callCenter,
        agent_name: row.agentName,
        hour: `${String(row.hour).padStart(2, "0")}:00`,
        phone_number: row.phoneNumber || "N/A",
        total_attempts: row.attempts,
      }).number;

      // Alternate row colors for better readability
      if (index % 2 === 0) {
        worksheet.getRow(rowNum).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      }
    });

    // Add final subtotal
    if (currentCallCenter) {
      worksheet.addRow({
        call_center: `${currentCallCenter} Subtotal:`,
        agent_name: callCenterAttempts,
        hour: "",
        phone_number: "",
        total_attempts: "",
      });
    }

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
