const axios = require("axios");
const logger = require("../../utils/logger");
const vicidialConfig = require("../../config/vicidial");
const { parseRealtimeTable } = require("../../utils/vicidialRealtimeParser");

const getRealtimeFromVicidial = async () => {
  try {
    logger.info("Fetching realtime data from Vicidial UI endpoint");

    const username = process.env.VICIDIAL_USER;
    const password = process.env.VICIDIAL_PASS;

    const token = Buffer.from(`${username}:${password}`).toString("base64");

    const response = await axios.post(
      `${vicidialConfig.ADMIN_BASE_URL}/AST_timeonVDADall.php`,
      new URLSearchParams({
        // body vacío pero requerido
      }),
      {
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: `${vicidialConfig.ADMIN_BASE_URL}/realtime_report.php`,
          Origin: vicidialConfig.ORIGIN,
        },
      },
    );

    const agents = parseRealtimeTable(response.data);

    logger.success("Realtime data fetched successfully");

    return agents;
  } catch (error) {
    logger.error(`Realtime fetch error: ${error.message}`);
    console.error(error.response?.data);
    throw error;
  }
};

module.exports = {
  getRealtimeFromVicidial,
};
