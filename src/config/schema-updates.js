const { DataTypes } = require("sequelize");
const logger = require("../utils/logger");
const ImginaSmsSession = require("../models/imginaSmsSession");

const isMissingTableError = (error) =>
  error?.original?.code === "ER_NO_SUCH_TABLE" ||
  error?.name === "SequelizeUnknownTableError";

const isDuplicateColumnError = (error) =>
  error?.original?.code === "ER_DUP_FIELDNAME";

async function ensureProductTiersColumn(sequelize) {
  const queryInterface = sequelize.getQueryInterface();

  let tableDefinition;
  try {
    tableDefinition = await queryInterface.describeTable("products");
  } catch (error) {
    if (isMissingTableError(error)) {
      logger.warn(
        "SchemaUpdate → products table does not exist yet; tiers column check skipped",
      );
      return;
    }

    throw error;
  }

  if (tableDefinition.tiers) {
    logger.info("SchemaUpdate → products.tiers already exists");
    return;
  }

  try {
    await queryInterface.addColumn("products", "tiers", {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    });
    logger.success("SchemaUpdate → products.tiers column created");
  } catch (error) {
    if (isDuplicateColumnError(error)) {
      logger.info("SchemaUpdate → products.tiers already exists");
      return;
    }

    throw error;
  }
}

async function ensureImginaSmsSessionsTable() {
  await ImginaSmsSession.sync();
  logger.info("SchemaUpdate -> imgina_sms_sessions ready");
}

module.exports = {
  ensureProductTiersColumn,
  ensureImginaSmsSessionsTable,
};
