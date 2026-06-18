const axios = require("axios");
const https = require("node:https");
const logger = require("../../../utils/logger");

const GHL_CONTACT_UPSERT_URL =
  "https://services.leadconnectorhq.com/contacts/upsert";

const CORE_FIELD_MAP = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  phone: "phone_1",
};

const CUSTOM_FIELD_MAP = [
  { key: "zip_cod", source: "zip_cod" },
  { key: "comentarios", source: "comentarios" },
  { key: "checkbox_sac", source: "checkbox_sac" },
  { key: "trustedform_cert_url", source: "url_certificado" },
  { key: "casos_1", source: "casos_1" },
  { key: "utm_medium", source: "utm_medium" },
  { key: "utm_campaign", source: "utm_campaign" },
  { key: "id_lead", source: "id_lead" },
];

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function getObjectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

function getInputSummary(data = {}) {
  const safeData = data && typeof data === "object" ? data : {};

  return {
    origin: "service",
    coreFieldsPresent: Object.fromEntries(
      Object.entries(CORE_FIELD_MAP).map(([target, source]) => [
        target,
        hasValue(safeData[source]),
      ]),
    ),
    customFieldsWithValues: CUSTOM_FIELD_MAP.filter(({ source }) =>
      hasValue(safeData[source]),
    ).map(({ key }) => key),
    sourceProvided: hasValue(safeData.utm_source),
    locationConfigured: hasValue(process.env.GHL_LOCATION_ID),
    accessTokenConfigured: hasValue(process.env.GHL_ACCESS_TOKEN),
  };
}

function getAxiosErrorSummary(error) {
  return {
    origin: "service",
    status: error.response?.status || null,
    code: error.code || "unknown",
    message: error.message,
    hasResponseBody: Boolean(error.response?.data),
    responseKeys: getObjectKeys(error.response?.data),
  };
}

function buildContactBody(data) {
  return {
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone_1,
    locationId: process.env.GHL_LOCATION_ID,
    source: data.utm_source || "Gravity Forms",

    customFields: CUSTOM_FIELD_MAP.map(({ key, source }) => ({
      key,
      value: data[source],
    })),
  };
}

async function upsertContact(data) {
  const safeData = data && typeof data === "object" ? data : {};

  logger.info("GravityFormsService -> preparing GHL contact upsert", {
    ...getInputSummary(safeData),
    customFieldCount: CUSTOM_FIELD_MAP.length,
  });

  if (!process.env.GHL_LOCATION_ID || !process.env.GHL_ACCESS_TOKEN) {
    logger.warn("GravityFormsService -> GHL configuration is incomplete", {
      origin: "service",
      locationConfigured: hasValue(process.env.GHL_LOCATION_ID),
      accessTokenConfigured: hasValue(process.env.GHL_ACCESS_TOKEN),
    });
  }

  const body = buildContactBody(safeData);

  logger.info("GravityFormsService -> mapped payload for GHL", {
    origin: "service",
    mappedCoreFields: Object.keys(CORE_FIELD_MAP),
    customFieldCount: body.customFields.length,
    customFieldsWithValues: body.customFields
      .filter(({ value }) => hasValue(value))
      .map(({ key }) => key),
  });

  try {
    const response = await axios.post(GHL_CONTACT_UPSERT_URL, body, {
      httpsAgent,
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
    });

    logger.success("GravityFormsService -> GHL contact upsert completed", {
      origin: "service",
      status: response.status,
      hasResponseBody: Boolean(response.data),
      responseKeys: getObjectKeys(response.data),
    });

    return response.data;
  } catch (error) {
    logger.error(
      "GravityFormsService -> GHL contact upsert failed",
      getAxiosErrorSummary(error),
    );

    throw error;
  }
}

module.exports = {
  upsertContact,
};
