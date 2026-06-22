const axios = require("axios");
const sapConfig = require("../../config/sap");
const { getHttpsAgent, getSapAuthHeaders } = require("./auth.service");
const {
  getCachedCsrfToken,
  setCachedCsrfToken,
  clearCachedCsrfToken,
} = require("./tokenCache.service");

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

function normalizeSapError(error) {
  const responseData = error?.response?.data;
  const sapMessage =
    responseData?.error?.message?.value ||
    responseData?.error?.message ||
    responseData?.message ||
    responseData;

  const detail =
    typeof sapMessage === "string"
      ? sapMessage
      : JSON.stringify(sapMessage || {});
  const enriched = new Error(`SAP request failed: ${detail || error.message}`);
  enriched.status = error?.response?.status || 502;
  enriched.sapResponse = responseData || null;
  throw enriched;
}

async function fetchCsrfToken(path) {
  const cacheKey = path;
  const cached = getCachedCsrfToken(cacheKey);
  if (cached) return cached;

  const authHeaders = await getSapAuthHeaders();
  const response = await axios.get(joinUrl(sapConfig.baseUrl, path), {
    httpsAgent: getHttpsAgent(),
    timeout: sapConfig.timeoutMs,
    headers: {
      ...authHeaders,
      "X-CSRF-Token": "Fetch",
      Accept: "application/json",
    },
  });

  const token = response.headers?.["x-csrf-token"];
  const cookie = response.headers?.["set-cookie"]?.join("; ") || null;

  if (!token) {
    const error = new Error("SAP did not return an X-CSRF-Token header");
    error.status = 502;
    throw error;
  }

  setCachedCsrfToken(cacheKey, token, cookie);
  return { token, cookie };
}

async function requestSap({ method, path, data, params, csrf = false }) {
  if (sapConfig.dryRun) {
    return {
      dryRun: true,
      method,
      path,
      params: params || null,
      payload: data || null,
    };
  }

  const authHeaders = await getSapAuthHeaders();
  const csrfHeaders = {};

  if (csrf && sapConfig.csrfEnabled) {
    const csrfToken = await fetchCsrfToken(path);
    csrfHeaders["X-CSRF-Token"] = csrfToken.token;
    if (csrfToken.cookie) csrfHeaders.Cookie = csrfToken.cookie;
  }

  try {
    const response = await axios.request({
      method,
      url: joinUrl(sapConfig.baseUrl, path),
      data,
      params,
      httpsAgent: getHttpsAgent(),
      timeout: sapConfig.timeoutMs,
      headers: {
        ...authHeaders,
        ...csrfHeaders,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    if (error?.response?.status === 403 && csrf) {
      clearCachedCsrfToken();
    }
    normalizeSapError(error);
  }
}

async function createSupplierInvoice(payload) {
  return requestSap({
    method: "post",
    path: sapConfig.supplierInvoiceEndpoint,
    data: payload,
    csrf: true,
  });
}

function buildAttachmentPath(pathTemplate, sapDocumentId) {
  return String(pathTemplate || "").replace(
    /:sapDocumentId/g,
    encodeURIComponent(String(sapDocumentId || "")),
  );
}

async function createSupplierInvoiceAttachment({ sapDocumentId, attachment }) {
  if (!sapConfig.supplierInvoiceAttachmentEndpoint) {
    const error = new Error(
      "SAP supplier invoice attachment endpoint is not configured",
    );
    error.status = 500;
    throw error;
  }

  const path = buildAttachmentPath(
    sapConfig.supplierInvoiceAttachmentEndpoint,
    sapDocumentId,
  );

  return requestSap({
    method: "post",
    path,
    data: {
      SupplierInvoiceDocument: sapDocumentId || null,
      FileName: attachment.fileName,
      MimeType: attachment.mimeType,
      FileSizeBytes: attachment.size,
      ContentBase64: attachment.base64,
    },
    csrf: true,
  });
}

module.exports = {
  createSupplierInvoice,
  createSupplierInvoiceAttachment,
  requestSap,
};
