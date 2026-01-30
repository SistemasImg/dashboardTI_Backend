const logger = require("../utils/logger");
const { AttemptsDaily } = require("../models");
const { Op, fn, col } = require("sequelize");

exports.getAttemptsLastNDays = async (days = 3) => {
  logger.info("AttemptsDailyService → getAttemptsLastNDays() started");

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const results = await AttemptsDaily.findAll({
      where: {
        call_date: {
          [Op.gte]: startDate,
        },
      },
      raw: true,
      order: [["call_date", "DESC"]],
    });

    logger.success("AttemptsDailyService → getAttemptsLastNDays() OK");
    return results;
  } catch (error) {
    logger.error("AttemptsDailyService → getAttemptsLastNDays() error");
    throw error;
  }
};

exports.getTotalAttempts = async () => {
  logger.info("AttemptsDailyService → getTotalAttempts() started");

  try {
    const results = await AttemptsDaily.findAll({
      attributes: ["phone", [fn("SUM", col("attempts")), "totalAttempts"]],
      group: ["phone"],
      raw: true,
      order: [[fn("SUM", col("attempts")), "DESC"]],
    });

    logger.success("AttemptsDailyService → getTotalAttempts() OK");
    return results;
  } catch (error) {
    logger.error("AttemptsDailyService → getTotalAttempts() error", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};
