const logger = require("../utils/logger");

const STATIC_BEARER_TOKEN =
  "8f2b7c91d4e64aa9b31f0d7e5c2a8b66f14d93e7a0c54b2f8d61a3ce97b4f205";

function getTokenPreview(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return "missing";
  if (trimmed.length <= 12) return "provided";
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`;
}

function externalStaticBearer(req, res, next) {
  const authorizationHeader = String(req.headers.authorization || "").trim();
  const expectedHeader = `Bearer ${STATIC_BEARER_TOKEN}`;

  logger.info(
    `ExternalStaticBearer → authenticating ${req.method} ${req.originalUrl}`,
    {
      tokenPreview: getTokenPreview(
        authorizationHeader.replace(/^Bearer\s+/i, ""),
      ),
      ip: req.ip,
    },
  );

  if (authorizationHeader !== expectedHeader) {
    logger.warn(
      `ExternalStaticBearer → unauthorized request ${req.method} ${req.originalUrl}`,
      {
        tokenPreview: getTokenPreview(
          authorizationHeader.replace(/^Bearer\s+/i, ""),
        ),
        ip: req.ip,
      },
    );
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  logger.success(
    `ExternalStaticBearer → authorized request ${req.method} ${req.originalUrl}`,
    {
      ip: req.ip,
    },
  );

  return next();
}

module.exports = {
  externalStaticBearer,
  STATIC_BEARER_TOKEN,
};
