const logger = require("../utils/logger");
const usersService = require("../services/users.service");

exports.allUsers = async (req, res, next) => {
  logger.info("UsersController → allUsers() called");

  try {
    const result = await usersService.allUsers();

    logger.success("UsersController → allUsers() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`UsersController → allUsers() error: ${error.message}`);
    next(error);
  }
};

exports.createUser = async (req, res, next) => {
  logger.info("UsersController → createUser() called");

  try {
    const result = await usersService.createUser(req.body);

    logger.success("UsersController → createUser() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`UsersController → createUser() error: ${error.message}`);
    next(error);
  }
};

exports.updateUsers = async (req, res, next) => {
  logger.info("UsersController → updateUsers() called");

  try {
    const { id } = req.params;
    const result = await usersService.updateUsers(id, req.body);

    logger.success("UsersController → updateUsers() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`UsersController → updateUsers() error: ${error.message}`);
    next(error);
  }
};

exports.deleteUsers = async (req, res, next) => {
  logger.info("UsersController → deleteUsers() called");

  try {
    const { id } = req.params;
    const result = await usersService.deleteUsers(id);

    logger.success("UsersController → deleteUsers() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`UsersController → deleteUsers() error: ${error.message}`);
    next(error);
  }
};
