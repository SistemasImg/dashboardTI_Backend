const logger = require("../utils/logger");
const { Domain } = require("../models");

exports.allDomains = async () => {
  logger.info("DomainService → allDomains() started");

  const domains = await Domain.findAll();

  if (!domains || domains.length === 0) {
    logger.warn("DomainService → No domains found");
    const err = new Error("No domains found");
    err.status = 404;
    throw err;
  }

  logger.success("DomainService → allDomains() OK");
  return domains;
};
