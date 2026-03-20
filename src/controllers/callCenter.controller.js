const logger = require("../utils/logger");
const callCenterService = require("../services/callCenter.service");

exports.allCallCenters = async (req, res, next) => {
  logger.info("CallCenterController → allCallCenters() called");

  try {
    const result = await callCenterService.allCallCenters();

    logger.success(
      "CallCenterController → allCallCenters() completed successfully",
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `CallCenterController → allCallCenters() error: ${error.message}`,
    );
    next(error);
  }
};
