const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");
const { buildAttemptsByDateQuery } = require("./queries/attempts.query");
const { buildAttemptsTotalQuery } = require("./queries/totalAttemps.query");
const { getPool } = require("./pool.service");

async function getAttemptsByDate() {
  const pool = await getPool();
  return pool.request().query(buildAttemptsByDateQuery());
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
