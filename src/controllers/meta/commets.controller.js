const logger = require("../../utils/logger");
const {
  extractIncidentDescription,
  sendToActiveProspect,
} = require("../../services/meta/commets.service");

const receiveMetaLead = async (req, res) => {
  try {
    const data = req.body;

    logger.info("Meta lead received");

    const rawFields = data.facebook_field_data_apros;

    const incidentDescription = extractIncidentDescription(rawFields);

    const newPayload = {
      ...data,
      facebook_field_data_apros: JSON.stringify(data.facebook_field_data_apros),
      can_you_briefly_describe_what_happened_during_your_rideshare_trip:
        incidentDescription,
    };

    // Send to ActiveProspect
    await sendToActiveProspect(newPayload);

    logger.success("Lead processed and forwarded");

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error(`Controller error: ${error.message}`);

    return res.status(500).json({
      success: false,
      message: "Error processing Meta lead",
    });
  }
};

module.exports = {
  receiveMetaLead,
};
