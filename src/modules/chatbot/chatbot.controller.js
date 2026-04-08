const { processMessage } = require("./chatbot.service.js");
const excelService = require("./excel.service");
const logger = require("../../utils/logger");
const fs = require("node:fs");

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      logger.warn("Chatbot request without message");
      return res.status(400).json({ error: "Message required" });
    }

    const reply = await processMessage(message);

    // The response is now an object with `message` and optionally `excelFile`
    res.json({
      reply: reply.message,
      excelFile: reply.excelFile || null,
    });
  } catch (error) {
    logger.error(`Chatbot controller error: ${error.message}`);
    res.status(500).json({ error: "Chatbot error" });
  }
};

/**
 * Download the generated Excel report
 */
exports.downloadExcel = async (req, res) => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      return res.status(400).json({ error: "File name required" });
    }

    // Security validation: prevent path traversal
    if (
      fileName.includes("..") ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      return res.status(400).json({ error: "Invalid file name" });
    }

    const filePath = excelService.getExcelFilePath(fileName);

    // Verify the file exists
    if (!fs.existsSync(filePath)) {
      logger.warn(`Excel file not found: ${fileName}`);
      return res.status(404).json({ error: "File not found" });
    }

    // Send file to the client
    res.download(filePath, fileName, (err) => {
      if (err) {
        logger.error(`Error downloading Excel file: ${err.message}`);
      } else {
        logger.info(`Excel file downloaded: ${fileName}`);
      }
    });
  } catch (error) {
    logger.error(`Download Excel controller error: ${error.message}`);
    res.status(500).json({ error: "Error downloading file" });
  }
};
