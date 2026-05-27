const logger = require("../utils/logger");
const {
  syncVendorsAndEvaluateRules,
} = require("../services/vendor/vendor.service");

async function runVendorSyncJob() {
  logger.info("Starting runVendorSyncJob");

  try {
    const result = await syncVendorsAndEvaluateRules({
      failOnRulesError: false,
    });
    logger.info("runVendorSyncJob completed", result);

    return result;
  } catch (error) {
    logger.error("runVendorSyncJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  runVendorSyncJob,
};
