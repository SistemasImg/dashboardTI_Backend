const logger = require("../../utils/logger");
const {
  getSalesforceAudienceExport,
} = require("../../services/salesforce/audienceExport.service");

async function postAudienceExport(req, res, next) {
  logger.info("AudienceExportController → postAudienceExport() called");

  try {
    const rawType = req.body.type;
    const types = Array.isArray(rawType) ? rawType : [rawType];
    const { sms, mail, pending, unresponsive } = req.body;

    const result = await getSalesforceAudienceExport({
      types,
      sms,
      mail,
      pending,
      unresponsive,
    });

    const smsSummary = result.summary?.sms
      ? `sms: ${result.summary.sms.pending?.sent || 0}+${result.summary.sms.unresponsive?.sent || 0}`
      : "sms: disabled";
    const emailSummary = result.summary?.email
      ? `email: ${result.summary.email.pending?.sent || 0}+${result.summary.email.unresponsive?.sent || 0}`
      : "email: disabled";

    logger.success(
      `AudienceExportController → postAudienceExport() success | ${smsSummary} | ${emailSummary}`,
    );

    return res.status(200).json(result);
  } catch (error) {
    logger.error(
      `AudienceExportController → postAudienceExport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

module.exports = {
  postAudienceExport,
};
