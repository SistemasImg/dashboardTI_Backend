const logger = require("../../../utils/logger");
const {
  processCaseUpdate,
} = require("../../../services/ghl/salesforce/subStatusUpdate");

exports.handleCaseUpdate = async (req, res) => {
  try {
    logger.info("Salesforce webhook received.");

    const result = await processCaseUpdate(req.body);

    if (result?.status === "skipped") {
      logger.warn(`Webhook skipped: ${result.message}`);

      return res.status(200).json({
        success: true,
        skipped: true,
        reason: result.reason,
        message: result.message,
      });
    }

    logger.success("Webhook processed successfully.");

    return res.status(200).json({
      success: true,
      message: "Case processed successfully",
    });
  } catch (error) {
    logger.error(`Controller error: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
