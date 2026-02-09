const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MediaFiles = sequelize.define(
  "MediaFiles",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(250),
      allowNull: false,
    },
    url: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isUrl: true },
    },
  },
  {
    tableName: "media_files",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    freezeTableName: true,
  },
);

module.exports = MediaFiles;
