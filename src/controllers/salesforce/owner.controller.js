const logger = require("../../utils/logger");
const {
  getAllOwners,
  getSupplierAccounts,
} = require("../../services/salesforce/owner.service.js");

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

async function getOwnerSupplierAccounts(req, res, next) {
  logger.info("Salesforce → getOwnerSupplierAccounts() called");

  try {
    const result = await getSupplierAccounts();

    logger.success(
      `Salesforce → getOwnerSupplierAccounts() success | total: ${result.length}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `Salesforce → getOwnerSupplierAccounts() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

module.exports = { getOwners, getOwnerSupplierAccounts };
