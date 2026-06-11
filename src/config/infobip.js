function sanitizeEnvValue(value) {
  const normalized = String(value || "").trim();
  return normalized.replace(/^['"]+|['"]+$/g, "");
}

function parseEndpointList(value, fallback) {
  const normalized = sanitizeEnvValue(value);
  if (!normalized) {
    return fallback;
  }

  const items = normalized
    .split(",")
    .map((item) => sanitizeEnvValue(item))
    .filter(Boolean);

  return items.length ? items : fallback;
}

module.exports = {
  baseUrl: sanitizeEnvValue(process.env.INFOBIP_BASE_URL).replace(/\/$/, ""),
  apiKey: sanitizeEnvValue(process.env.INFOBIP_API_KEY),
  sender: sanitizeEnvValue(process.env.INFOBIP_SENDER),
  ccaasAgentId: sanitizeEnvValue(process.env.INFOBIP_CCAAS_AGENT_ID),
  conversationListEndpoints: parseEndpointList(
    process.env.INFOBIP_CONVERSATION_LIST_ENDPOINTS,
    ["/ccaas/1/conversations"],
  ),

  phoneLine: sanitizeEnvValue(process.env.INFOBIP_CALL_PHONE),
  bookingUrl: sanitizeEnvValue(process.env.INFOBIP_BOOKING_URL),
};
