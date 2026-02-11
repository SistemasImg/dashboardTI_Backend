const logger = require("../../utils/logger");
const { buildAttemptsByDateQuery } = require("./queries/attempts.query");
const { buildAttemptsTotalQuery } = require("./queries/totalAttemps.query");
const sqlServerPool = require("../../services/sqlserver/pool.service");

async function getAttemptsByDate() {
  try {
    logger.info("📡 Connecting to SQL Server...");

    const pool = await sqlServerPool.getPool();

    console.log("SQL Server connection pool:", pool);
    logger.info("💾 Upserting into MySQL...");

    logger.info("📊 SQL query executed successfully");
    const query = buildAttemptsByDateQuery();
    console.log("QUERY BEING EXECUTED:", query);

    return pool.request().query(buildAttemptsByDateQuery());
    // } catch (error) {
    //   logger.error("❌ SQL Server query failed", {
    //     message: error.message,
    //     stack: error.stack,
    //     code: error.code,
    //     name: error.name,
    //   });
    // }
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

module.exports = {
  getAttemptsByDate,
  getAttemptsTotal,
};
