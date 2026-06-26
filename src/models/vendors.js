const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Vendor = sequelize.define(
  "Vendor",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    salesforce_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    contact_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    country_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
    reactivated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deactivated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_status_changed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    supplier_segment: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    communication_channel: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    tort_tier_statuses: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    posting_methods: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
  },
  {
    tableName: "vendors",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = Vendor;
