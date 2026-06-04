const logger = require("../../utils/logger");
const salesforceCasesConfig = require("../../config/salesforceCases.config");
const axios = require("axios");
const https = require("node:https");
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

function getBasicAuthHeader() {
  const token = Buffer.from(
    `${salesforceCasesConfig.username}:${salesforceCasesConfig.password}`,
  ).toString("base64");

  return `Basic ${token}`;
}

const createSalesforceCase = async (data, token) => {
  logger.info("SalesforceCasesService -> createSalesforceCase() started");

  if (
    !salesforceCasesConfig.url ||
    !salesforceCasesConfig.username ||
    !salesforceCasesConfig.password
  ) {
    const error = new Error(
      "Salesforce cases API is not configured. Check SALESFORCE_CASES_API_USER / SALESFORCE_CASES_API_PASSWORD (or legacy API_USER / API_PASSWORD).",
    );
    error.status = 500;
    error.details = {
      hasUrl: Boolean(salesforceCasesConfig.url),
      hasUsername: Boolean(salesforceCasesConfig.username),
      hasPassword: Boolean(salesforceCasesConfig.password),
    };
    throw error;
  }

  const decoded = verifyAccessToken(token);
  const userId = decoded.id;
  const { dataValues } = await User.findByPk(userId);

  try {
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

    const response = await axios.post(salesforceCasesConfig.url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: getBasicAuthHeader(),
      },
      httpsAgent,
      timeout: 15000,
    });

    logger.success("SalesforceCasesService -> createSalesforceCase() success");

    const apiResponse =
      response.data?.data?.resultCasos?.compositeResponse?.[0];

    const httpStatusCode = apiResponse?.httpStatusCode ?? 500;
    const body = apiResponse?.body;

    let message = "Unknown error";
    if (httpStatusCode >= 200 && httpStatusCode < 300) {
      message = "success";
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
    } else if (Array.isArray(body) && body.length > 0) {
      message = body[0]?.message || "Request failed";
    } else if (body?.errors && body.errors.length > 0) {
      message = body.errors[0]?.message || "Request failed";
    }

    return {
      statusMessage: httpStatusCode >= 200 && httpStatusCode < 300 ? 200 : 400,
      message,
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
