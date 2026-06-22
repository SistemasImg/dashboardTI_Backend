const axios = require("axios");
const https = require("node:https");
const salesforceConfig = require("../../config/salesforce");
const { getCachedToken, setCachedToken } = require("./tokenCache.service");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function getMissingSalesforceConfigKeys() {
  return [
    ["SF_CLIENT_ID", salesforceConfig.clientId],
    ["SF_CLIENT_SECRET", salesforceConfig.clientSecret],
    ["SF_USERNAME", salesforceConfig.username],
    ["SF_PASSWORD", salesforceConfig.password],
  ]
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);
}

async function authenticateSalesforce() {
  const cached = getCachedToken();
  if (cached) {
    return cached;
  }

  const missingKeys = getMissingSalesforceConfigKeys();
  if (missingKeys.length) {
    const error = new Error(
      `Salesforce auth configuration missing: ${missingKeys.join(", ")}`,
    );
    error.code = "SF_AUTH_CONFIG_MISSING";
    error.missingKeys = missingKeys;
    throw error;
  }

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: salesforceConfig.clientId,
    client_secret: salesforceConfig.clientSecret,
    username: salesforceConfig.username,
    password: salesforceConfig.password,
  });

  let response;
  try {
    response = await axios.post(salesforceConfig.loginUrl, params, {
      httpsAgent,
      timeout: 20000,
    });
  } catch (error) {
    const sfError = error?.response?.data;
    if (sfError?.error === "invalid_client") {
      const enriched = new Error(
        "Salesforce authentication failed: invalid client credentials",
      );
      enriched.code = "SF_AUTH_INVALID_CLIENT";
      enriched.status = error?.response?.status || 400;
      enriched.salesforceError = sfError;
      throw enriched;
    }
    throw error;
  }

  const tokenData = {
    accessToken: response.data.access_token,
    instanceUrl: response.data.instance_url,
  };

  setCachedToken(tokenData, response.data.expires_in);

  return tokenData;
}

module.exports = {
  authenticateSalesforce,
};
