const logger = require("../../../utils/logger");
const ghlService = require("../../../services/ghl/gravityForms");

const CORE_FIELDS = ["first_name", "last_name", "email", "phone_1"];
const EXPECTED_FIELDS = [
  ...CORE_FIELDS,
  "zip_cod",
  "comentarios",
  "checkbox_sac",
  "url_certificado",
  "casos_1",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "id_lead",
];

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function getPayloadSummary(payload = {}) {
  const safePayload = payload && typeof payload === "object" ? payload : {};

  return {
    fieldCount: Object.keys(safePayload).length,
    expectedFieldsPresent: EXPECTED_FIELDS.filter((field) =>
      hasValue(safePayload[field]),
    ),
    missingCoreFields: CORE_FIELDS.filter(
      (field) => !hasValue(safePayload[field]),
    ),
  };
}

exports.sendToGHL = async (req, res) => {
  const payloadSummary = getPayloadSummary(req.body);

  logger.info("GravityFormsController -> /gravity-to-ghl request received", {
    origin: "controller",
    contentType: req.get("content-type") || "unknown",
    ...payloadSummary,
  });

  try {
    await ghlService.upsertContact(req.body);

    logger.success("GravityFormsController -> /gravity-to-ghl processed", {
      origin: "controller",
      fieldCount: payloadSummary.fieldCount,
    });

    res.status(200).json({
      success: true,
      message: "Contact sent to GHL successfully",
    });
  } catch (error) {
    logger.error("GravityFormsController -> /gravity-to-ghl failed", {
      origin: "controller",
      status: error.response?.status || error.status || 500,
      code: error.code || "unknown",
      message: error.message,
    });

    res.status(500).json({ success: false, error: "Failed to send to GHL" });
  }
};
