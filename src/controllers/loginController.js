const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  // const hashedPassword = await bcrypt.hash(password, 10);
  // console.log("hashedPassword-----", hashedPassword);
  try {
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(404).json({ message: "Unregistered mail" });
    const { dataValues } = user;

    //console.log("user---", dataValues)
    const isMatch = await bcrypt.compare(password, dataValues.password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password" });

    // Generate token
    const payload = {
      id: dataValues.id,
      role_id: dataValues.role_id,
      status: dataValues.status,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });
    console.log("successful login");
    // Send
    res.status(200).json({
      success: true,
      message: "Successful Login",
      token,
      user: {
        id: dataValues.id,
        fullname: dataValues.fullname,
        email: dataValues.email,
        role_id: dataValues.role_id,
        username: dataValues.username,
        phone: dataValues.phone,
        status: dataValues.status,
        dateCreate: dataValues.created_at.toLocaleDateString("es-PE"),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error function login",
      error: err.message,
    });
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: {
        exclude: ["password"],
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error obtaining the user",
      error: err.message,
    });
  }
};
