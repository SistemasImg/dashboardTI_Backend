const logger = require("../../utils/logger");
const {
  searchVicidialLeadByPhone,
} = require("../../services/vicidial/vicidialLeadSearch.service");

async function searchLeadByPhone(req, res) {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone query param is required",
      });
    }

    const result = await searchVicidialLeadByPhone(phone);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error(`VicidialLeadSearchController error: ${error.message}`);

    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error searching lead in Vicidial",
      error: error.message,
    });
  }
}

module.exports = {
  searchLeadByPhone,
};
