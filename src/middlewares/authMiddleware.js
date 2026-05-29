const { verifyAccessToken } = require("../utils/verifyAccessToken");
require("dotenv").config();

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token not provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;

    next();
  } catch (err) {
    const messageByErrorName = {
      TokenExpiredError: "Token has expired",
      TokenVersionMismatchError: "Session expired due to deployment update",
    };
    const message = messageByErrorName[err.name] || "Invalid token";
    return res.status(401).json({ message });
  }
};

module.exports = authMiddleware;
