const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorWeeklyGoal = sequelize.define(
  "VendorWeeklyGoal",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    vendor_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    product_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    week_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    week_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    weekly_target: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    actual_inflow: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    actual_outflow: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    goal_met: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "vendor_weekly_goals",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["vendor_id", "product_id", "week_start"],
      },
      { fields: ["week_start"] },
    ],
  },
);

module.exports = VendorWeeklyGoal;
