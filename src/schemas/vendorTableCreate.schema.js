const Joi = require("joi");

const tortSchema = Joi.object({
  tort: Joi.string().trim().max(255).required(),
  tier: Joi.string().trim().max(50).required(),
  status: Joi.string().valid("active", "paused", "inactive").default("active"),
});

const vendorTableCreateSchema = Joi.object({
  contactName: Joi.string().trim().max(255).allow(null, "").optional(),
  name: Joi.string().trim().max(255).required(),
  accountName: Joi.string().trim().max(255).optional(),
  email: Joi.string().trim().email().required(),
  salutation: Joi.string()
    .valid("Mr.", "Ms.", "Mrs.", "Dr.", "Prof.")
    .allow(null, "")
    .optional(),
  firstName: Joi.string().trim().max(40).allow(null, "").optional(),
  middleName: Joi.string().trim().max(40).allow(null, "").optional(),
  lastName: Joi.string().trim().max(80).allow(null, "").optional(),
  suffix: Joi.string().trim().max(40).allow(null, "").optional(),
  countryId: Joi.number().integer().positive().allow(null).optional(),
  country: Joi.string().trim().max(100).allow(null, "").optional(),
  communicationChannel: Joi.alternatives()
    .try(
      Joi.string().trim().max(255),
      Joi.array().items(Joi.string().trim().max(255)).max(2),
    )
    .allow(null, "")
    .optional(),
  status: Joi.string().valid("active", "inactive").default("active"),
  torts: Joi.alternatives()
    .try(tortSchema, Joi.array().items(tortSchema))
    .optional(),
  postingMethods: Joi.alternatives()
    .try(
      Joi.string().trim().max(120),
      Joi.array().items(Joi.string().trim().max(120)),
    )
    .optional(),
  postingMethod: Joi.string().trim().max(120).allow(null, "").optional(),
  flowSource: Joi.string()
    .trim()
    .valid("Host & Post", "Buffer Calls", "Campaign_p", "supplier", "Transfer")
    .allow(null, "")
    .optional(),
})
  .custom((value, helpers) => {
    const hasContactName = Boolean(String(value.contactName || "").trim());
    const hasLastName = Boolean(String(value.lastName || "").trim());

    if (!hasContactName && !hasLastName) {
      return helpers.error("any.custom", {
        message: "contactName or lastName is required",
      });
    }

    return value;
  })
  .messages({
    "any.custom": "{{#message}}",
  })
  .required();

module.exports = vendorTableCreateSchema;
