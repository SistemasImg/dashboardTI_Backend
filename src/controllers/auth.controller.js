const logger = require("../utils/logger");
const authService = require("../services/auth.service");

exports.login = async (req, res, next) => {
  logger.info("AuthController → login() called");

  try {
    const { email, password } = req.body;

    const result = await authService.login(email, password);

    logger.success("AuthController → login() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`AuthController → login() error: ${error.message}`);
    next(error);
  }
};

exports.getCurrentUser = async (req, res, next) => {
  logger.info("AuthController → getCurrentUser() called");

  try {
    const result = await authService.getCurrentUser(req.user.id);

    logger.success("AuthController → getCurrentUser() OK");
    return res.json(result);
  } catch (error) {
    logger.error(`AuthController → getCurrentUser() error: ${error.message}`);
    next(error);
  }
};
