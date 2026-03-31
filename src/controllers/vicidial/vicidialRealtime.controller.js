const {
  getRealtimeFromVicidial,
} = require("../../services/vicidial/vicidialRealtime.service");
const logger = require("../../utils/logger");

const getRealtime = async (req, res) => {
  try {
    logger.info("Request realtime Vicidial agents");

    const data = await getRealtimeFromVicidial();
    res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    logger.error(error.message);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getRealtime,
};
