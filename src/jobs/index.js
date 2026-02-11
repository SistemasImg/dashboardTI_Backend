const cron = require("node-cron");
const logger = require("../utils/logger");
const { syncAttemptsDaily } = require("./syncAttempts.job");

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

(async () => {
  logger.info("🚀 Initial syncAttemptsDaily on server start");

  try {
    await syncAttemptsDaily();
    logger.info("✅ Initial sync completed");
  } catch (error) {
    logger.error("❌ Initial sync failed", error);
  }
})();
