const logger = require("../utils/logger");
const {
  pollPendingTranscriptions,
} = require("../services/transcription/transcription.service");

async function runTranscriptionStatusPollJob() {
  logger.info("TranscriptionStatusPollJob -> started");

  try {
    const processed = await pollPendingTranscriptions();
    logger.success(`TranscriptionStatusPollJob -> processed ${processed} jobs`);
  } catch (error) {
    logger.error(`TranscriptionStatusPollJob -> failed: ${error.message}`);
  }
}

module.exports = {
  runTranscriptionStatusPollJob,
};
