const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VendorTopReward = sequelize.define(
  "VendorTopReward",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    vendor_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      unique: true,
    },
    bonus_access: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    net_7: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    replacement_flexibility: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    auto_intake: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "vendor_top_rewards",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = VendorTopReward;
