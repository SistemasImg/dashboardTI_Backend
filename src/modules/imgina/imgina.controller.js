const logger = require("../../utils/logger");
const { startSmsSession } = require("./imginaSms.service");

function getImginaSmsSecret() {
  return String(
    process.env.IMGINA_BACKEND_SMS_SECRET ||
      process.env.IMGINA_WEBHOOK_FORWARD_SECRET ||
      "",
  ).trim();
}

function isImginaSmsAuthorized(req) {
  const expectedSecret = getImginaSmsSecret();
  if (!expectedSecret) {
    return true;
  }

  const providedSecret = String(
    req.headers["x-imgina-forward-secret"] || "",
  ).trim();

  return providedSecret && providedSecret === expectedSecret;
}

async function startImginaSmsSession(req, res, next) {
  try {
    if (!isImginaSmsAuthorized(req)) {
      return res.status(403).json({
        ok: false,
        handled: false,
        target: "imgina",
        reason: "invalid_secret",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await startSmsSession({
      phone: body.phone,
      name: body.name,
      prequalData:
        body.prequal_data && typeof body.prequal_data === "object"
          ? body.prequal_data
          : {},
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error("ImginaController -> startImginaSmsSession error", {
      error: error.message,
      stack: error.stack,
    });

    if (error.status) {
      return res.status(error.status).json({
        ok: false,
        handled: false,
        target: "imgina",
        reason: error.message,
      });
    }

    next(error);
  }
}

module.exports = {
  startImginaSmsSession,
};
