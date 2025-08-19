const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LandingUat = sequelize.define(
  "LandingUat",
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
    urlLanding: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    idDomain: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "failed", "passed"),
      allowNull: false,
      defaultValue: "pending",
    },
    observations: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    checklist: {
      type: DataTypes.JSON,
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
    tableName: "landingUat",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = LandingUat;
