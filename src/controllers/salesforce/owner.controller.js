const logger = require("../../utils/logger");
const { getAllOwners } = require("../../services/salesforce/owner.service.js");

async function getOwners(req, res, next) {
  logger.info("Salesforce → getOwners() called");

  try {
    const result = await getAllOwners();

    logger.success(
      `Salesforce → getOwners() success | total: ${result.length}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(`Salesforce → getOwners() error: ${error.message}`, {
      stack: error.stack,
      origin: "controller",
    });

    next(error);
  }
}

module.exports = { getOwners };
