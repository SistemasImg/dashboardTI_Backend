const axios = require("axios");
const https = require("https");
const salesforceConfig = require("../../config/salesforce");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function runSoqlQuery(sf, soql, retries = 2) {
  try {
    const response = await axios.get(
      `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/query`,
      {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${sf.accessToken}`,
        },
        params: { q: soql },
      },
    );

    return response.data.records;
  } catch (error) {
    if (retries > 0) {
      console.warn("Retrying SOQL query...", retries);
      return runSoqlQuery(sf, soql, retries - 1);
    }
    throw error;
  }
}

async function runSoqlQueryFull(sf, soql, retries = 2) {
  try {
    const response = await axios.get(
      `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/query`,
      {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${sf.accessToken}`,
        },
        params: { q: soql },
      },
    );

    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.warn("Retrying SOQL query...", retries);
      return runSoqlQueryFull(sf, soql, retries - 1);
    }
    throw error;
  }
}

module.exports = {
  runSoqlQuery,
  runSoqlQueryFull,
};
