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
      const salesforceToMysql = await runSalesforceVendorsToMysqlJob({
        source,
      });
      const classification = await runVendorCategorySyncJob({ source });

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

async function runSalesforceVendorsToMysqlJob(options = {}) {
  const source =
    options.source || "scheduled:PATCH /vendor-sync/salesforce/vendors";
  logger.info(`Starting runSalesforceVendorsToMysqlJob | source: ${source}`);

  try {
    const result = await trackVendorSync(
      SYNC_KEYS.SALESFORCE_TO_MYSQL,
      source,
      syncSalesforceVendorsToMysql,
    );

    logger.info("runSalesforceVendorsToMysqlJob completed", result);

    return {
      ...result,
      syncStatus: getVendorSyncStatus(),
    };
  } catch (error) {
    logger.error("runSalesforceVendorsToMysqlJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function runVendorCategorySyncJob(options = {}) {
  const source =
    options.source ||
    "scheduled:PATCH /vendor-sync/salesforce/vendors-category";
  logger.info(`Starting runVendorCategorySyncJob | source: ${source}`);

  try {
    const result = await trackVendorSync(SYNC_KEYS.CLASSIFICATION, source, () =>
      syncVendorsAndEvaluateRules({
        failOnRulesError: false,
        syncSalesforceData: true,
        syncSalesforceSupplierSegments: true,
      }),
    );

    logger.info("runVendorCategorySyncJob completed", result);

    return {
      ...result,
      salesforceCategoryUpdate: {
        enabled: true,
        field: "Contact.Supplier_segment__c",
        scope: "supplier segment only",
      },
      syncStatus: getVendorSyncStatus(),
    };
  } catch (error) {
    logger.error("runVendorCategorySyncJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  runVendorSyncJob,
  runSalesforceVendorsToMysqlJob,
  runVendorCategorySyncJob,
  getVendorSyncStatus,
};
