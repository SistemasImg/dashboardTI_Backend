const logger = require("../utils/logger");

const landingUatService = require("../services/landingUat.service");
const didUatService = require("../services/didUat.service");

// -------------------------------
// LANDING UAT
// -------------------------------
exports.createTestLanding = async (req, res, next) => {
  logger.info("UatController → createTestLanding() called");

  try {
    const result = await landingUatService.createLandingUAT(req.body);

    logger.success("UatController → createTestLanding() success");
    return res.status(201).json(result);
  } catch (error) {
    logger.error(`UatController → createTestLanding() error: ${error.message}`);
    next(error);
  }
};

exports.getTestLanding = async (req, res, next) => {
  logger.info("UatController → getTestLanding() called");

  try {
    const result = await landingUatService.getLandingUAT(req.query);

    logger.success("UatController → getTestLanding() success");
    return res.json(result);
  } catch (error) {
    logger.error(`UatController → getTestLanding() error: ${error.message}`);
    next(error);
  }
};

exports.updateTestLanding = async (req, res, next) => {
  logger.info("UatController → updateTestLanding() called");

  try {
    const { id } = req.params;

    const result = await landingUatService.updateLandingUAT(id, req.body);

    logger.success("UatController → updateTestLanding() success");
    return res.json(result);
  } catch (error) {
    logger.error(`UatController → updateTestLanding() error: ${error.message}`);
    next(error);
  }
};

// -------------------------------
// DID UAT
// -------------------------------
exports.createTestDid = async (req, res, next) => {
  logger.info("UatController → createTestDid() called");

  try {
    const result = await didUatService.createDidUAT(req.body);

    logger.success("UatController → createTestDid() success");
    return res.status(201).json(result);
  } catch (error) {
    logger.error(`UatController → createTestDid() error: ${error.message}`);
    next(error);
  }
};

exports.getTestDid = async (req, res, next) => {
  logger.info("UatController → getTestDid() called");

  try {
    const result = await didUatService.getDidUAT(req.query);

    logger.success("UatController → getTestDid() success");
    return res.json(result);
  } catch (error) {
    logger.error(`UatController → getTestDid() error: ${error.message}`);
    next(error);
  }
};

exports.updateTestDid = async (req, res, next) => {
  logger.info("UatController → updateTestDid() called");

  try {
    const { id } = req.params;
    const result = await didUatService.updateDidUAT(id, req.body);

    logger.success("UatController → updateTestDid() success");
    return res.json(result);
  } catch (error) {
    logger.error(`UatController → updateTestDid() error: ${error.message}`);
    next(error);
  }
};
