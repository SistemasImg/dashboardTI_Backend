const logger = require("../../utils/logger");
const {
  getSupplierTypeByPhones,
  normalizePhone,
} = require("../../services/salesforce/phoneLookup.service");

async function getCaseLookupByPhone(req, res, next) {
  try {
    const phoneInput = req.query.phone;
    const normalizedPhone = normalizePhone(phoneInput);

    logger.info(
      "ExternalCaseLookupController → getCaseLookupByPhone() request received",
      {
        phoneInput: String(phoneInput || "").trim() || null,
        normalizedPhone,
      },
    );

    if (!normalizedPhone) {
      logger.warn("ExternalCaseLookupController → invalid phone received", {
        phoneInput: String(phoneInput || "").trim() || null,
      });
      return res.status(400).json({
        error:
          "Query param 'phone' is required and must be a valid US phone number with 10 digits",
      });
    }

    const resultMap = await getSupplierTypeByPhones([normalizedPhone]);
    const match = resultMap.get(normalizedPhone);

    if (!match?.caseNumber) {
      logger.warn(
        "ExternalCaseLookupController → no Salesforce case found for phone",
        {
          normalizedPhone,
        },
      );
      return res.status(404).json({
        error: "No Salesforce case found for the provided phone number",
      });
    }

    logger.success("ExternalCaseLookupController → Salesforce case found", {
      normalizedPhone,
      caseNumber: match.caseNumber,
      status: match.status || null,
    });

    return res.status(200).json({
      phone: normalizedPhone,
      status: match.status || null,
    });
  } catch (error) {
    logger.error(
      `ExternalCaseLookupController → getCaseLookupByPhone() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );
    return next(error);
  }
}

module.exports = {
  getCaseLookupByPhone,
};
