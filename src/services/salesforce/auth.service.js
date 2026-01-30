const axios = require("axios");
const https = require("https");
const salesforceConfig = require("../../config/salesforce");
const { getCachedToken, setCachedToken } = require("./tokenCache.service");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function authenticateSalesforce() {
  const cached = getCachedToken();
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: salesforceConfig.clientId,
    client_secret: salesforceConfig.clientSecret,
    username: salesforceConfig.username,
    password: salesforceConfig.password,
  });

  const response = await axios.post(salesforceConfig.loginUrl, params, {
    httpsAgent,
    timeout: 20000,
  });

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
