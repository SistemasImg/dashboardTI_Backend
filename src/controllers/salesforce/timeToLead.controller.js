const logger = require("../../utils/logger");
const {
  getTimeToLead,
  syncTimeToLeadSnapshots,
  refreshTimeToLeadSnapshotMetrics,
  refreshTimeToLeadSnapshotMetricsBatches,
} = require("../../services/salesforce/timeToLead.service");

const AUTO_METRICS_LIMIT = 5;
const AUTO_METRICS_MIN_BATCHES = 3;
const AUTO_METRICS_MAX_BATCHES = 30;
const AUTO_METRICS_MAX_CASES_PER_REQUEST = 150;

function parseBooleanQuery(
  value,
  defaultValue,
  fieldName = "businessHoursOnly",
) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  const error = new Error(`Invalid ${fieldName} value. Use true or false.`);
  error.status = 400;
  throw error;
}

function getAutoMetricsBatchOptions(syncResult = {}) {
  const syncedCount = Math.max(0, Number(syncResult.synced) || 0);
  const cappedCases = Math.min(
    Math.max(syncedCount, AUTO_METRICS_LIMIT * AUTO_METRICS_MIN_BATCHES),
    AUTO_METRICS_MAX_CASES_PER_REQUEST,
  );
  const maxBatches = Math.min(
    AUTO_METRICS_MAX_BATCHES,
    Math.max(
      AUTO_METRICS_MIN_BATCHES,
      Math.ceil(cappedCases / AUTO_METRICS_LIMIT),
    ),
  );

  return {
    limit: AUTO_METRICS_LIMIT,
    maxBatches,
    strategy: {
      mode: "auto",
      limit: AUTO_METRICS_LIMIT,
      maxBatches,
      estimatedCasesToProcess: cappedCases,
      syncedCount,
    },
  };
}

async function syncAndBuildTimeToLeadReport(body = {}) {
  const syncResult = await syncTimeToLeadSnapshots({
    startDate: body.startDate,
    endDate: body.endDate,
  });
  const metricsOptions = getAutoMetricsBatchOptions(syncResult);
  const metricsResult = await refreshTimeToLeadSnapshotMetricsBatches({
    startDate: syncResult.startDate,
    endDate: syncResult.endDate,
    limit: metricsOptions.limit,
    maxBatches: metricsOptions.maxBatches,
  });
  const report = await getTimeToLead({
    startDate: syncResult.startDate,
    endDate: syncResult.endDate,
    businessHoursOnly: parseBooleanQuery(body.businessHoursOnly, true),
  });

  return {
    report: {
      ...report,
      meta: {
        ...report.meta,
        refresh: {
          sync: syncResult,
          metrics: {
            ...metricsResult,
            strategy: metricsOptions.strategy,
          },
        },
      },
    },
    syncResult,
    metricsResult: {
      ...metricsResult,
      strategy: metricsOptions.strategy,
    },
  };
}

async function getTimeToLeadController(req, res, next) {
  logger.info("TimeToLeadController -> getTimeToLeadController() called", {
    query: req.query,
  });

  try {
    const result = await getTimeToLead({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      businessHoursOnly: parseBooleanQuery(req.query.businessHoursOnly, true),
    });

    return res.json(result);
  } catch (error) {
    logger.error(
      `TimeToLeadController -> getTimeToLeadController() error: ${error.message}`,
    );
    next(error);
  }
}

async function syncTimeToLeadController(req, res, next) {
  logger.info("TimeToLeadController -> syncTimeToLeadController() called", {
    body: req.body,
  });

  try {
    const { report, syncResult, metricsResult } =
      await syncAndBuildTimeToLeadReport(req.body);

    return res.json({
      message: "Time To Lead sync, metrics refresh and report completed",
      result: {
        sync: syncResult,
        metrics: metricsResult,
        report,
      },
    });
  } catch (error) {
    logger.error(
      `TimeToLeadController -> syncTimeToLeadController() error: ${error.message}`,
    );
    next(error);
  }
}

async function postTimeToLeadController(req, res, next) {
  logger.info("TimeToLeadController -> postTimeToLeadController() called", {
    body: req.body,
  });

  try {
    const { report } = await syncAndBuildTimeToLeadReport(req.body);
    return res.json(report);
  } catch (error) {
    logger.error(
      `TimeToLeadController -> postTimeToLeadController() error: ${error.message}`,
    );
    next(error);
  }
}

async function refreshTimeToLeadMetricsController(req, res, next) {
  logger.info(
    "TimeToLeadController -> refreshTimeToLeadMetricsController() called",
    {
      body: req.body,
    },
  );

  try {
    const result = await refreshTimeToLeadSnapshotMetrics({
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      limit: req.body?.limit,
      force: parseBooleanQuery(req.body?.force, false, "force"),
    });

    return res.json({
      message: "Time To Lead metrics refresh completed",
      result,
    });
  } catch (error) {
    logger.error(
      `TimeToLeadController -> refreshTimeToLeadMetricsController() error: ${error.message}`,
    );
    next(error);
  }
}

module.exports = {
  getTimeToLeadController,
  postTimeToLeadController,
  syncTimeToLeadController,
  refreshTimeToLeadMetricsController,
};
