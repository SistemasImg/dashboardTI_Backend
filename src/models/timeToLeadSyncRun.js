const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TimeToLeadSyncRun = sequelize.define(
  "TimeToLeadSyncRun",
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
    salesforce_total_cases: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    snapshot_total_cases: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "synced",
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "time_to_lead_sync_runs",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_ttl_sync_runs_synced_at",
        fields: ["synced_at"],
      },
      {
        name: "idx_ttl_sync_runs_status",
        fields: ["status"],
      },
    ],
  },
);

module.exports = TimeToLeadSyncRun;
