const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorTortAssignment = sequelize.define(
  "VendorTortAssignment",
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
    status: {
      type: DataTypes.ENUM("active", "inactive", "paused"),
      allowNull: false,
      defaultValue: "active",
    },
    notes: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    assigned_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
  },
  {
    tableName: "vendor_tort_assignments",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["vendor_id", "product_id"],
      },
    ],
  },
);

module.exports = VendorTortAssignment;
