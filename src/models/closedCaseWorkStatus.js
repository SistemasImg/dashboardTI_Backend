const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ClosedCaseWorkStatus = sequelize.define(
  "closed_case_work_status",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    case_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    excel_downloaded: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    recording_reviewed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    first_worked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_worked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
  },
  {
    tableName: "closed_case_work_status",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    freezeTableName: true,
    indexes: [
      {
        unique: true,
        fields: ["case_number"],
      },
      {
        fields: ["excel_downloaded"],
      },
      {
        fields: ["recording_reviewed"],
      },
      {
        fields: ["last_worked_at"],
      },
    ],
  },
);

module.exports = ClosedCaseWorkStatus;
