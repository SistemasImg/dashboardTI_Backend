const { getAllUsers } = require("../services/allUserServices");

async function allUsers(req, res) {
  try {
    const users = await getAllUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Error function allUsers", error });
  }
}

module.exports = {
  allUsers,
};
