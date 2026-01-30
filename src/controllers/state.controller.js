const logger = require("../utils/logger");
const stateService = require("../services/state.service");

exports.allStates = async (req, res, next) => {
  logger.info("StateController → allStates() called");

  try {
    const result = await stateService.allStates();

    logger.success("StateController → allStates() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`StateController → allStates() error: ${error.message}`);
    next(error);
  }
};
