const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");
const { buildAttemptsByDateQuery } = require("./queries/attempts.query");
const { buildAttemptsTotalQuery } = require("./queries/totalAttemps.query");
const { getPool } = require("./pool.service");

async function getAttemptsByDate() {
  try {
    logger.info("📡 Connecting to SQL Server...");

    const pool = await sql.connect(sqlConfig);

    logger.info("📡 SQL Server connected");

    const result = await pool.request().query(MY_QUERY);

    logger.info("📊 SQL query executed successfully");

    return result;
  } catch (error) {
    logger.error("❌ SQL Server query failed", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name,
    });
    throw error; // 🔥 esto es CLAVE
  }
}

async function getAttemptsTotal() {
  const pool = await sql.connect(sqlConfig);

  const results = await pool.request().query(buildAttemptsTotalQuery());
  return results;
}

module.exports = {
  getAttemptsByDate,
  getAttemptsTotal,
};
