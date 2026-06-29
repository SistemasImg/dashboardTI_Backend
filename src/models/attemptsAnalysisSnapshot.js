const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AttemptsAnalysisSnapshot = sequelize.define(
  "AttemptsAnalysisSnapshot",
  {
    case_number: {
      type: DataTypes.STRING(40),
      allowNull: false,
      primaryKey: true,
    },
    case_id: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    case_created_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    created_date: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    sent_date: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    owner_id: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    owner_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    origin: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    full_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone_number: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    substatus: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    case_type: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    tier: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    supplier_segment: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    reason_for_callback: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    total_calls: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    calls: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    vicidial_lookup_status: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "pending",
    },
    vicidial_lookup_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "attempts_analysis_snapshots",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_attempts_analysis_case_created_date",
        fields: ["case_created_date"],
      },
      {
        name: "idx_attempts_analysis_phone",
        fields: ["phone"],
      },
      {
        name: "idx_attempts_analysis_status",
        fields: ["vicidial_lookup_status"],
      },
    ],
  },
);

module.exports = AttemptsAnalysisSnapshot;
