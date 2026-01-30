const logger = require("../utils/logger");
const apiSendConfig = require("../config/apiSend.config");
const axios = require("axios");
const https = require("https");
const jwt = require("jsonwebtoken");
const { sendApiRecords, User } = require("../models");

// HTTPS agent
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// helpers
function getBasicAuthHeader() {
  const token = Buffer.from(
    `${apiSendConfig.username}:${apiSendConfig.password}`,
  ).toString("base64");

  return `Basic ${token}`;
}

exports.apiSendPost = async (data, token) => {
  logger.info("ApiSendService → apiSendPost() started");
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

    const response = await axios.post(apiSendConfig.url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: getBasicAuthHeader(),
      },
      httpsAgent,
      timeout: 15000,
    });

    logger.success("ApiSendService → apiSendPost() SUCCESS");

    const apiResponse =
      response.data?.data?.resultCasos?.compositeResponse?.[0];

    const httpStatusCode = apiResponse?.httpStatusCode ?? 500;
    const body = apiResponse?.body;

    let message = "Unknown error";
    if (httpStatusCode >= 200 && httpStatusCode < 300) {
      message = "success";
      await sendApiRecords.create({
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
    logger.error("ApiSendService → apiSendPost() ERROR", {
      message: error.response?.data || error.message,
    });

    throw error;
  }
};
