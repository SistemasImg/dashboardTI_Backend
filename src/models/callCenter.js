const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CallCenter = sequelize.define(
  "CallCenter",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING(100), allowNull: false },
    status: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    tableName: "call_center",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = CallCenter;
