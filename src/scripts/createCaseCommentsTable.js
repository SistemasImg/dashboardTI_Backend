/**
 * Migration script: creates the case_comments table.
 * Run once: node src/scripts/createCaseCommentsTable.js
 */
require("dotenv").config();
const sequelize = require("../config/db");
const CaseComment = require("../models/caseComment");

async function run() {
  try {
    await sequelize.authenticate();
    console.log("Database connection established.");

    await CaseComment.sync({ alter: true });
    console.log("Table case_comments is ready.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
