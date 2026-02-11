const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");

let pool;

async function getPool() {
  console.log("ENV DEBUG PROD:", {
    host: process.env.SQLSERVER_HOST,
    user: process.env.SQLSERVER_USER,
    db: process.env.SQLSERVER_DB,
    password: process.env.SQLSERVER_PASSWORD,
  });

  if (!pool) {
    console.log("Creating new SQL Server connection pool...");

    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

module.exports = { getPool };
