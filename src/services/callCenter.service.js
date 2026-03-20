const logger = require("../utils/logger");
const { CallCenter } = require("../models");

exports.allCallCenters = async () => {
  logger.info("CallCenterService → allCallCenters() started");

  const callCenters = await CallCenter.findAll({
    where: {
      status: 1,
    },
  });

  if (!callCenters || callCenters.length === 0) {
    logger.warn("CallCenterService → No call centers found");
    const err = new Error("No call centers found");
    err.status = 404;
    throw err;
  }

  logger.success("CallCenterService → allCallCenters() OK");
  return callCenters;
};
