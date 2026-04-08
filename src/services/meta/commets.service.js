const axios = require("axios");
const logger = require("../../utils/logger");

const sendToActiveProspect = async (payload) => {
  try {
    const url = process.env.ACTIVE_PROSPECT_URL;
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "ap-facebook",
      },
    });

    logger.success("Lead sent to ActiveProspect");

    return response.data;
  } catch (error) {
    logger.error(`Error sending to ActiveProspect: ${error.message}`);
    return null;
  }
};

const extractIncidentDescription = (rawData) => {
  try {
    logger.info(`Raw data type: ${typeof rawData}`);

    let parsed;

    // If it's already an array, use it directly
    if (Array.isArray(rawData)) {
      parsed = rawData;
    }
    // If it's a string, parse it
    else if (typeof rawData === "string") {
      parsed = JSON.parse(rawData);
    }
    // If it's something else, fallback
    else {
      logger.warn("Unknown data format for facebook_field_data_apros");
      return null;
    }

    // Find the specific field
    const incidentField = parsed.find(
      (field) =>
        field.name ===
        "can_you_briefly_describe_what_happened_during_your_rideshare_trip",
    );

    const value = incidentField?.values?.[0] || null;

    logger.info(`Incident extracted`);

    return value;
  } catch (error) {
    logger.error(
      `Error processing facebook_field_data_apros: ${error.message}`,
    );
    return null;
  }
};

module.exports = {
  extractIncidentDescription,
  sendToActiveProspect,
};
