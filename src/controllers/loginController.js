const jwt = require("jsonwebtoken");
const {
  findUserByEmail,
  validatePassword,
  getUserById,
} = require("../services/loginService");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ message: "Unregistered mail" });

    const isMatch = await validatePassword(user, password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password" });

    const { dataValues } = user;
    const payload = {
      id: dataValues.id,
      role_id: dataValues.role_id,
      status: dataValues.status,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

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
    const user = await getUserById(req.user.id);
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
