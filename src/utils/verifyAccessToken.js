const jwt = require("jsonwebtoken");
const {
  appVersion,
  forceReloginOnDeploy,
} = require("../config/appVersion.config");

function verifyAccessToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (forceReloginOnDeploy && decoded.app_version !== appVersion) {
    const error = new Error("Session expired due to a new deployment");
    error.name = "TokenVersionMismatchError";
    throw error;
  }

  return decoded;
}

module.exports = {
  verifyAccessToken,
};
