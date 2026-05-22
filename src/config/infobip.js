function sanitizeEnvValue(value) {
  const normalized = String(value || "").trim();
  return normalized.replace(/^['"]+|['"]+$/g, "");
}

module.exports = {
  baseUrl: sanitizeEnvValue(process.env.INFOBIP_BASE_URL).replace(/\/$/, ""),
  apiKey: sanitizeEnvValue(process.env.INFOBIP_API_KEY),
  sender: sanitizeEnvValue(process.env.INFOBIP_SENDER),
  ccaasAgentId: sanitizeEnvValue(process.env.INFOBIP_CCAAS_AGENT_ID),

  phoneLine: sanitizeEnvValue(process.env.INFOBIP_CALL_PHONE),
  bookingUrl: sanitizeEnvValue(process.env.INFOBIP_BOOKING_URL),
};
