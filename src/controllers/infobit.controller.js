const logger = require("../utils/logger");
const {
  InfobitService,
  logMessageRecord,
} = require("../services/infobit.service");

//CREATE MESSAGE INFOBIT
async function sendInfobitMessage(req, res, next) {
  logger.info("InfobitController → sendInfobitMessage() called");
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }
    const token = authHeader.split(" ")[1];

    const result = await InfobitService(req.body, token);

    logger.success(`InfobitController → sendInfobitMessage() success`);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → sendInfobitMessage() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

// LOG MESSAGE RECORDS
async function logMessageRecords(req, res, next) {
  logger.info("InfobitController → logMessageRecords() called");
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }
    const token = authHeader.split(" ")[1];
    const result = await logMessageRecord(token);
    logger.success(`InfobitController → logMessageRecords() success`);
    return res.json(result);
  } catch (error) {
    logger.error(
      `InfobitController → logMessageRecords() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

module.exports = { sendInfobitMessage, logMessageRecords };
