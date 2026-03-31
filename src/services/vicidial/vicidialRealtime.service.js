const axios = require("axios");
const logger = require("../../utils/logger");
const { parseRealtimeTable } = require("../../utils/vicidialRealtimeParser");

const getRealtimeFromVicidial = async () => {
  try {
    logger.info("Fetching realtime data from Vicidial UI endpoint");

    const username = process.env.VICIDIAL_USER;
    const password = process.env.VICIDIAL_PASS;

    console.log("Using Vicidial credentials:", password);
    const token = Buffer.from(`${username}:${password}`).toString("base64");

    const response = await axios.post(
      "https://img.integradial.us/admin/AST_timeonVDADall.php",
      new URLSearchParams({
        // 🔥 body vacío pero requerido
      }),
      {
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://img.integradial.us/admin/realtime_report.php",
          Origin: "https://img.integradial.us",
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
