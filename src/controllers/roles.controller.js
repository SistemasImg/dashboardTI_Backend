const logger = require("../utils/logger");
const rolesService = require("../services/roles.service");

exports.allRoles = async (req, res, next) => {
  logger.info("RolesController → allRoles() called");

  try {
    const result = await rolesService.allRoles();

    logger.success("RolesController → allRoles() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`RolesController → allRoles() error: ${error.message}`);
    next(error);
  }
};
