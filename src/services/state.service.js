const logger = require("../utils/logger");
const { State } = require("../models");

exports.allStates = async () => {
  logger.info("StateService → allStates() started");

  const states = await State.findAll({
    where: { status: 1 },
    raw: true,
  });

  if (!states || states.length === 0) {
    logger.warn("StateService → No active states found (status = 1)");
    const err = new Error("No states found");
    err.status = 404;
    throw err;
  }

  logger.success("StateService → allStates() OK");
  return states;
};
