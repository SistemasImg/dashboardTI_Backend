const logger = require("../../utils/logger");
const { getAgentsAttempts } = require("../../services/sqlserver");

//Attemps x Agents
exports.getAgentsAttempts = async (req, res, next) => {
  logger.info("SqlServerController → getAgentsAttempts() called");

  try {
    const result = await getAgentsAttempts();
    logger.success(
      "SqlServerController → getAgentsAttempts() completed successfully",
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `SqlServerController → getAgentsAttempts() error: ${error.message}`,
    );
    next(error);
  }
};
