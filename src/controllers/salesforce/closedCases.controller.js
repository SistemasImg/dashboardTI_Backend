const {
  getClosedCasesReport,
} = require("../../services/salesforce/closedCases.service");
const logger = require("../../utils/logger");

/**
 * GET /salesforce/closed-cases?date=YYYY-MM-DD&type=disqualified|rejected|signed&caseType=...
 */
async function getClosedCases(req, res, next) {
  logger.info("ClosedCasesController → getClosedCases() called");

  try {
    const { date, type, caseType } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: "Query param 'date' is required (format: YYYY-MM-DD)" });
    }

    if (!type) {
      return res.status(400).json({
        error:
          "Query param 'type' is required: disqualified | rejected | signed",
      });
    }

    const normalizedCaseType =
      typeof caseType === "string" && caseType.trim().length > 0
        ? caseType.trim()
        : undefined;

    const result = await getClosedCasesReport(
      date,
      type.toLowerCase(),
      normalizedCaseType,
    );

    logger.success(
      `ClosedCasesController → getClosedCases() | total=${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    logger.error(
      `ClosedCasesController → getClosedCases() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
  }
}

module.exports = { getClosedCases };
