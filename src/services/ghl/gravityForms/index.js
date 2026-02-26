const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function upsertContact(data) {
  const body = {
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone_1,
    locationId: process.env.GHL_LOCATION_ID,
    source: data.utm_source || "Gravity Forms",

    customFields: [
      { key: "zip_cod", value: data.zip_cod },
      { key: "comentarios", value: data.comentarios },
      { key: "checkbox_sac", value: data.checkbox_sac },
      { key: "trustedform_cert_url", value: data.url_certificado },
      { key: "casos_1", value: data.casos_1 },
      // { key: "select_quest01", value: data.select_quest01 },
      // { key: "select_quest02", value: data.select_quest02 },
      // { key: "sexually_assoulted", value: data.sexually_assoulted },
      // { key: "attorney_helping", value: data.attorney_helping },
      { key: "utm_medium", value: data.utm_medium },
      { key: "utm_campaign", value: data.utm_campaign },
      { key: "id_lead", value: data.id_lead },
    ],
  };

  const response = await axios.post(
    "https://services.leadconnectorhq.com/contacts/upsert",
    body,
    {
      httpsAgent,
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
    },
  );

  return response.data;
}

module.exports = {
  upsertContact,
};
