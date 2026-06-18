const axios = require("axios");
const https = require("node:https");
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

async function fetchSalesforceQueryPage(sf, url, retries = 2) {
  try {
    const response = await axios.get(url, {
      httpsAgent,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
      },
    });

    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.warn("Retrying Salesforce query page...", retries);
      return fetchSalesforceQueryPage(sf, url, retries - 1);
    }
    throw error;
  }
}

async function runSoqlQueryAll(sf, soql) {
  const firstPage = await runSoqlQueryFull(sf, soql);
  const records = [...(firstPage.records || [])];
  let nextRecordsUrl = firstPage.nextRecordsUrl || null;

  while (nextRecordsUrl) {
    const page = await fetchSalesforceQueryPage(
      sf,
      `${sf.instanceUrl}${nextRecordsUrl}`,
    );
    records.push(...(page.records || []));
    nextRecordsUrl = page.nextRecordsUrl || null;
  }

  return records;
}

async function patchSalesforceSObject(sf, objectName, recordId, payload) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/${objectName}/${recordId}`;

  try {
    await axios.patch(endpoint, payload, {
      httpsAgent,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const sfErrors = error?.response?.data;
    const sfDetail = Array.isArray(sfErrors)
      ? sfErrors.map((e) => `[${e.errorCode}] ${e.message}`).join(" | ")
      : String(sfErrors || error.message);

    const enriched = new Error(
      `Salesforce PATCH ${objectName}/${recordId} failed: ${sfDetail}`,
    );
    enriched.status = error?.response?.status || 500;
    enriched.salesforceErrors = sfErrors || null;
    throw enriched;
  }
}

async function createSalesforceSObject(sf, objectName, payload) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/${objectName}`;

  try {
    const response = await axios.post(endpoint, payload, {
      httpsAgent,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    const sfErrors = error?.response?.data;
    const sfDetail = Array.isArray(sfErrors)
      ? sfErrors.map((e) => `[${e.errorCode}] ${e.message}`).join(" | ")
      : String(sfErrors || error.message);

    const enriched = new Error(
      `Salesforce POST ${objectName} failed: ${sfDetail}`,
    );
    enriched.status = error?.response?.status || 500;
    enriched.salesforceErrors = sfErrors || null;
    throw enriched;
  }
}

module.exports = {
  runSoqlQuery,
  runSoqlQueryFull,
  runSoqlQueryAll,
  patchSalesforceSObject,
  createSalesforceSObject,
};
