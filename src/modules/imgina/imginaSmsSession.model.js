const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const ImginaSmsSession = sequelize.define(
  "ImginaSmsSession",
  {
    phone_digits: {
      type: DataTypes.STRING(10),
      allowNull: false,
      primaryKey: true,
    },
    phone_e164: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    lead_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    system_prompt: {
      type: DataTypes.TEXT("long"),
      allowNull: false,
    },
    messages: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    recent_message_ids: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "imgina_sms_sessions",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = ImginaSmsSession;
