const { processMessage } = require("./chatbot.service.js");
const excelService = require("./excel.service");
const chatSessionService = require("../../services/chatSession.service");
const logger = require("../../utils/logger");
const fs = require("node:fs");

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      logger.warn("Chatbot request without message");
      return res.status(400).json({ error: "Message required" });
    }

    // User ID is extracted from the verified JWT — no client-supplied identifier needed.
    // Each user has their own isolated history, fully tied to their account.
    const userId = req.user?.id ?? null;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const reply = await processMessage(message, userId);

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

/**
 * GET /api/chatbot/history
 * Returns the full message history for the authenticated user.
 */
exports.getHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const messages = await chatSessionService.getSessionHistory(userId);
    res.json({ userId, messages });
  } catch (error) {
    logger.error(`Get history error: ${error.message}`);
    res.status(500).json({ error: "Error al obtener historial" });
  }
};

/**
 * DELETE /api/chatbot/history
 * Clears the conversation history for the authenticated user.
 */
exports.clearHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await chatSessionService.clearSession(userId);
    res.json({ ok: true, message: "Historial eliminado" });
  } catch (error) {
    logger.error(`Clear history error: ${error.message}`);
    res.status(500).json({ error: "Error al limpiar historial" });
  }
};
