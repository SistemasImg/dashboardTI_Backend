const logger = require("../../utils/logger");
const {
  getClosedCasesReport,
} = require("../../services/salesforce/closedCases.service");
const {
  markClosedCasesWorked,
} = require("../../services/salesforce/closedCasesWorkStatus.service");

async function markClosedCasesWorkedController(req, res, next) {
  logger.info(
    "ClosedCasesWorkStatusController → markClosedCasesWorked() called",
  );

  try {
    const { caseNumbers, eventType, performedBy } = req.body;
    const fallbackPerformedBy =
      performedBy ||
      req.user?.email ||
      req.user?.username ||
      (req.user?.id ? String(req.user.id) : null);

    const result = await markClosedCasesWorked({
      caseNumbers,
      eventType,
      performedBy: fallbackPerformedBy,
    });

    return res.json({
      message: "Closed cases marked successfully",
      data: result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    logger.error(
      `ClosedCasesWorkStatusController → markClosedCasesWorked() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
    return null;
  }
}

async function markClosedCasesWorkedByFilterController(req, res, next) {
  logger.info(
    "ClosedCasesWorkStatusController → markClosedCasesWorkedByFilter() called",
  );

  try {
    const { date, type, typeFilter, eventType, performedBy } = req.body;
    const reportType = String(type || "").toLowerCase();
    const caseType =
      typeof typeFilter === "string" &&
      typeFilter.trim() &&
      typeFilter.trim().toLowerCase() !== "all"
        ? typeFilter.trim()
        : undefined;

    const report = await getClosedCasesReport(date, reportType, caseType);
    const caseNumbers = report.cases
      .map((item) => item.caseNumber)
      .filter(Boolean);

    const fallbackPerformedBy =
      performedBy ||
      req.user?.email ||
      req.user?.username ||
      (req.user?.id ? String(req.user.id) : null);

    const result = await markClosedCasesWorked({
      caseNumbers,
      eventType,
      performedBy: fallbackPerformedBy,
    });

    return res.json({
      message: "Closed cases marked by filter successfully",
      data: {
        ...result,
        reportDate: date,
        reportType,
        typeFilter: caseType || null,
      },
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    logger.error(
      `ClosedCasesWorkStatusController → markClosedCasesWorkedByFilter() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
    return null;
  }
}

module.exports = {
  markClosedCasesWorkedController,
  markClosedCasesWorkedByFilterController,
};
