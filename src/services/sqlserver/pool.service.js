const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");

let pool;

async function getPool() {
  if (!pool) {
    console.log("Creating new SQL Server connection pool...");

    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

module.exports = { getPool };
