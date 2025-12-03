const logger = require("../utils/logger");
const { DidUat } = require("../models");
const { Op } = require("sequelize");

// ---------------------
// CREATE
// ---------------------
exports.createDidUAT = async (data) => {
  logger.info("DidUatService → createDidUAT() started");

  try {
    const {
      nameRegister,
      testType,
      testerId,
      user,
      idProduct,
      uatType,
      contact,
      did,
      didDate,
      mode,
      cpaCpl,
      status,
      observations,
      checklist,
      ...metricFields
    } = data;

    const metric = { ...metricFields };

    const saveData = {
      nameRegister,
      testType,
      testerId,
      user,
      idProduct,
      uatType,
      contact,
      did,
      didDate,
      mode,
      cpaCpl,
      status,
      observations,
      checklist,
      metris: JSON.stringify(metric),
    };

    const newUAT = await DidUat.create(saveData);

    logger.success("DidUatService → createDidUAT() OK");
    return newUAT;
  } catch (error) {
    logger.error("DidUatService → createDidUAT() error");
    throw error;
  }
};

// ---------------------
// GET
// ---------------------
exports.getDidUAT = async (filters = {}) => {
  logger.info("DidUatService → getDidUAT() started");

  try {
    const where = {};

    if (filters.contact) where.contact = filters.contact;
    if (filters.did) where.did = filters.did;
    if (filters.user) where.user = filters.user;
    if (filters.testerId) where.testerId = filters.testerId;
    if (filters.idProduct) where.idProduct = filters.idProduct;

    if (filters.filterCreatedDate) {
      let [day, month, year] = filters.filterCreatedDate.split("/");
      if (day.length === 1) day = "0" + day;
      if (month.length === 1) month = "0" + month;

      const start = new Date(`${year}-${month}-${day}T00:00:00`);
      const end = new Date(`${year}-${month}-${day}T23:59:59`);

      where.created_at = { [Op.between]: [start, end] };
    }

    const results = await DidUat.findAll({
      where,
      raw: true,
      order: [["id", "DESC"]],
    });

    const formatted = results.map((item) => ({
      ...item,
      didDate: formatDidDate(item.didDate),
      created_at: formatDate(item.created_at),
      updated_at: formatDate(item.updated_at),
    }));

    logger.success("DidUatService → getDidUAT() OK");
    return formatted;
  } catch (error) {
    logger.error("DidUatService → getDidUAT() error");
    throw error;
  }
};

// ---------------------
// UPDATE
// ---------------------
exports.updateDidUAT = async (id, data) => {
  logger.info("DidUatService → updateDidUAT() started");

  try {
    const [updated] = await DidUat.update(data, { where: { id } });

    if (!updated) {
      logger.warn("DidUatService → record not found");
      const err = new Error("Test not found");
      err.status = 404;
      throw err;
    }

    const record = await DidUat.findByPk(id, { raw: true });

    logger.success("DidUatService → updateDidUAT() OK");

    return {
      ...record,
      created_at: formatDate(record.created_at),
      updated_at: formatDate(record.updated_at),
    };
  } catch (error) {
    logger.error("DidUatService → updateDidUAT() error");
    throw error;
  }
};

// Helpers
function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDidDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-");
  return `${day}-${month}-${year}`;
}
