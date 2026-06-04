const Joi = require("joi");

const tortSchema = Joi.object({
  tort: Joi.string().trim().max(255).required(),
  tier: Joi.string().trim().max(50).required(),
  status: Joi.string().valid("active", "paused", "inactive").default("active"),
});

const vendorTableCreateSchema = Joi.object({
  contactName: Joi.string().trim().max(255).required(),
  name: Joi.string().trim().max(255).required(),
  email: Joi.string().trim().email().required(),
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
}).required();

module.exports = vendorTableCreateSchema;
