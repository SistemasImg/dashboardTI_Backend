const logger = require("../utils/logger");
const { allAgents } = require("../services/agents.service");

exports.allAgent = async (req, res, next) => {
  logger.info("AgentsController → allAgents() called");

  try {
    const result = await allAgents();

    logger.success("RolesController → allRoles() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`RolesController → allRoles() error: ${error.message}`);
    next(error);
  }
};
