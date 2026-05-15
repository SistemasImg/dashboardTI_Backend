const logger = require("../utils/logger");
const {
  createTranscription,
  getTranscriptionDetail,
  getRecordingsTranscriptionStatus,
} = require("../services/transcription/transcription.service");

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function createTranscriptionJob(req, res, next) {
  try {
    const { recordingUrl, caseNumber, locale } = req.body || {};

    if (!recordingUrl) {
      return res.status(400).json({
        success: false,
        message: "recordingUrl is required",
      });
    }

    const job = await createTranscription({
      recordingUrl,
      caseNumber,
      locale,
      metadata: req.body?.metadata || null,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        providerStatus: job.provider_status,
      },
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    logger.error(`TranscriptionController create error: ${error.message}`);
    next(error);
    return null;
  }
}

async function getTranscriptionJobDetail(req, res, next) {
  try {
    const { id } = req.params;
    const payload = await getTranscriptionDetail(id, {
      includeAnalysis: isTruthy(req.query.includeAnalysis || req.query.analyze),
      forceRefresh: isTruthy(req.query.forceRefresh),
    });

    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }

    logger.error(`TranscriptionController detail error: ${error.message}`);
    next(error);
    return null;
  }
}

async function getRecordingsStatus(req, res, next) {
  try {
    const payload = await getRecordingsTranscriptionStatus(
      req.body?.recordingUrls,
    );

    return res.status(200).json(payload);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }

    logger.error(
      `TranscriptionController recordings status error: ${error.message}`,
    );
    next(error);
    return null;
  }
}

module.exports = {
  createTranscriptionJob,
  getTranscriptionJobDetail,
  getRecordingsStatus,
};
