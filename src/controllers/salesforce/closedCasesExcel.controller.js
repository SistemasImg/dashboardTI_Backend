const logger = require("../../utils/logger");
const {
  streamClosedCasesVicidialExcel,
} = require("../../services/salesforce/closedCasesExcel.service");

async function getClosedCasesVicidialExcel(req, res, next) {
  logger.info(
    "ClosedCasesExcelController → getClosedCasesVicidialExcel() called",
  );

  try {
    const { date, type } = req.query;

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

    await streamClosedCasesVicidialExcel({
      date,
      type: String(type).toLowerCase(),
      res,
    });

    return null;
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 403) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    logger.error(
      `ClosedCasesExcelController → export error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
    return null;
  }
}

module.exports = {
  getClosedCasesVicidialExcel,
};
