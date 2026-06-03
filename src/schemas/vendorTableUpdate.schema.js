const Joi = require("joi");

const tortSchema = Joi.object({
  tort: Joi.string().trim().max(255).required(),
  tier: Joi.string().trim().max(50).required(),
  status: Joi.string().valid("active", "paused", "inactive").default("active"),
});

const vendorTableUpdateSchema = Joi.object({
  countryId: Joi.number().integer().positive().allow(null).optional(),
  country: Joi.string().trim().max(100).allow(null, "").optional(),
  communicationChannel: Joi.string().trim().max(255).allow(null, "").optional(),
  torts: Joi.alternatives()
    .try(tortSchema, Joi.array().items(tortSchema))
    .optional(),
  postingMethods: Joi.alternatives()
    .try(
      Joi.string().trim().max(120),
      Joi.array().items(Joi.string().trim().max(120)),
    )
    .optional(),
})
  .or("countryId", "country", "communicationChannel", "torts", "postingMethods")
  .required();

module.exports = vendorTableUpdateSchema;
