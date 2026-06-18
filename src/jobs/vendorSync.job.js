const logger = require("../utils/logger");
const {
  syncSalesforceVendorsToMysql,
} = require("../services/vendor/vendors.service");
const {
  syncVendorsAndEvaluateRules,
} = require("../services/vendor/vendor.classification.service");
const {
  SYNC_KEYS,
  getVendorSyncStatus,
  trackVendorSync,
} = require("../services/vendor/vendor.syncStatus.service");

async function runVendorSyncJob(options = {}) {
  const source = options.source || "scheduled";
  logger.info(`Starting runVendorSyncJob | source: ${source}`);

  try {
    const result = await trackVendorSync(SYNC_KEYS.FULL, source, async () => {
      const salesforceToMysql = await trackVendorSync(
        SYNC_KEYS.SALESFORCE_TO_MYSQL,
        source,
        syncSalesforceVendorsToMysql,
      );

      const classification = await trackVendorSync(
        SYNC_KEYS.CLASSIFICATION,
        source,
        () =>
          syncVendorsAndEvaluateRules({
            failOnRulesError: false,
          }),
      );

      return {
        salesforceToMysql,
        classification,
      };
    });
    logger.info("runVendorSyncJob completed", result);

    return {
      ...result,
      syncStatus: getVendorSyncStatus(),
    };
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
  getVendorSyncStatus,
};
