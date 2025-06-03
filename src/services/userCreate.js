const User = require("../models/user");
const bcrypt = require("bcryptjs");

exports.createUser = async ({
  fullname,
  email,
  username,
  password,
  role_id,
  phone,
}) => {
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = await User.create({
    fullname,
    email,
    username,
    password: hashedPassword,
    role_id,
    phone,
  });

  return {
    id: newUser.id,
    fullname: newUser.fullname,
    email: newUser.email,
    username: newUser.username,
  };
};
