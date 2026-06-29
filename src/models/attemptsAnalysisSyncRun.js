const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AttemptsAnalysisSyncRun = sequelize.define(
  "AttemptsAnalysisSyncRun",
  {
    sync_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      primaryKey: true,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    fetched_cases: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "attempts_analysis_sync_runs",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_attempts_analysis_sync_window",
        fields: ["start_date", "end_date"],
      },
    ],
  },
);

module.exports = AttemptsAnalysisSyncRun;
