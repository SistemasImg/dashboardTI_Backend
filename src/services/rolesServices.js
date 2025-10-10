const Roles = require("../models/roles");

async function getAllRoles() {
  try {
    const roles = await Roles.findAll({
      raw: true,
    });

    return roles;
  } catch (error) {
    console.error("error function getAllRoles", error);
  }
}

module.exports = {
  getAllRoles,
};
