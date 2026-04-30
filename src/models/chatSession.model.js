const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * Stores the full conversation history for each chatbot user.
 * One row per authenticated user — history is completely isolated.
 */
const ChatSession = sequelize.define(
  "ChatSession",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      unique: true,
      comment: "Authenticated user ID — one history row per user",
    },
    messages: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment:
        "Array of { role, content, timestamp } with the full conversation history",
    },
    last_filters: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment:
        "Last filters used — injected into follow-up queries for context",
    },
    last_results: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: "Compact summary of last results for context awareness",
    },
  },
  {
    tableName: "chat_sessions",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = ChatSession;
