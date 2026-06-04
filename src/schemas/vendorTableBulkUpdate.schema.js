const Joi = require("joi");

const tortSchema = Joi.object({
  tort: Joi.string().trim().max(255).required(),
  tier: Joi.string().trim().max(50).required(),
  status: Joi.string().valid("active", "paused", "inactive").default("active"),
});

const vendorTableBulkUpdateSchema = Joi.object({
  vendorIds: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required(),
  countryId: Joi.number().integer().positive().allow(null).optional(),
  country: Joi.string().trim().max(100).allow(null, "").optional(),
  communicationChannel: Joi.alternatives()
    .try(
      Joi.string().trim().max(255),
      Joi.array().items(Joi.string().trim().max(255)).max(2),
    )
    .allow(null, "")
    .optional(),
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

module.exports = vendorTableBulkUpdateSchema;
