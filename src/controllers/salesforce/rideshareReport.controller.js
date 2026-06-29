const rideshareReportService = require("../../services/salesforce/rideshareReport.service");
const logger = require("../../utils/logger");

async function getRideshareReport(req, res, next) {
  logger.info("RideshareReportController → getRideshareReport() called");

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }
    const token = authHeader.split(" ")[1];

    const result = await rideshareReportService.getRideshareReport(token);

    logger.success(
      `RideshareReportController → getRideshareReport() success | total: ${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `RideshareReportController → getRideshareReport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

async function getDailyInflowReport(req, res, next) {
  logger.info("RideshareReportController → getDailyInflowReport() called");

  try {
    const result = await rideshareReportService.getDailyInflowReport({
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      type: req.query.type,
    });

    logger.success(
      `RideshareReportController → getDailyInflowReport() success | total: ${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `RideshareReportController → getDailyInflowReport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

async function getDailyOutflowReport(req, res, next) {
  logger.info("RideshareReportController → getDailyOutflowReport() called");

  try {
    const result = await rideshareReportService.getDailyOutflowReport({
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      type: req.query.type,
    });

    logger.success(
      `RideshareReportController → getDailyOutflowReport() success | total: ${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `RideshareReportController → getDailyOutflowReport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

async function getAttemptsAnalysisReport(req, res, next) {
  logger.info("RideshareReportController → getAttemptsAnalysisReport() called");

  try {
    const result = await rideshareReportService.getAttemptsAnalysisReport({
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    logger.success(
      `RideshareReportController → getAttemptsAnalysisReport() success | total: ${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `RideshareReportController → getAttemptsAnalysisReport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

async function syncAttemptsAnalysisReport(req, res, next) {
  logger.info(
    "RideshareReportController → syncAttemptsAnalysisReport() called",
  );

  try {
    const body = req.body || {};
    const result = await rideshareReportService.syncAttemptsAnalysisReport({
      date: body.date ?? req.query.date,
      startDate: body.startDate ?? req.query.startDate,
      endDate: body.endDate ?? req.query.endDate,
    });

    logger.success(
      `RideshareReportController → syncAttemptsAnalysisReport() success | total: ${result.total}`,
    );

    return res.json(result);
  } catch (error) {
    logger.error(
      `RideshareReportController → syncAttemptsAnalysisReport() error: ${error.message}`,
      {
        stack: error.stack,
        origin: "controller",
      },
    );

    next(error);
  }
}

module.exports = {
  getRideshareReport,
  getDailyInflowReport,
  getDailyOutflowReport,
  getAttemptsAnalysisReport,
  syncAttemptsAnalysisReport,
};
