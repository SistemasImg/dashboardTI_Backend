const logger = require("../../utils/logger");
const {
  createSalesforceCase,
} = require("../../services/salesforce/cases.service");

const createCaseInSalesforce = async (req, res, next) => {
  logger.info("SalesforceCasesController -> createCaseInSalesforce() called");

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1];
    const result = await createSalesforceCase(req.body, token);

    logger.success(
      "SalesforceCasesController -> createCaseInSalesforce() success",
    );
    return res.status(201).json(result);
  } catch (error) {
    logger.error(
      `SalesforceCasesController -> createCaseInSalesforce() error: ${error.message}`,
    );
    next(error);
  }
};

module.exports = {
  createCaseInSalesforce,
};
