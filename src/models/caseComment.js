const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CaseComment = sequelize.define(
  "case_comments",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    case_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
  },
  {
    tableName: "case_comments",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    freezeTableName: true,
    indexes: [
      {
        unique: true,
        fields: ["case_number"],
      },
    ],
  },
);

module.exports = CaseComment;
