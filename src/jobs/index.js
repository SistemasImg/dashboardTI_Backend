const cron = require("node-cron");
const logger = require("../utils/logger");
const { syncAttemptsDaily } = require("./syncAttempts.job");
const { syncInfobitStatusesJob } = require("./syncInfobitStatus.job");
const {
  runVicidialExceededTimeAlertJob,
} = require("./vicidialExceededTimeAlert.job");
const isProduction = process.env.NODE_ENV === "production";

// Configure cron to run every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  logger.info("⏰ Cron triggered: syncAttemptsDaily");

  try {
    await syncAttemptsDaily();
    logger.info("✅ Cron syncAttemptsDaily completed");
  } catch (error) {
    logger.error("❌ Cron syncAttemptsDaily failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});

// Configure cron to run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  logger.info("⏰ Cron triggered: syncInfobitStatusesJob");

  try {
    await syncInfobitStatusesJob();
    logger.info("✅ Cron syncInfobitStatusesJob completed");
  } catch (error) {
    logger.error("❌ Cron syncInfobitStatusesJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});

if (isProduction) {
  // Configure cron to run every minute
  cron.schedule("* * * * *", async () => {
    logger.info("Cron triggered: runVicidialExceededTimeAlertJob");

    try {
      await runVicidialExceededTimeAlertJob();
      logger.info("Cron runVicidialExceededTimeAlertJob completed");
    } catch (error) {
      logger.error("Cron runVicidialExceededTimeAlertJob failed", {
        message: error.message,
        stack: error.stack,
      });
    }
  });
} else {
  logger.info("Vicidial exceeded-time job disabled outside production");
}

(async () => {
  logger.info("🚀 Initial syncAttemptsDaily on server start");

  try {
    await syncAttemptsDaily();
    logger.info("✅ Initial sync completed");
  } catch (error) {
    logger.error("❌ Initial sync failed", error);
  }
})();

(async () => {
  logger.info("🚀 Initial syncInfobitStatusesJob on server start");

  try {
    await syncInfobitStatusesJob();
    logger.info("✅ Initial Infobit sync completed");
  } catch (error) {
    logger.error("❌ Initial Infobit sync failed", error);
  }
})();

if (isProduction) {
  (async () => {
    logger.info("Initial runVicidialExceededTimeAlertJob on server start");

    try {
      await runVicidialExceededTimeAlertJob();
      logger.info("Initial Vicidial exceeded-time check completed");
    } catch (error) {
      logger.error("Initial Vicidial exceeded-time check failed", error);
    }
  })();
}
