const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TranscriptionJob = sequelize.define(
  "TranscriptionJob",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    case_number: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    recording_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    storage_blob_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    storage_blob_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    provider_job_id: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    provider_self_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    provider_status: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("queued", "running", "succeeded", "failed"),
      allowNull: false,
      defaultValue: "queued",
    },
    locale: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "en-US",
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    transcript_text: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    conversation: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    speaker_map: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    speaker_summary: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    call_metrics: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    call_outcome_code: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    call_outcome_label: {
      type: DataTypes.STRING(180),
      allowNull: true,
    },
    next_action_code: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    next_action_label: {
      type: DataTypes.STRING(180),
      allowNull: true,
    },
    ai_insights: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "transcription_jobs",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["status"] },
      { fields: ["case_number"] },
      { fields: ["provider_job_id"] },
      { fields: ["call_outcome_code"] },
      { fields: ["created_at"] },
    ],
  },
);

module.exports = TranscriptionJob;
