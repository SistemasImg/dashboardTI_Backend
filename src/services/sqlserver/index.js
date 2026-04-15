const logger = require("../../utils/logger");
const { buildAttemptsByDateQuery } = require("./queries/attempts.query");
const { buildAttemptsTotalQuery } = require("./queries/totalAttemps.query");
const { buildAgentsAttemptsQuery } = require("./queries/attempsxAgent");
const sqlServerPool = require("./pool.service");

async function getAttemptsByDate() {
  try {
    logger.info("📡 Connecting to SQL Server...");

    const pool = await sqlServerPool.getPool();

    logger.info("💾 Upserting into MySQL...");

    logger.info("📊 SQL query executed successfully");

    return pool.request().query(buildAttemptsByDateQuery());
  } catch (error) {
    console.error("❌ SQL SERVER REAL ERROR:");
    console.dir(error, { depth: null });
    throw error;
  }
}

async function getAttemptsTotal() {
  const pool = await sqlServerPool.getPool();

  const results = await pool.request().query(buildAttemptsTotalQuery());
  return results;
}

/**
 * Get agents attempts for a specific date
 * @param {String} date - Date in format YYYY-MM-DD (optional, defaults to today)
 * @returns {Array} Array of agents attempts records
 */
async function getAgentsAttempts(date = null) {
  try {
    logger.info(
      `📡 Connecting to SQL Server for agents attempts${date ? " for date: " + date : "..."}`,
    );

    const pool = await sqlServerPool.getPool();

    logger.info("📊 Executing agents attempts query...");

    const { recordsets } = await pool
      .request()
      .query(buildAgentsAttemptsQuery(date));

    logger.info("✅ Agents attempts query executed successfully");

    return recordsets[0];
  } catch (error) {
    logger.error("❌ SQL Server agents attempts query failed", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name,
    });
    throw error;
  }
}

module.exports = {
  getAttemptsByDate,
  getAttemptsTotal,
  getAgentsAttempts,
};
