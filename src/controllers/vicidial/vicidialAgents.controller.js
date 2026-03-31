const {
  getAgentsRealtime,
} = require("../../services/vicidial/vicidialAgents.service");
const logger = require("../../utils/logger");

const getAllAgentsRealtime = async (req, res) => {
  try {
    logger.info("Request received: GET agents - realtime");

    const data = await getAgentsRealtime();

    res.status(200).json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    logger.error(`Controller error: ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error fetching realtime agents",
      error: error.message,
    });
  }
};

module.exports = {
  getAllAgentsRealtime,
};
