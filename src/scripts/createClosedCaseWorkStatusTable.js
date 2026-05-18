/**
 * Migration script: creates the closed_case_work_status table.
 * Run once: node src/scripts/createClosedCaseWorkStatusTable.js
 */
require("dotenv").config();
const sequelize = require("../config/db");
const ClosedCaseWorkStatus = require("../models/closedCaseWorkStatus");

async function run() {
  try {
    await sequelize.authenticate();
    console.log("Database connection established.");

    await ClosedCaseWorkStatus.sync({ alter: true });
    console.log("Table closed_case_work_status is ready.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
