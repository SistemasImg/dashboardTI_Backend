const logger = require("../utils/logger");
const domainService = require("../services/domain.service");

exports.allDomains = async (req, res, next) => {
  logger.info("DomainController → allDomains() called");

  try {
    const result = await domainService.allDomains();

    logger.success("DomainController → allDomains() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`DomainController → allDomains() error: ${error.message}`);
    next(error);
  }
};
