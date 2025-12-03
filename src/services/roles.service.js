const logger = require("../utils/logger");
const { Role } = require("../models");

exports.allRoles = async () => {
  logger.info("RolesService → allRoles() started");

  const roles = await Role.findAll();

  if (!roles || roles.length === 0) {
    logger.warn("RolesService → No roles found");
    const err = new Error("No roles found");
    err.status = 404;
    throw err;
  }

  logger.success("RolesService → allRoles() OK");
  return roles;
};
