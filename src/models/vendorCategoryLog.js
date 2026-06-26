const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorCategoryLog = sequelize.define(
  "VendorCategoryLog",
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
    from_category: {
      type: DataTypes.ENUM(
        "new_vendor",
        "top_vendors",
        "under_review",
        "critical_vendor",
      ),
      allowNull: true,
    },
    to_category: {
      type: DataTypes.ENUM(
        "new_vendor",
        "top_vendors",
        "under_review",
        "critical_vendor",
      ),
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    triggered_by: {
      type: DataTypes.ENUM("auto", "manual"),
      allowNull: false,
      defaultValue: "auto",
    },
  },
  {
    tableName: "vendor_category_logs",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [{ fields: ["vendor_id"] }, { fields: ["created_at"] }],
  },
);

module.exports = VendorCategoryLog;
