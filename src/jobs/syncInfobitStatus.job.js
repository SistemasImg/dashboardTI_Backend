const logger = require("../utils/logger");
const { syncPendingOutboundStatuses } = require("../services/infobit.service");

async function syncInfobitStatusesJob() {
  logger.info("🔄 Starting syncInfobitStatusesJob");

  try {
    const result = await syncPendingOutboundStatuses(200);

    logger.info("✅ syncInfobitStatusesJob completed", result);
    return result;
  } catch (error) {
    logger.error("❌ syncInfobitStatusesJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  syncInfobitStatusesJob,
};
