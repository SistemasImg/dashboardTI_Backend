const logger = require("../utils/logger");
const { User, Role, CallCenter } = require("../models");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

exports.allUsers = async (filters) => {
  logger.info("UsersService → allUsers() started");

  const whereConditions = {
    ...(filters.call_center_id && { call_center_id: filters.call_center_id }),
  };

  if (filters.role_id) {
    const roleIds = filters.role_id
      .split(",")
      .map((id) => Number.parseInt(id, 10));
    whereConditions.role_id = { [Op.in]: roleIds };
  }

  const users = await User.findAll({
    where: {
      status: "active",
      ...whereConditions,
    },
    attributes: {
      exclude: ["password", "updated_at"],
    },
    include: [
      {
        model: Role,
        as: "Role",
        attributes: ["id", "name"],
      },
      {
        model: CallCenter,
        as: "callCenter",
        attributes: ["id", "name"],
      },
    ],
  });

  if (!users || users.length === 0) {
    logger.warn("UsersService → No users found");
    const err = new Error("No users found");
    err.status = 404;
    throw err;
  }
  logger.success("UsersService → allUsers() OK");

  // Formatting the creation date
  const formattedUsers = users.map((user) => {
    const u = user.toJSON();

    const date = new Date(u.created_at);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    u.created_at = `${day}/${month}/${year}`;

    // Removing the reference to Role and CallCenter
    delete u.role_id;
    delete u.call_center_id;

    return u;
  });

  logger.success("UsersService → allUsers() OK");
  return formattedUsers;
};

exports.createUser = async (data) => {
  try {
    logger.info("UsersService → createUser() started");
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
      log_pass: password,
    });
    logger.success("UsersService → User created");
    return {
      message: "User created successfully",
      user: newUser,
    };
  } catch (error) {
    error.status = error.status || 500;
    throw error;
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

  const updateData = { ...data };
  if (data.password && data.password.trim() !== "") {
    updateData.password = bcrypt.hashSync(data.password, 10);
    updateData.log_pass = data.password;
  } else {
    delete updateData.password;
  }

  await user.update(updateData);

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

  await user.update({ status: "inactive" });

  logger.success("UsersService → User status updated to inactive");

  return {
    message: "User deleted successfully",
  };
};
