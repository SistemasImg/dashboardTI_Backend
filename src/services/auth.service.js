const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { User } = require("../models");

require("dotenv").config();

exports.login = async (email, password) => {
  logger.info("AuthService → login() started");

  const user = await User.findOne({ where: { email } });

  if (!user) {
    logger.warn("AuthService → user not found");
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password);

  if (!isPasswordValid) {
    logger.warn("AuthService → invalid password");
    const err = new Error("Incorrect credentials");
    err.status = 401;
    throw err;
  }

  const token = jwt.sign(
    { id: user.id, role_id: user.role_id },
    process.env.JWT_SECRET,
    { expiresIn: "8h" },
  );

  logger.success("AuthService → login() OK");

  return {
    message: "Login successfully",
    token,
    user: {
      id: user.id,
      fullname: user.fullname,
      email: user.email,
      role_id: user.role_id,
      avatar: user.avatar,
    },
  };
};

exports.getCurrentUser = async (userId) => {
  logger.info("AuthService → getCurrentUser() started");

  const user = await User.findByPk(userId);

  if (!user) {
    logger.warn("AuthService → user not found");
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  logger.success("AuthService → current user retrieved");
  return user;
};
