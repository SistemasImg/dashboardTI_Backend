const { processMessage } = require("./chatbot.service.js");
const logger = require("../../utils/logger");

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      logger.warn("Chatbot request without message");
      return res.status(400).json({ error: "Mensaje requerido" });
    }

    const reply = await processMessage(message);

    res.json({ reply });
  } catch (error) {
    logger.error(`Chatbot controller error: ${error.message}`);
    res.status(500).json({ error: "Error en chatbot" });
  }
};
