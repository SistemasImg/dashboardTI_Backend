const logger = require("../../utils/logger");
const salesforceCasesConfig = require("../../config/salesforceCases.config");
const axios = require("axios");
const https = require("node:https");
const crypto = require("node:crypto");
const { verifyAccessToken } = require("../../utils/verifyAccessToken");
const { casesSalesforce, User } = require("../../models");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function sanitizeHeaders(headers = {}) {
  const cloned = { ...headers };
  if (cloned.Authorization) {
    cloned.Authorization = "[REDACTED]";
  }
  return cloned;
}

function buildAxiosErrorDetails(error) {
  return {
    isAxiosError: Boolean(error?.isAxiosError),
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    responseData: error?.response?.data,
    request: {
      method: error?.config?.method,
      url: error?.config?.url,
      timeout: error?.config?.timeout,
      headers: sanitizeHeaders(error?.config?.headers),
    },
  };
}

function detectSecurityChallenge(responseData) {
  if (typeof responseData !== "string") {
    return false;
  }

  const normalized = responseData.toLowerCase();
  return (
    normalized.includes("/.well-known/sgcaptcha") ||
    (normalized.includes("<html") && normalized.includes("captcha"))
  );
}

function getBasicAuthHeader() {
  const token = Buffer.from(
    `${salesforceCasesConfig.username}:${salesforceCasesConfig.password}`,
  ).toString("base64");

  return `Basic ${token}`;
}

function buildRequestHeaders(payload) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Authorization: getBasicAuthHeader(),
    "User-Agent": salesforceCasesConfig.userAgent,
  };

  if (salesforceCasesConfig.internalKey) {
    const timestamp = new Date().toISOString();
    const body = JSON.stringify(payload);

    headers["X-Api-Internal-Key"] = salesforceCasesConfig.internalKey;
    headers["X-Api-Timestamp"] = timestamp;
    headers["X-Api-Checksum"] = crypto
      .createHash("sha256")
      .update(`${timestamp}.${body}`)
      .digest("hex");
  }

  return headers;
}

async function postCases(url, payload) {
  return axios.post(url, payload, {
    headers: buildRequestHeaders(payload),
    httpsAgent,
    timeout: 15000,
  });
}

function ensureCasesApiConfig() {
  if (
    salesforceCasesConfig.url &&
    salesforceCasesConfig.username &&
    salesforceCasesConfig.password
  ) {
    return;
  }

  const error = new Error(
    "Salesforce cases API is not configured. Check API_USER / API_PASSWORD",
  );
  error.status = 500;
  error.details = {
    hasUrl: Boolean(salesforceCasesConfig.url),
    hasUsername: Boolean(salesforceCasesConfig.username),
    hasPassword: Boolean(salesforceCasesConfig.password),
  };
  throw error;
}

async function getAuthenticatedUser(token) {
  const decoded = verifyAccessToken(token);
  const userId = decoded?.id;

  if (!userId) {
    const authError = new Error("Invalid token payload: missing user id");
    authError.status = 401;
    throw authError;
  }

  const user = await User.findByPk(userId);
  if (!user) {
    const userError = new Error(
      `Authenticated user not found in DB (id: ${userId})`,
    );
    userError.status = 401;
    throw userError;
  }

  return user;
}

function resolveSalesforceResult(apiResponse, responseData) {
  const httpStatusCode = apiResponse?.httpStatusCode ?? 500;
  const body = apiResponse?.body;
  const isSuccess = httpStatusCode >= 200 && httpStatusCode < 300;
  const isSecurityChallenge = detectSecurityChallenge(responseData);

  if (isSuccess) {
    return {
      httpStatusCode,
      body,
      isSuccess,
      isSecurityChallenge,
      message: "success",
    };
  }

  if (isSecurityChallenge) {
    return {
      httpStatusCode,
      body,
      isSuccess,
      isSecurityChallenge,
      message:
        "Upstream security challenge detected (captcha). The provider is blocking requests from this server origin.",
    };
  }

  if (Array.isArray(body) && body.length > 0) {
    return {
      httpStatusCode,
      body,
      isSuccess,
      isSecurityChallenge,
      message: body[0]?.message || "Request failed",
    };
  }

  if (body?.errors && body.errors.length > 0) {
    return {
      httpStatusCode,
      body,
      isSuccess,
      isSecurityChallenge,
      message: body.errors[0]?.message || "Request failed",
    };
  }

  return {
    httpStatusCode,
    body,
    isSuccess,
    isSecurityChallenge,
    message: "Unknown error",
  };
}

const createSalesforceCase = async (data, token) => {
  logger.info("SalesforceCasesService -> createSalesforceCase() started");

  ensureCasesApiConfig();

  try {
    const user = await getAuthenticatedUser(token);
    const { dataValues } = user;

    const payload = [
      {
        email: data.email,
        fname: data.firstName || data.phone,
        lname: data.lastName || data.phone,
        date_of_birth: "01/00/1900",
        phone: Number(data.phone),
        country: "US",
        ip: "IPv4",
        address: data.phone,
        city: "Unknown",
        state: data.state,
        zip: "12345",
        offer_url: "null",
        date_subscribed: data.dateSubscribed,
        comments: "",
        case_type: data.type,
        Trusted_Form_Alt: "",
        Jornaya: "",
        diagnosis: "Update after call",
        gender: data.gender,
        ownerid: data.ownerId,
        diagnosis_year: "01/01/1900",
        campaign: "",
        env: "prod",
      },
    ];

    let response = await postCases(salesforceCasesConfig.url, payload);

    logger.success("SalesforceCasesService -> createSalesforceCase() success");

    let apiResponse = response.data?.data?.resultCasos?.compositeResponse?.[0];

    let result = resolveSalesforceResult(apiResponse, response.data);

    if (
      result.isSecurityChallenge &&
      salesforceCasesConfig.fallbackUrl &&
      salesforceCasesConfig.fallbackUrl !== salesforceCasesConfig.url
    ) {
      logger.warn(
        "SalesforceCasesService -> security challenge on primary URL, retrying fallback URL",
        {
          primaryUrl: salesforceCasesConfig.url,
          fallbackUrl: salesforceCasesConfig.fallbackUrl,
        },
      );

      response = await postCases(salesforceCasesConfig.fallbackUrl, payload);
      apiResponse = response.data?.data?.resultCasos?.compositeResponse?.[0];
      result = resolveSalesforceResult(apiResponse, response.data);
    }

    if (result.isSuccess) {
      await casesSalesforce.create({
        email: data.email,
        firstname: data.firstName || data.phone,
        lastname: data.lastName || data.phone,
        phoneNumber: data.phone,
        state: data.state,
        type: data.type,
        gender: data.gender,
        supplier: data.ownerId,
        userId: dataValues.id,
      });
    }

    if (!result.isSuccess) {
      logger.warn("SalesforceCasesService -> non-success composite response", {
        httpStatusCode: result.httpStatusCode,
        body: result.body,
        responseData: response.data,
      });
    }

    return {
      statusMessage: result.isSuccess ? 200 : 400,
      message: result.message,
      errorType: result.isSecurityChallenge
        ? "UPSTREAM_SECURITY_CHALLENGE"
        : null,
    };
  } catch (error) {
    const details = buildAxiosErrorDetails(error);

    logger.error("SalesforceCasesService -> createSalesforceCase() error", {
      message: error.message,
      details,
    });

    error.status = error.status || (error.response ? 502 : 500);
    error.details = error.details || details;

    throw error;
  }
};

module.exports = {
  createSalesforceCase,
};
