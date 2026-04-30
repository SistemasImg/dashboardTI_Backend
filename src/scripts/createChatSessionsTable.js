/**
 * Migration script: creates (or migrates) the chat_sessions table.
 * Run once: node src/scripts/createChatSessionsTable.js
 *
 * If the table already exists with the old schema (session_id column),
 * this script drops and recreates it cleanly.
 */
require("dotenv").config();
const sequelize = require("../config/db");
const ChatSession = require("../models/chatSession.model");

async function run() {
  try {
    await sequelize.authenticate();
    console.log("Conexión a BD establecida.");

    // Drop and recreate to apply the new schema (user_id as unique key, no session_id).
    // WARNING: this clears any existing chat history in the table.
    await ChatSession.sync({ force: true });
    console.log("Table chat_sessions created successfully.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
