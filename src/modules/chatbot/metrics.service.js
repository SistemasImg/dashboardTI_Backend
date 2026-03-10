const logger = require("../../utils/logger");
const sequelize = require("../../config/db");

/**
 * Get today's attempts from MySQL
 */
exports.getAttemptsToday = async () => {
  try {
    logger.info("Fetching today's attempts from MySQL");

    const [result] = await sequelize.query(`
      SELECT COUNT(*) as total
      FROM attempts_daily
      WHERE DATE(call_date) = CURDATE()
    `);

    const total = result[0]?.total || 0;

    logger.success(`Attempts today: ${total}`);

    return total;
  } catch (error) {
    logger.error(`Error fetching attempts: ${error.message}`);
    throw error;
  }
};

/**
 * Get case assignments (calls) from MySQL
 */
exports.getCallsToday = async () => {
  try {
    logger.info("Fetching today's calls from MySQL");

    const [result] = await sequelize.query(`
      SELECT COUNT(*) as total
      FROM case_assignments c
    `);

    const total = result[0]?.total || 0;

    logger.success(`Calls today: ${total}`);

    return total;
  } catch (error) {
    logger.error(`Error fetching calls: ${error.message}`);
    throw error;
  }
};
