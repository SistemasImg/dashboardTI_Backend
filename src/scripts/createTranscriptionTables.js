/**
 * Migration script: creates transcription tables.
 * Run once: node src/scripts/createTranscriptionTables.js
 */
require("dotenv").config();
const sequelize = require("../config/db");
const TranscriptionJob = require("../models/transcriptionJob");
const TranscriptionSegment = require("../models/transcriptionSegment");

async function run() {
  try {
    await sequelize.authenticate();
    console.log("Database connection established.");

    await TranscriptionJob.sync({ alter: true });
    await TranscriptionSegment.sync({ alter: true });

    console.log(
      "Tables transcription_jobs and transcription_segments are ready.",
    );
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
