const Joi = require("joi");
const {
  submitToGravity,
  submitToActiveProspect,
} = require("../services/publicLead.service");
const logger = require("../utils/logger");

const certRegex = /^https?:\/\/cert\.trustedform\.com\//i;

const STATIC_FORM_CONFIGS = {
  rideshare: {
    slug: "rideshare",
    gf_form_id: 169,
    campaign_product: "RIDESHARE-07100",
    campaign_topic: "rideshare",
  },
};

const DEFAULT_FORM_CONFIG = STATIC_FORM_CONFIGS.rideshare;

const leadSchema = Joi.object({
  assaulted: Joi.string().valid("YES", "NO").required(),
  proof: Joi.string().valid("YES", "NO").required(),
  gender: Joi.string().valid("YES", "NO").required(),
  abuse_type: Joi.string().min(2).max(120).required(),
  attorney: Joi.string().valid("YES", "NO").required(),
  platform: Joi.string().min(2).max(40).required(),
  year_range: Joi.string().min(2).max(40).required(),
  state: Joi.string().min(2).max(80).required(),
  first_name: Joi.string().min(2).max(80).required(),
  last_name: Joi.string().min(2).max(80).required(),
  email: Joi.string().email().max(120).required(),
  phone: Joi.string().min(7).max(30).required(),
  description: Joi.string().allow("").max(1500).default(""),
  trustedform_cert_url: Joi.string().uri().required(),
  ap_payload: Joi.object().unknown(true).optional(),
  website: Joi.string().allow("").optional(),
}).unknown(false);

function normalizeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isAllowedOrigin(origin) {
  const configured = (process.env.PUBLIC_FORM_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    return true;
  }

  return configured.includes(origin);
}

function getFormConfigBySlug(formSlug) {
  return STATIC_FORM_CONFIGS[formSlug] || DEFAULT_FORM_CONFIG;
}

function buildGravityPayload(data, requestMeta, formConfig) {
  const campaignProduct = formConfig?.campaign_product || "";
  const campaignTopic = formConfig?.campaign_topic || "";

  return {
    form_id: Number(formConfig?.gf_form_id),
    input_56: "NO",
    input_53: "00000",
    input_41: "No",
    input_54: data.assaulted,
    input_66: data.proof,
    input_61: data.gender,
    input_44: data.abuse_type,
    input_62: data.attorney,
    input_69: data.platform,
    input_70: data.year_range,
    input_71: data.state,
    input_21: data.first_name,
    input_22: data.last_name,
    input_23: data.email,
    input_24: data.phone,
    input_51: data.description,
    input_10: data.trustedform_cert_url,
    trustedform_cert_url: data.trustedform_cert_url,
    source_url: requestMeta.sourceUrl,
    user_agent: requestMeta.userAgent,
    campaign_product: campaignProduct,
    campaign_topic: campaignTopic,
  };
}

function buildActiveProspectPayload(data, requestMeta, formConfig) {
  const fieldData = [
    { name: "first_name", values: [data.first_name] },
    { name: "last_name", values: [data.last_name] },
    { name: "email", values: [data.email] },
    { name: "phone", values: [data.phone] },
    { name: "platform", values: [data.platform] },
    { name: "state", values: [data.state] },
    { name: "year_range", values: [data.year_range] },
    { name: "abuse_type", values: [data.abuse_type] },
    {
      name: "can_you_briefly_describe_what_happened_during_your_rideshare_trip",
      values: [data.description || ""],
    },
  ];

  return {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    assaulted: data.assaulted,
    proof: data.proof,
    gender: data.gender,
    attorney: data.attorney,
    abuse_type: data.abuse_type,
    platform: data.platform,
    year_range: data.year_range,
    state: data.state,
    trustedform_cert_url: data.trustedform_cert_url,
    source_url: requestMeta.sourceUrl,
    source: "rideshare-landing",
    campaign_product: formConfig?.campaign_product || "",
    campaign_topic: formConfig?.campaign_topic || "",
    facebook_field_data_apros: JSON.stringify(fieldData),
    can_you_briefly_describe_what_happened_during_your_rideshare_trip:
      data.description || "",
  };
}

async function submitRideshareLead(req, res) {
  try {
    const origin = req.headers.origin || "";
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const formSlug = normalizeString(req.body.form_slug) || "rideshare";

    logger.info(
      `Public lead received | slug=${formSlug} | origin=${origin || "n/a"} | ip=${ip}`,
    );

    if (origin && !isAllowedOrigin(origin)) {
      logger.warn(
        `Public lead blocked by origin policy | slug=${formSlug} | origin=${origin}`,
      );
      return res.status(403).json({
        success: false,
        message: "Origin not allowed",
      });
    }

    const payload = {
      assaulted: normalizeString(req.body.assaulted),
      proof: normalizeString(req.body.proof),
      gender: normalizeString(req.body.gender),
      abuse_type: normalizeString(req.body.abuse_type),
      attorney: normalizeString(req.body.attorney),
      platform: normalizeString(req.body.platform),
      year_range: normalizeString(req.body.year_range),
      state: normalizeString(req.body.state),
      first_name: normalizeString(req.body.first_name),
      last_name: normalizeString(req.body.last_name),
      email: normalizeString(req.body.email),
      phone: normalizeString(req.body.phone),
      description: normalizeString(req.body.description),
      trustedform_cert_url: normalizeString(req.body.trustedform_cert_url),
      ap_payload: req.body.ap_payload,
      website: normalizeString(req.body.website),
    };

    const { error, value } = leadSchema.validate(payload, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn(
        `Public lead validation failed | slug=${formSlug} | issues=${error.details.length}`,
      );
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
        details: error.details.map((d) => d.message),
      });
    }

    if (value.website) {
      logger.warn(`Public lead honeypot triggered | slug=${formSlug}`);
      return res.status(200).json({ success: true });
    }

    if (!certRegex.test(value.trustedform_cert_url)) {
      logger.warn(`Public lead invalid TrustedForm cert | slug=${formSlug}`);
      return res.status(400).json({
        success: false,
        message: "TrustedForm certificate is invalid",
      });
    }

    const formConfig = getFormConfigBySlug(formSlug);
    const resolvedFormId = Number(formConfig?.gf_form_id);

    logger.info(
      `Public lead validated | slug=${formSlug} | form_id=${resolvedFormId}`,
    );

    const gravityPayload = buildGravityPayload(
      value,
      {
        sourceUrl: normalizeString(req.body.source_url) || "",
        userAgent: req.headers["user-agent"] || "",
      },
      formConfig,
    );

    const gravityResponse = await submitToGravity(gravityPayload);

    logger.success(
      `Public lead sent to Gravity | slug=${formSlug} | form_id=${resolvedFormId} | is_valid=${gravityResponse?.is_valid}`,
    );

    const activeProspectPayload =
      value.ap_payload ||
      buildActiveProspectPayload(
        value,
        {
          sourceUrl: normalizeString(req.body.source_url) || "",
        },
        formConfig,
      );

    logger.info(`Public lead forwarding to ActiveProspect | slug=${formSlug}`);
    await submitToActiveProspect(activeProspectPayload);
    logger.success(`Public lead sent to ActiveProspect | slug=${formSlug}`);

    return res.status(200).json({
      success: true,
      gravity: {
        is_valid: gravityResponse?.is_valid,
        confirmation_message: gravityResponse?.confirmation_message || null,
      },
    });
  } catch (err) {
    logger.error("Public lead flow failed: " + err.message);
    return res.status(500).json({
      success: false,
      message: "Lead forwarding failed",
      error: err.message,
    });
  }
}

module.exports = {
  submitRideshareLead,
};
