module.exports = {
  baseUrl: process.env.INFOBIP_BASE_URL,
  apiKey: process.env.INFOBIP_API_KEY || "",
  sender: process.env.INFOBIP_SENDER || "",
  ccaasAgentId: process.env.INFOBIP_CCAAS_AGENT_ID || "",

  phoneLine: process.env.INFOBIP_CALL_PHONE || "",
  bookingUrl: process.env.INFOBIP_BOOKING_URL || "",
};
