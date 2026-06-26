const logger = require("../utils/logger");
const {
  syncRecentTimeToLeadSnapshots,
  refreshRecentTimeToLeadSnapshotMetrics,
} = require("../services/salesforce/timeToLead.service");

async function runTimeToLeadSyncJob(options = {}) {
  const source = options.source || "scheduled";
  const daysBack = Number(
    options.daysBack ?? process.env.TIME_TO_LEAD_SYNC_DAYS_BACK ?? 1,
  );
  const limit = Number(
    options.limit ?? process.env.TIME_TO_LEAD_METRICS_BATCH_LIMIT ?? 3,
  );
  const metricsBatches = Math.max(
    1,
    Number(
      options.metricsBatches ??
        process.env.TIME_TO_LEAD_SYNC_METRICS_BATCHES ??
        3,
    ) || 1,
  );

  logger.info(
    `Starting runTimeToLeadSyncJob | source: ${source} | daysBack: ${daysBack} | limit: ${limit} | metricsBatches: ${metricsBatches}`,
  );

  try {
    const syncResult = await syncRecentTimeToLeadSnapshots(daysBack);
    const metricsResult = [];

    for (let batchIndex = 0; batchIndex < metricsBatches; batchIndex += 1) {
      metricsResult.push(
        await refreshRecentTimeToLeadSnapshotMetrics({
          daysBack,
          limit,
          retryableMatchStatuses: [
            "pending_lookup",
            "no_first_call_found",
            "lookup_timeout",
            "lookup_failed",
          ],
        }),
      );
    }

    logger.info("runTimeToLeadSyncJob completed", {
      source,
      daysBack,
      limit,
      metricsBatches,
      windows: syncResult.length,
    });
    return {
      syncResult,
      metricsResult,
    };
  } catch (error) {
    logger.error("runTimeToLeadSyncJob failed", {
      message: error.message,
      stack: error.stack,
      source,
      daysBack,
      limit,
      metricsBatches,
    });
    throw error;
  }
}

module.exports = {
  runTimeToLeadSyncJob,
};
