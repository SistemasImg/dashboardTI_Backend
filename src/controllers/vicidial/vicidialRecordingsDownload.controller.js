const logger = require("../../utils/logger");
const {
  streamSingleRecordingProxy,
  streamRecordingsZip,
} = require("../../services/vicidial/vicidialRecordingsDownload.service");

async function downloadRecordingProxy(req, res) {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "url query param is required",
      });
    }

    await streamSingleRecordingProxy({
      url,
      filename,
      res,
    });
  } catch (error) {
    logger.error(
      `VicidialRecordingsDownloadController proxy error: ${error.message}`,
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Error downloading recording",
    });
  }
}

async function downloadRecordingsBulk(req, res) {
  try {
    logger.info(
      "VicidialRecordingsDownloadController → bulk ZIP endpoint called",
      { body: req.body },
    );
    const { recordings, minDurationSeconds, zipName } = req.body;

    await streamRecordingsZip({
      recordings,
      minDurationSeconds,
      zipName,
      res,
    });
  } catch (error) {
    logger.error(
      `VicidialRecordingsDownloadController bulk error: ${error.message}`,
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Error generating recordings zip",
    });
  }
}

module.exports = {
  downloadRecordingProxy,
  downloadRecordingsBulk,
};
