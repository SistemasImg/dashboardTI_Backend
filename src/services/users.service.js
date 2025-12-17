const logger = require("../utils/logger");
const { User } = require("../models");
const bcrypt = require("bcryptjs");

exports.allUsers = async () => {
  logger.info("UsersService → allUsers() started");

  const users = await User.findAll();

  if (!users || users.length === 0) {
    logger.warn("UsersService → No users found");
    const err = new Error("No users found");
    err.status = 404;
    throw err;
  }

  logger.success("UsersService → allUsers() OK");
  return users;
};

exports.createUser = async (data) => {
  try {
    logger.info("UsersService → createUser() started");
    console.log("data received in createUser:", data); // Debugging line
    const { email, password } = data;

    const exists = await User.findOne({ where: { email } });
    if (exists) {
      logger.warn("UsersService → User already exists");
      const err = new Error("User already exists");
      err.status = 400;
      throw err;
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const newUser = await User.create({
      ...data,
      password: hashedPassword,
    });
    logger.success("UsersService → User created");
    return {
      message: "User created successfully",
      user: newUser,
    };
  } catch (error) {
    logger.error("Error in createUser:", error);
    const statusCode = error.status || 500;
    return {
      message: error.message || "Internal Server Error",
      statusCode,
    };
  }
};

exports.updateUsers = async (id, data) => {
  logger.info("UsersService → updateUsers() started");

  const user = await User.findByPk(id);

  if (!user) {
    logger.warn("UsersService → User not found");
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  await user.update(data);

  logger.success("UsersService → User updated");
  return {
    message: "User updated successfully",
    user,
  };
};

exports.deleteUsers = async (id) => {
  logger.info("UsersService → deleteUsers() started");

  const user = await User.findByPk(id);

  if (!user) {
    logger.warn("UsersService → User not found");
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  await user.destroy();

  logger.success("UsersService → User deleted");
  return {
    message: "User deleted successfully",
  };
};
