const { DateTime } = require("luxon");
const logger = require("../utils/logger");
const {
  syncAttemptsAnalysisReport,
} = require("../services/salesforce/rideshareReport.service");

let isRunning = false;

async function runAttemptsAnalysisSyncJob(options = {}) {
  const source = options.source || "scheduled";

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
    const today = DateTime.now().setZone("America/Lima").toFormat("yyyy-LL-dd");

    logger.info("AttemptsAnalysisSyncJob -> started", {
      source,
      date: today,
    });

    const result = await syncAttemptsAnalysisReport({ date: today });

    logger.success("AttemptsAnalysisSyncJob -> completed", {
      source,
      date: today,
      total: result.total,
      syncedAt: result.syncedAt,
    });

    return result;
  } catch (error) {
    logger.error("AttemptsAnalysisSyncJob -> failed", {
      source,
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
