const User = require("../models/user");
const bcrypt = require("bcryptjs");

async function findUserByEmail(email) {
  return await User.findOne({ where: { email } });
}

async function validatePassword(user, password) {
  return await bcrypt.compare(password, user.password);
}

async function getUserById(id) {
  return await User.findByPk(id, {
    attributes: { exclude: ["password"] },
  });
}

module.exports = {
  findUserByEmail,
  validatePassword,
  getUserById,
};
