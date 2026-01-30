const rideshareReportService = require("../../services/salesforce/rideshareReport.service");
const logger = require("../../utils/logger");

async function getRideshareReport(req, res, next) {
  logger.info("RideshareReportController → getRideshareReport() called");

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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

module.exports = { getRideshareReport };
