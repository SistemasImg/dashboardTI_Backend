const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TimeToLeadSnapshot = sequelize.define(
  "TimeToLeadSnapshot",
  {
    case_number: {
      type: DataTypes.STRING(40),
      allowNull: false,
      primaryKey: true,
    },
    case_id: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    case_created_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    original_case_created_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    case_created_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    ttl_start_source: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "case_created",
    },
    ttl_start_substatus: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    full_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    substatus: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    reason_for_dq: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    reason_for_doesnt_meet_criteria: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    reason_for_spam: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    date_sent: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    ethnicity: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    origin: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    case_type: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    reason_for_rejection: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    owner_id: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    owner_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    week_label: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    has_valid_phone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    business_hours_eligible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    first_contact_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    first_contact_agent_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    response_delay: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    response_delay_minutes: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    range_time: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    match_source: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    match_status: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "no_first_call_found",
    },
    match_confidence: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    has_potential_phone_reuse: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    pending_minutes: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "time_to_lead_snapshots",
    timestamps: true,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_ttl_case_created_date",
        fields: ["case_created_date"],
      },
      {
        name: "idx_ttl_case_id",
        fields: ["case_id"],
      },
      {
        name: "idx_ttl_start_source",
        fields: ["ttl_start_source"],
      },
      {
        name: "idx_ttl_owner_name",
        fields: ["owner_name"],
      },
      {
        name: "idx_ttl_case_type",
        fields: ["case_type"],
      },
      {
        name: "idx_ttl_match_status",
        fields: ["match_status"],
      },
    ],
  },
);

module.exports = TimeToLeadSnapshot;
