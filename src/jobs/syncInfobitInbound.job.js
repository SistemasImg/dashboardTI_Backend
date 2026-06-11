const logger = require("../utils/logger");
const {
  syncInboundForRecentOutboundPhones,
} = require("../services/infobit.service");

async function syncInfobitInboundJob() {
  logger.info("Starting syncInfobitInboundJob");

  try {
    const result = await syncInboundForRecentOutboundPhones(75, 40);
    logger.info("syncInfobitInboundJob completed", result);
    return result;
  } catch (error) {
    logger.error("syncInfobitInboundJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  syncInfobitInboundJob,
};
