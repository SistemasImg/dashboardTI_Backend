const logger = require("../../utils/logger");
const { getAgentsAttempts } = require("../../services/sqlserver");
const excelService = require("../../services/sqlserver/excel.service");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Get agents attempts
 * Query params:
 *   - date (optional): Date in format YYYY-MM-DD (defaults to today)
 */
exports.getAgentsAttempts = async (req, res, next) => {
  logger.info("SqlServerController → getAgentsAttempts() called");

  try {
    const { date } = req.query;

    // Validate date format if provided (YYYY-MM-DD)
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD",
        example: "2026-04-14",
      });
    }

    logger.info(
      `Fetching agents attempts${date ? " for date: " + date : " for today"}`,
    );

    const result = await getAgentsAttempts(date);

    if (!result || result.length === 0) {
      return res.json({
        message: `No data found for ${date || "today"}`,
        data: [],
      });
    }

    logger.success(
      "SqlServerController → getAgentsAttempts() completed successfully",
    );
    return res.json({
      date: date || new Date().toISOString().split("T")[0],
      totalRecords: result.length,
      data: result,
    });
  } catch (error) {
    logger.error(
      `SqlServerController → getAgentsAttempts() error: ${error.message}`,
    );
    next(error);
  }
};

/**
 * Generate and retrieve agents attempts Excel report
 * Query params:
 *   - date (optional): Date in format YYYY-MM-DD (defaults to today)
 * Returns: { excelFile: { fileName, fileUrl } }
 */
exports.generateAgentsAttemptsExcelReport = async (req, res, next) => {
  logger.info(
    "SqlServerController → generateAgentsAttemptsExcelReport() called",
  );

  try {
    const { date } = req.query;

    // Validate date format if provided (YYYY-MM-DD)
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD",
        example: "2026-04-14",
      });
    }

    logger.info(
      `Generating Excel report${date ? " for date: " + date : " for today"}`,
    );

    // Get the data
    const records = await getAgentsAttempts(date);

    if (!records || records.length === 0) {
      return res.status(404).json({
        error: "No data available for the specified date",
      });
    }

    // Generate Excel file
    const reportDate = date || new Date().toISOString().split("T")[0];
    const excelFile = await excelService.generateAgentsAttemptsExcel(
      records,
      reportDate,
    );

    logger.success("Excel report generated successfully");
    return res.json({
      message: "Excel report generated successfully",
      excelFile: {
        fileName: excelFile.fileName,
        fileUrl: `/sqlserver/download-agents-attempts/${excelFile.fileName}`,
      },
    });
  } catch (error) {
    logger.error(
      `SqlServerController → generateAgentsAttemptsExcelReport() error: ${error.message}`,
    );
    next(error);
  }
};

/**
 * Download agents attempts Excel report by file name
 * Route: /download-agents-attempts/:fileName
 */
exports.downloadAgentsAttemptsExcel = async (req, res) => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      return res.status(400).json({ error: "File name required" });
    }

    // Security: prevent path traversal
    if (
      fileName.includes("..") ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      return res.status(400).json({ error: "Invalid file name" });
    }

    const filePath = excelService.getExcelFilePath(fileName);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      logger.warn(`Excel file not found: ${fileName}`);
      return res.status(404).json({ error: "File not found" });
    }

    // Send file
    res.download(filePath, fileName, (err) => {
      if (err) {
        logger.error(`Error downloading Excel file: ${err.message}`);
      } else {
        logger.info(`Excel file downloaded: ${fileName}`);
      }
    });
  } catch (error) {
    logger.error(`Download agents attempts Excel error: ${error.message}`);
    res.status(500).json({ error: "Error downloading file" });
  }
};
