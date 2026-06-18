const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorProfile = sequelize.define(
  "VendorProfile",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    salesforce_user_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    username: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    account: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    supplier: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    supplier_segment: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    approval_after: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    first_seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    last_synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    computed_category: {
      type: DataTypes.ENUM("new_vendor", "top_vendors", "under_review"),
      allowNull: false,
      defaultValue: "under_review",
    },
    category_source: {
      type: DataTypes.ENUM("auto", "manual"),
      allowNull: false,
      defaultValue: "auto",
    },
    manual_category: {
      type: DataTypes.ENUM("new_vendor", "top_vendors", "under_review"),
      allowNull: true,
    },
    performance_score: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: false,
      defaultValue: 0,
    },
    metrics_json: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    consecutive_missed_weeks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    alert_flags: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "vendor_profiles",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = VendorProfile;
