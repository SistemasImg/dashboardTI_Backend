const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorCaseSnapshot = sequelize.define(
  "VendorCaseSnapshot",
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
    salesforce_case_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    case_number: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    product_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    case_created_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    signed_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    sent_date_2: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    outflow_validated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    sub_status: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    case_status: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
  },
  {
    tableName: "vendor_case_snapshots",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["vendor_id"] },
      { fields: ["product_id"] },
      { fields: ["case_created_at"] },
      { fields: ["sent_date_2"] },
    ],
  },
);

module.exports = VendorCaseSnapshot;
