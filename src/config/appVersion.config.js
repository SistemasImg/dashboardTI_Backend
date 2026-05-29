const packageJson = require("../../package.json");

function normalizeVersion(value) {
  return String(value || "").trim();
}

const appVersion =
  normalizeVersion(process.env.APP_VERSION) ||
  normalizeVersion(process.env.RENDER_GIT_COMMIT) ||
  normalizeVersion(process.env.RENDER_DEPLOY_ID) ||
  normalizeVersion(packageJson.version) ||
  "dev";

const forceReloginOnDeploy =
  String(process.env.FORCE_RELOGIN_ON_DEPLOY || "false").toLowerCase() ===
  "true";

module.exports = {
  appVersion,
  forceReloginOnDeploy,
};
