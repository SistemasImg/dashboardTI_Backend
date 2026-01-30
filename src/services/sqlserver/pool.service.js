const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");

let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

module.exports = { getPool };
