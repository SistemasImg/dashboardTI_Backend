const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AttemptsDaily = sequelize.define(
  "AttemptsDaily",
  {
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true,
    },
    call_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      primaryKey: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "attempts_daily",
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "idx_call_date",
        fields: ["call_date"],
      },
      {
        name: "idx_phone",
        fields: ["phone"],
      },
    ],
  }
);

module.exports = AttemptsDaily;
