const { DateTime } = require("luxon");
const logger = require("../utils/logger");
const {
  syncAttemptsAnalysisReport,
} = require("../services/salesforce/rideshareReport.service");

const DEFAULT_SYNC_DAYS_BACK = 29;

let isRunning = false;

async function runAttemptsAnalysisSyncJob(options = {}) {
  const source = options.source || "scheduled";
  const rawDaysBack = Number(
    options.daysBack ??
      process.env.ATTEMPTS_ANALYSIS_SYNC_DAYS_BACK ??
      DEFAULT_SYNC_DAYS_BACK,
  );
  const daysBack = Math.max(0, rawDaysBack || 0);

  if (isRunning) {
    logger.info(
      "AttemptsAnalysisSyncJob -> skipped because previous run is still active",
      {
        source,
      },
    );
    return { skipped: true, reason: "already_running" };
  }

  isRunning = true;

  try {
    const today = DateTime.now().setZone("America/Lima").startOf("day");
    const startDate = today.minus({ days: daysBack }).toFormat("yyyy-LL-dd");
    const endDate = today.toFormat("yyyy-LL-dd");

    logger.info("AttemptsAnalysisSyncJob -> started", {
      source,
      startDate,
      endDate,
      daysBack,
    });

    const result = await syncAttemptsAnalysisReport({ startDate, endDate });

    logger.success("AttemptsAnalysisSyncJob -> completed", {
      source,
      startDate,
      endDate,
      daysBack,
      total: result.total,
      syncedAt: result.syncedAt,
    });

    return result;
  } catch (error) {
    logger.error("AttemptsAnalysisSyncJob -> failed", {
      source,
      daysBack,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    isRunning = false;
  }
}

module.exports = {
  runAttemptsAnalysisSyncJob,
};
