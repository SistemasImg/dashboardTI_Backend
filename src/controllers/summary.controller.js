const logger = require("../utils/logger");
const { getSummary } = require("../services/summary.service");

exports.summary = async (req, res, next) => {
  logger.info("SummaryController → summary() called");

  try {
    const result = await getSummary();
    logger.success("SummaryController → summary() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`SummaryController → summary() error: ${error.message}`);
    next(error);
  }
};
