const sql = require("mssql");
const sqlConfig = require("../../config/sqlserver");

let pool;
let poolPromise;

async function getPool() {
  if (pool) {
    return pool;
  }

  if (!poolPromise) {
    console.log("Creating new SQL Server connection pool...");

    poolPromise = sql.connect(sqlConfig).then((connectedPool) => {
      pool = connectedPool;
      return connectedPool;
    });
  }

  return poolPromise;
}

module.exports = { getPool };
