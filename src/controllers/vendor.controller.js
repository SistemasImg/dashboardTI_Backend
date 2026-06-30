const logger = require("../utils/logger");
const {
  syncVendorsAndEvaluateRules,
  listVendors,
  getVendorInsightsById,
  getVendorAssignedSalesforceCases,
  setVendorCategory,
  assignVendorToTort,
  updateVendorTopRewards,
  resetVendorSalesforcePassword,
} = require("../services/vendor/vendor.classification.service");
const {
  SYNC_KEYS,
  getVendorSyncStatus,
  trackVendorSync,
} = require("../services/vendor/vendor.syncStatus.service");
const {
  evaluateCategoryRules,
} = require("../services/vendor/vendor.categoryRules.service");
const {
  getVendorMonitoringAlerts,
  subscribeVendorMonitoringAlerts,
  getVendorMonitoringSummary,
} = require("../services/vendor/vendor.alerts.service");
const {
  getVendorAnalyticsSummary,
  getVendorAnalyticsTrends,
  getVendorAnalyticsVendors,
  getVendorAnalyticsTypes,
  getVendorAnalyticsCategoryHistory,
} = require("../services/vendor/vendor.analytics.service");
const {
  listVendorsTable,
  getVendorTableById,
  listSalesforceVendors,
  syncSalesforceVendorsToMysql,
  listVendorsCountries,
  createVendorTableEntry,
  toggleVendorTableStatus,
  updateVendorsTableBulk,
  updateVendorsTableById,
  hardDeleteVendorTableEntry,
} = require("../services/vendor/vendors.service");
const { runVendorSyncJob } = require("../jobs/vendorSync.job");

async function syncVendors(req, res, next) {
  logger.info("VendorController → syncVendors() called");

  try {
    const result = await runVendorSyncJob({ source: "manual:/vendors/sync" });

    logger.success(
      `VendorController → syncVendors() success | salesforceToMysqlCreated: ${result.salesforceToMysql?.created?.length || 0} | classificationSynced: ${result.classification?.synced || 0} | rulesEvaluated: ${result.classification?.rules?.evaluated || 0}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(`VendorController → syncVendors() error: ${error.message}`, {
      stack: error.stack,
      origin: "controller",
    });

    next(error);
  }
}

async function getVendorSyncStatusSnapshot(req, res, next) {
  logger.info("VendorController → getVendorSyncStatusSnapshot() called");

  try {
    return res.status(200).json({ syncStatus: getVendorSyncStatus() });
  } catch (error) {
    logger.error(
      `VendorController → getVendorSyncStatusSnapshot() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendors(req, res, next) {
  logger.info("VendorController → getVendors() called");

  try {
    const result = await listVendors(req.query);

    logger.success(
      `VendorController → getVendors() success | total: ${result.summary.total}`,
    );

    return res.status(200).json({
      ...result,
      syncStatus: getVendorSyncStatus(),
    });
  } catch (error) {
    logger.error(`VendorController → getVendors() error: ${error.message}`, {
      stack: error.stack,
      origin: "controller",
    });
    next(error);
  }
}

async function getVendorInsights(req, res, next) {
  logger.info("VendorController → getVendorInsights() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await getVendorInsightsById(vendorId);

    logger.success(
      `VendorController → getVendorInsights() success | vendorId: ${vendorId}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorInsights() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorSalesforceCases(req, res, next) {
  logger.info("VendorController → getVendorSalesforceCases() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await getVendorAssignedSalesforceCases(vendorId);

    logger.success(
      `VendorController → getVendorSalesforceCases() success | vendorId: ${vendorId} | cases: ${result.summary.total}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorSalesforceCases() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function updateVendorCategory(req, res, next) {
  logger.info("VendorController → updateVendorCategory() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await setVendorCategory(vendorId, req.body.category);

    logger.success(
      `VendorController → updateVendorCategory() success | vendorId: ${vendorId}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → updateVendorCategory() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function upsertVendorTort(req, res, next) {
  logger.info("VendorController → upsertVendorTort() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await assignVendorToTort({
      vendorId,
      productId: req.body.productId,
      status: req.body.status,
      notes: req.body.notes,
      assignedBy: req.user?.id || null,
    });

    logger.success(
      `VendorController → upsertVendorTort() success | vendorId: ${vendorId} | productId: ${req.body.productId}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → upsertVendorTort() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function updateVendorRewards(req, res, next) {
  logger.info("VendorController → updateVendorRewards() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await updateVendorTopRewards(vendorId, req.body);

    logger.success(
      `VendorController → updateVendorRewards() success | vendorId: ${vendorId}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → updateVendorRewards() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function resetVendorPassword(req, res, next) {
  logger.info("VendorController → resetVendorPassword() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await resetVendorSalesforcePassword(vendorId);

    logger.success(
      `VendorController → resetVendorPassword() success | vendorId: ${vendorId} | salesforceUserId: ${result.vendor.salesforceUserId}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → resetVendorPassword() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function runVendorCategoryRules(req, res, next) {
  logger.info("VendorController → runVendorCategoryRules() called");

  try {
    const result = await evaluateCategoryRules();

    logger.success(
      `VendorController → runVendorCategoryRules() success | evaluated: ${result.evaluated} | changed: ${result.changed}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → runVendorCategoryRules() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorMonitoringSnapshot(req, res, next) {
  logger.info("VendorController → getVendorMonitoringSnapshot() called");

  try {
    const limit = Number(req.query.limit || 20);
    const result = await getVendorMonitoringSummary({ limit });
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorMonitoringSnapshot() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorMonitoringAlertsFeed(req, res, next) {
  logger.info("VendorController → getVendorMonitoringAlertsFeed() called");

  try {
    const sinceId = Number(req.query.sinceId || 0);
    const limit = Number(req.query.limit || 50);
    const result = getVendorMonitoringAlerts({ sinceId, limit });
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorMonitoringAlertsFeed() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

function streamVendorMonitoringEvents(req, res, next) {
  logger.info("VendorController → streamVendorMonitoringEvents() called");

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const { notifications } = getVendorMonitoringAlerts({ limit: 25 });
    for (const event of notifications) {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const onAlert = (event) => {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = subscribeVendorMonitoringAlerts(onAlert);

    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  } catch (error) {
    logger.error(
      `VendorController → streamVendorMonitoringEvents() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsAnalyticsSummary(req, res, next) {
  logger.info("VendorController → getVendorsAnalyticsSummary() called");

  try {
    const result = await getVendorAnalyticsSummary(req.query);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsAnalyticsSummary() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsAnalyticsTrends(req, res, next) {
  logger.info("VendorController → getVendorsAnalyticsTrends() called");

  try {
    const result = await getVendorAnalyticsTrends(req.query);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsAnalyticsTrends() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsAnalyticsVendors(req, res, next) {
  logger.info("VendorController → getVendorsAnalyticsVendors() called");

  try {
    const result = await getVendorAnalyticsVendors(req.query);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsAnalyticsVendors() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsAnalyticsTypes(req, res, next) {
  logger.info("VendorController → getVendorsAnalyticsTypes() called");

  try {
    const result = await getVendorAnalyticsTypes(req.query);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsAnalyticsTypes() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsAnalyticsCategoryHistory(req, res, next) {
  logger.info("VendorController → getVendorsAnalyticsCategoryHistory() called");

  try {
    const result = await getVendorAnalyticsCategoryHistory(req.query);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsAnalyticsCategoryHistory() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsTable(req, res, next) {
  logger.info("VendorController → getVendorsTable() called");

  try {
    const result = await listVendorsTable();
    return res.status(200).json({
      ...result,
      syncStatus: getVendorSyncStatus(),
    });
  } catch (error) {
    logger.error(
      `VendorController → getVendorsTable() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorTable(req, res, next) {
  logger.info("VendorController → getVendorTable() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await getVendorTableById(vendorId);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorTable() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getSalesforceVendors(req, res, next) {
  logger.info("VendorController → getSalesforceVendors() called");

  try {
    const result = await listSalesforceVendors();
    return res.status(200).json({
      ...result,
      syncStatus: getVendorSyncStatus(),
    });
  } catch (error) {
    logger.error(
      `VendorController → getSalesforceVendors() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function patchSalesforceVendorsToMysql(req, res, next) {
  logger.info("VendorController → patchSalesforceVendorsToMysql() called");

  try {
    const result = await trackVendorSync(
      SYNC_KEYS.SALESFORCE_TO_MYSQL,
      "manual:PATCH /vendor-sync/salesforce/vendors",
      syncSalesforceVendorsToMysql,
    );
    return res.status(200).json({
      ...result,
      syncStatus: getVendorSyncStatus(),
    });
  } catch (error) {
    logger.error(
      `VendorController → patchSalesforceVendorsToMysql() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function patchSalesforceVendorCategoriesToMysql(req, res, next) {
  logger.info(
    "VendorController → patchSalesforceVendorCategoriesToMysql() called",
  );

  try {
    const result = await trackVendorSync(
      SYNC_KEYS.CLASSIFICATION,
      "manual:PATCH /vendor-sync/salesforce/vendors-category",
      () =>
        syncVendorsAndEvaluateRules({
          failOnRulesError: false,
          syncSalesforceData: true,
          syncSalesforceSupplierSegments: true,
        }),
    );

    return res.status(200).json({
      ...result,
      salesforceCategoryUpdate: {
        enabled: true,
        field: "Contact.Supplier_segment__c",
        scope: "supplier segment only",
      },
      syncStatus: getVendorSyncStatus(),
    });
  } catch (error) {
    logger.error(
      `VendorController → patchSalesforceVendorCategoriesToMysql() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function getVendorsCountries(req, res, next) {
  logger.info("VendorController → getVendorsCountries() called");

  try {
    const result = await listVendorsCountries();
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → getVendorsCountries() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function createVendorTable(req, res, next) {
  logger.info("VendorController → createVendorTable() called");

  try {
    const result = await createVendorTableEntry(req.body);
    return res.status(201).json(result);
  } catch (error) {
    logger.error(
      `VendorController → createVendorTable() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );
    next(error);
  }
}

async function patchVendorTableStatus(req, res, next) {
  logger.info("VendorController → patchVendorTableStatus() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await toggleVendorTableStatus(vendorId, req.body.status);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → patchVendorTableStatus() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );
    next(error);
  }
}

async function patchVendorTableById(req, res, next) {
  logger.info("VendorController → patchVendorTableById() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await updateVendorsTableById(vendorId, req.body);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → patchVendorTableById() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function patchVendorsTableBulk(req, res, next) {
  logger.info("VendorController → patchVendorsTableBulk() called");

  try {
    const result = await updateVendorsTableBulk(req.body.vendorIds, req.body);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → patchVendorsTableBulk() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

async function hardDeleteVendorTable(req, res, next) {
  logger.info("VendorController → hardDeleteVendorTable() called");

  try {
    const vendorId = Number(req.params.vendorId);
    const result = await hardDeleteVendorTableEntry(vendorId);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `VendorController → hardDeleteVendorTable() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );
    next(error);
  }
}

module.exports = {
  syncVendors,
  getVendorSyncStatusSnapshot,
  getVendors,
  getVendorInsights,
  getVendorSalesforceCases,
  updateVendorCategory,
  upsertVendorTort,
  updateVendorRewards,
  resetVendorPassword,
  runVendorCategoryRules,
  getVendorMonitoringSnapshot,
  getVendorMonitoringAlertsFeed,
  streamVendorMonitoringEvents,
  getVendorsAnalyticsSummary,
  getVendorsAnalyticsTrends,
  getVendorsAnalyticsVendors,
  getVendorsAnalyticsTypes,
  getVendorsAnalyticsCategoryHistory,
  getVendorsTable,
  getVendorTable,
  getSalesforceVendors,
  patchSalesforceVendorsToMysql,
  patchSalesforceVendorCategoriesToMysql,
  getVendorsCountries,
  createVendorTable,
  patchVendorTableStatus,
  patchVendorsTableBulk,
  patchVendorTableById,
  hardDeleteVendorTable,
};
