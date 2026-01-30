const logger = require("../utils/logger");
const { apiSendPost } = require("../services/apiSend.service");

exports.postApiSend = async (req, res, next) => {
  logger.info("UatApiSend → apiSendPost() called");

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }
    const token = authHeader.split(" ")[1];
    const result = await apiSendPost(req.body, token);

    logger.success("UatApiSend → apiSendPost() success");
    return res.status(201).json(result);
  } catch (error) {
    logger.error(`UatApiSend → apiSendPost() error: ${error.message}`);
    next(error);
  }
};
