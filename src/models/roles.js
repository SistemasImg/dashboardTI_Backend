const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Roles = sequelize.define(
  "Roles",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    tableName: "roles",
  }
);

module.exports = Roles;
