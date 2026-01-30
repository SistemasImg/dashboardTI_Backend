const logger = require("../utils/logger");
const { Agents } = require("../models");

exports.allAgents = async () => {
  logger.info("AgentsService → allAgents() started");

  const agents = await Agents.findAll();

  if (!agents || agents.length === 0) {
    logger.warn("AgentsService → No agents found");
    const err = new Error("No agents found");
    err.status = 404;
    throw err;
  }

  logger.success("AgentsService → allAgents() OK");
  return agents;
};
