const axios = require("axios");
const https = require("node:https");
const sapConfig = require("../../config/sap");
const {
  getCachedOAuthToken,
  setCachedOAuthToken,
} = require("./tokenCache.service");

function getHttpsAgent() {
  return new https.Agent({ rejectUnauthorized: sapConfig.rejectUnauthorized });
}

function hasBasicCredentials() {
  return Boolean(sapConfig.username && sapConfig.password);
}

function hasOAuthCredentials() {
  return Boolean(
    sapConfig.tokenUrl && sapConfig.clientId && sapConfig.clientSecret,
  );
}

function isSapConfigured() {
  if (
    !sapConfig.enabled ||
    !sapConfig.baseUrl ||
    !sapConfig.supplierInvoiceEndpoint
  ) {
    return false;
  }

  if (sapConfig.authType === "none") return true;
  if (sapConfig.authType === "oauth2_client_credentials") {
    return hasOAuthCredentials();
  }

  return hasBasicCredentials();
}

async function getOAuthToken() {
  const cached = getCachedOAuthToken();
  if (cached) return cached;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: sapConfig.clientId,
    client_secret: sapConfig.clientSecret,
  });

  const response = await axios.post(sapConfig.tokenUrl, params, {
    httpsAgent: getHttpsAgent(),
    timeout: sapConfig.timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const accessToken = response.data?.access_token;
  if (!accessToken) {
    const error = new Error(
      "SAP OAuth token response did not include access_token",
    );
    error.status = 502;
    throw error;
  }

  setCachedOAuthToken(accessToken, response.data?.expires_in);
  return accessToken;
}

async function getSapAuthHeaders() {
  if (sapConfig.authType === "none") return {};

  if (sapConfig.authType === "oauth2_client_credentials") {
    const accessToken = await getOAuthToken();
    return { Authorization: `Bearer ${accessToken}` };
  }

  const encoded = Buffer.from(
    `${sapConfig.username}:${sapConfig.password}`,
  ).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

module.exports = {
  getHttpsAgent,
  getSapAuthHeaders,
  isSapConfigured,
};
