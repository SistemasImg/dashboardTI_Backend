const User = require("../models/user");

async function getAllUsers() {
  try {
    const users = await User.findAll({
      where: { status: "active" },
      raw: true,
    });

    console.log("users", users);
    return users;
  } catch (error) {
    console.error("error function getAllUsers", error);
  }
}

module.exports = {
  getAllUsers,
};
