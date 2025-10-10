const { getAllRoles } = require("../services/rolesServices");

async function allRoles(req, res) {
  try {
    const roles = await getAllRoles();
    res.status(200).json(roles);
  } catch (error) {
    res.status(500).json({ message: "Error function allRoles", error });
  }
}

module.exports = {
  allRoles,
};

module.exports = {
  allRoles,
};
