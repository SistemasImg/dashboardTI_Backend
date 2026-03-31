const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MessageRecords = sequelize.define(
  "message_records",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    numberphone: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    id_agent: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    bulkId: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    messageId: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    groupName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    direction: {
      type: DataTypes.ENUM("OUTBOUND", "INBOUND"),
      allowNull: false,
      defaultValue: "OUTBOUND",
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    groupId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    id_extern: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    tableName: "message_records",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    freezeTableName: true,
  },
);

module.exports = MessageRecords;
