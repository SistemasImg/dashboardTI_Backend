const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TranscriptionSegment = sequelize.define(
  "TranscriptionSegment",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    job_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    speaker: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    start_ms: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    end_ms: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    confidence: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    raw: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "transcription_segments",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["job_id"] }, { fields: ["job_id", "start_ms"] }],
  },
);

module.exports = TranscriptionSegment;
