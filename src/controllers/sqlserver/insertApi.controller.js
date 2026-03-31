const logger = require("../../utils/logger");
const {
  insertVicidialAgentTime,
} = require("../../services/sqlserver/insertApi.service");

// Simple Bearer token validation
function validateToken(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.split(" ")[1];

  return (
    token ===
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.8f3Kz9LmQ2xYp7VwR5nT1aBcD6eF0gHjK4Lp9ZxCqRs.uX7pQwE2rY9vN5tB3mH8kJcL6dF1sA0zXg4pR2yTnM"
  );
}

// Controller to insert data
async function insertAgentTime(req, res, next) {
  logger.info("VicidialController → insertAgentTime() called");

  try {
    // 🔐 Simple security (no authMiddleware)
    if (!validateToken(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await insertVicidialAgentTime(req.body);

    return res.status(200).json(result);
  } catch (error) {
    logger.error("VicidialController → error", error.message);
    next(error);
  }
}

module.exports = {
  insertAgentTime,
};
