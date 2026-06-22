const logger = require("../../utils/logger");
const {
  getTimeToLead,
} = require("../../services/salesforce/timeToLead.service");

function parseBooleanQuery(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  const error = new Error(
    "Invalid businessHoursOnly value. Use true or false.",
  );
  error.status = 400;
  throw error;
}

async function getTimeToLeadController(req, res, next) {
  logger.info("TimeToLeadController -> getTimeToLeadController() called", {
    query: req.query,
  });

  try {
    const result = await getTimeToLead({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      businessHoursOnly: parseBooleanQuery(req.query.businessHoursOnly, true),
    });

    return res.json(result);
  } catch (error) {
    logger.error(
      `TimeToLeadController -> getTimeToLeadController() error: ${error.message}`,
    );
    next(error);
  }
}

module.exports = {
  getTimeToLeadController,
};
