const logger = require("../utils/logger");
const LandingUat = require("../models/LandingUat");
const { Op } = require("sequelize");

exports.createLandingUAT = async (data) => {
  logger.info("LandingUatService → createLandingUAT() started");

  try {
    const newUAT = await LandingUat.create(data);

    logger.success("LandingUatService → createLandingUAT() success");
    return newUAT;
  } catch (error) {
    logger.error("LandingUatService → createLandingUAT() error");
    throw error;
  }
};

exports.getLandingUAT = async (filters = {}) => {
  logger.info("LandingUatService → getLandingUAT() started");

  try {
    const where = {};

    if (filters.user) where.user = filters.user;
    if (filters.idProduct) where.idProduct = filters.idProduct;
    if (filters.idDomain) where.idDomain = filters.idDomain;
    if (filters.testerId) where.testerId = filters.testerId;

    if (filters.filterCreatedDate) {
      let [day, month, year] = filters.filterCreatedDate.split("/");
      if (day.length === 1) day = "0" + day;
      if (month.length === 1) month = "0" + month;

      const start = new Date(`${year}-${month}-${day}T00:00:00`);
      const end = new Date(`${year}-${month}-${day}T23:59:59`);

      where.created_at = { [Op.between]: [start, end] };
    }

    const results = await LandingUat.findAll({
      where,
      raw: true,
      order: [["id", "DESC"]],
      include: [
        { model: Product, as: "product" },
        { model: Domain, as: "domain" },
        { model: User, as: "tester" },
      ],
    });

    const formatted = results.map((item) => ({
      ...item,
      created_at: item.created_at.toISOString(),
      updated_at: item.updated_at.toISOString(),
    }));

    logger.success("LandingUatService → getLandingUAT() OK");
    return formatted;
  } catch (error) {
    logger.error("LandingUatService → getLandingUAT() error");
    throw error;
  }
};

exports.updateLandingUAT = async (id, data) => {
  logger.info("LandingUatService → updateLandingUAT() started");

  try {
    const [updated] = await LandingUat.update(data, { where: { id } });

    if (!updated) {
      logger.warn("LandingUatService → record not found");
      const err = new Error("Test not found");
      err.status = 404;
      throw err;
    }

    const record = await LandingUat.findByPk(id, { raw: true });

    logger.success("LandingUatService → updateLandingUAT() success");

    return {
      ...record,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    };
  } catch (error) {
    logger.error("LandingUatService → updateLandingUAT() error");
    throw error;
  }
};
