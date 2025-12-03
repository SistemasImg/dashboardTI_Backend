const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DidUat = sequelize.define(
  "DidUat",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nameRegister: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    testType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    testerId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    user: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    idProduct: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    uatType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    contact: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    did: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    didDate: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    mode: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    cpaCpl: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "failed", "passed"),
      allowNull: false,
      defaultValue: "pending",
    },
    observations: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    checklist: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    metris: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "diduat",
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = DidUat;
