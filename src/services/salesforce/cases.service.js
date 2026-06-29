const logger = require("../../utils/logger");
const { verifyAccessToken } = require("../../utils/verifyAccessToken");
const { casesSalesforce, User } = require("../../models");
const { authenticateSalesforce } = require("./auth.service");
const { createSalesforceSObject } = require("./client.service");

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
    status: error?.status || error?.response?.status,
    statusText: error?.response?.statusText,
    responseData: error?.salesforceErrors || error?.response?.data,
    request: {
      method: error?.config?.method,
      url: error?.config?.url,
      timeout: error?.config?.timeout,
      headers: sanitizeHeaders(error?.config?.headers),
    },
  };
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

function cleanDateInput(dateInput) {
  const time = Date.parse(dateInput);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

function normalizeStateValue(stateInput) {
  const normalizedState = String(stateInput || "").trim();

  if (!normalizedState || normalizedState.toLowerCase() === "no state") {
    return "Null";
  }

  return normalizedState;
}

function buildSalesforceCasePayload(data) {
  const phone = String(data.phone || "");
  const state = normalizeStateValue(data.state);
  const dateSubscribed = cleanDateInput(data.dateSubscribed);
  const dateOfBirth = cleanDateInput("1900-01-01") || "1900-01-01";
  const diagnosisYear = cleanDateInput("1900-01-01") || "1900-01-01";

  return {
    Status: "new",
    Origin: "Coreg",
    Priority: "High",
    Trusted_Form__c: "",
    Jornaya__c: "",
    ...(dateSubscribed ? { Date_Subscribed__c: dateSubscribed } : {}),
    Phone_Numbercontact__c: Number(data.phone),
    Email__c: data.email,
    FirstName__c: data.firstName || phone,
    Last_Name__c: data.lastName || phone,
    Date_of_Birth__c: dateOfBirth,
    Address_Street__c: phone,
    City__c: "Unknown",
    StateUS__c: state,
    Area_Code__c: "12345",
    Country__c: "US",
    Offer_URL__c: "null",
    Diagnosis__c: "Update after call",
    Gender__c: data.gender,
    Type: data.type,
    OwnerId: data.ownerId,
    DiagnosisYear__c: diagnosisYear,
  };
}

const createSalesforceCase = async (data, token) => {
  logger.info("SalesforceCasesService -> createSalesforceCase() started");

  try {
    const user = await getAuthenticatedUser(token);
    const { dataValues } = user;

    const sf = await authenticateSalesforce();
    const payload = buildSalesforceCasePayload(data);
    const salesforceResult = await createSalesforceSObject(sf, "Case", payload);

    logger.success("SalesforceCasesService -> createSalesforceCase() success");

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

    return {
      statusMessage: 200,
      message: "success",
      salesforceCaseId: salesforceResult?.id,
      salesforceResult,
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
