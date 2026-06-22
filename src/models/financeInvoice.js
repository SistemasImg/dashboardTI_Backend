const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FinanceInvoice = sequelize.define(
  "FinanceInvoice",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    invoice_uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      unique: true,
    },
    document_type: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    document_series: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    document_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    purchase_type: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    goods_services_type: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    identity_document_type: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    ruc: {
      type: DataTypes.STRING(11),
      allowNull: false,
    },
    business_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    currency_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    taxable_base_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    igv_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    validate_detraction: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    detraction_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },
    detraction_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "000",
    },
    detraction_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    pdf_file_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    pdf_mime_type: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    pdf_size_bytes: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    pdf_base64: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    sap_payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    sap_status: {
      type: DataTypes.ENUM("pending", "sent", "failed", "skipped"),
      allowNull: false,
      defaultValue: "pending",
    },
    sap_document_id: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    sap_response: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    sap_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    submitted_by_user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "finance_invoices",
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = FinanceInvoice;
