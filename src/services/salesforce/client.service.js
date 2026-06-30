const axios = require("axios");
const https = require("node:https");
const salesforceConfig = require("../../config/salesforce");
const { authenticateSalesforce } = require("./auth.service");
const { clearCachedToken } = require("./tokenCache.service");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function isSalesforceUnauthorized(error) {
  if (error?.response?.status === 401) {
    return true;
  }

  const responseData = error?.response?.data;
  const salesforceErrors = Array.isArray(responseData)
    ? responseData
    : [responseData].filter(Boolean);

  return salesforceErrors.some(
    (item) =>
      String(item?.errorCode || item?.error || "") === "INVALID_SESSION_ID",
  );
}

async function withSalesforceReauth(sf, requestFn, refreshAttempted = false) {
  try {
    return await requestFn(sf);
  } catch (error) {
    if (!refreshAttempted && isSalesforceUnauthorized(error)) {
      clearCachedToken();
      const refreshedConnection = await authenticateSalesforce();
      return withSalesforceReauth(refreshedConnection, requestFn, true);
    }

    throw error;
  }
}

async function runSoqlQuery(sf, soql, retries = 2) {
  try {
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.get(
        `${connection.instanceUrl}/services/data/${salesforceConfig.apiVersion}/query`,
        {
          httpsAgent,
          timeout: 30000,
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
          },
          params: { q: soql },
        },
      ),
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
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.get(
        `${connection.instanceUrl}/services/data/${salesforceConfig.apiVersion}/query`,
        {
          httpsAgent,
          timeout: 30000,
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
          },
          params: { q: soql },
        },
      ),
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

async function runToolingQuery(sf, soql, retries = 2) {
  try {
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.get(
        `${connection.instanceUrl}/services/data/${salesforceConfig.apiVersion}/tooling/query`,
        {
          httpsAgent,
          timeout: 30000,
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
          },
          params: { q: soql },
        },
      ),
    );

    return response.data.records;
  } catch (error) {
    if (retries > 0) {
      console.warn("Retrying Salesforce Tooling query...", retries);
      return runToolingQuery(sf, soql, retries - 1);
    }
    throw error;
  }
}

function formatSalesforceError(error, fallbackMessage) {
  const sfErrors = error?.response?.data;
  const sfDetail = Array.isArray(sfErrors)
    ? sfErrors.map((e) => `[${e.errorCode}] ${e.message}`).join(" | ")
    : String(sfErrors || error.message);

  const enriched = new Error(`${fallbackMessage}: ${sfDetail}`);
  enriched.status = error?.response?.status || 500;
  enriched.salesforceErrors = sfErrors || null;
  return enriched;
}

async function getSalesforceToolingSObject(sf, objectName, recordId) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/tooling/sobjects/${objectName}/${recordId}`;

  try {
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.get(endpoint, {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
        },
      }),
    );

    return response.data;
  } catch (error) {
    throw formatSalesforceError(
      error,
      `Salesforce Tooling GET ${objectName}/${recordId} failed`,
    );
  }
}

async function createSalesforceToolingSObject(sf, objectName, payload) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/tooling/sobjects/${objectName}`;

  try {
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.post(endpoint, payload, {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
      }),
    );

    return response.data;
  } catch (error) {
    throw formatSalesforceError(
      error,
      `Salesforce Tooling POST ${objectName} failed`,
    );
  }
}

async function patchSalesforceToolingSObject(
  sf,
  objectName,
  recordId,
  payload,
) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/tooling/sobjects/${objectName}/${recordId}`;

  try {
    await withSalesforceReauth(sf, (connection) =>
      axios.patch(endpoint, payload, {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
      }),
    );
  } catch (error) {
    throw formatSalesforceError(
      error,
      `Salesforce Tooling PATCH ${objectName}/${recordId} failed`,
    );
  }
}

async function fetchSalesforceQueryPage(sf, url, retries = 2) {
  try {
    const response = await withSalesforceReauth(sf, (connection) =>
      axios.get(url, {
        httpsAgent,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
        },
      }),
    );

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

async function deleteSalesforceSObject(sf, objectName, recordId) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/${objectName}/${recordId}`;

  try {
    await axios.delete(endpoint, {
      httpsAgent,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
      },
    });

    return { success: true, id: recordId };
  } catch (error) {
    const sfErrors = error?.response?.data;
    const sfDetail = Array.isArray(sfErrors)
      ? sfErrors.map((e) => `[${e.errorCode}] ${e.message}`).join(" | ")
      : String(sfErrors || error.message);

    const enriched = new Error(
      `Salesforce DELETE ${objectName}/${recordId} failed: ${sfDetail}`,
    );
    enriched.status = error?.response?.status || 500;
    enriched.salesforceErrors = sfErrors || null;
    throw enriched;
  }
}

async function resetSalesforceUserPassword(sf, userId) {
  const endpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/User/${userId}/password`;

  try {
    const response = await axios.delete(endpoint, {
      httpsAgent,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
      },
    });

    return response.data || null;
  } catch (error) {
    const sfErrors = error?.response?.data;
    const sfDetail = Array.isArray(sfErrors)
      ? sfErrors.map((e) => `[${e.errorCode}] ${e.message}`).join(" | ")
      : String(sfErrors || error.message);

    const enriched = new Error(
      `Salesforce reset password for User/${userId} failed: ${sfDetail}`,
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
  runToolingQuery,
  patchSalesforceSObject,
  createSalesforceSObject,
  deleteSalesforceSObject,
  getSalesforceToolingSObject,
  createSalesforceToolingSObject,
  patchSalesforceToolingSObject,
  resetSalesforceUserPassword,
};
