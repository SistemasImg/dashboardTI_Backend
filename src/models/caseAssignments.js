const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CaseAssignment = sequelize.define(
  "CaseAssignment",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    case_number: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },

    agent_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    assigned_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    unassigned_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "case_assignments",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = CaseAssignment;
