const axios = require("axios");
const logger = require("../utils/logger");

function buildGravityAuthHeader() {
  const key = process.env.GF_CONSUMER_KEY;
  const secret = process.env.GF_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("GF credentials are not configured");
  }

  const rawCredentials = key + ":" + secret;
  return "Basic " + Buffer.from(rawCredentials).toString("base64");
}

function buildGravityUrl(formIdOverride) {
  const baseUrl = process.env.GF_API_BASE_URL;
  const formId = formIdOverride;

  if (!baseUrl || !formId) {
    throw new Error("GF endpoint config is missing");
  }

  return `${baseUrl.replace(/\/$/, "")}/wp-json/gf/v2/forms/${formId}/submissions`;
}

async function submitToGravity(payload) {
  const url = buildGravityUrl(payload.form_id);
  const authHeader = buildGravityAuthHeader();

  logger.info(
    `Calling Gravity submission endpoint | form_id=${payload.form_id}`,
  );

  const response = await axios.post(url, payload, {
    timeout: 12000,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
  });

  logger.success(
    `Gravity submission completed | status=${response.status} | form_id=${payload.form_id}`,
  );

  return response.data;
}

async function submitToActiveProspect(payload) {
  const url = process.env.ACTIVE_PROSPECT_URL;
  if (!url) {
    throw new Error("ACTIVE_PROSPECT_URL is missing");
  }

  logger.info("Calling ActiveProspect endpoint");

  const response = await axios.post(url, payload, {
    timeout: 12000,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "dashboard-backend",
    },
  });

  logger.success(`ActiveProspect call completed | status=${response.status}`);

  return response.data;
}

module.exports = {
  submitToGravity,
  submitToActiveProspect,
};
