const Joi = require("joi");

const vendorTortAssignmentSchema = Joi.object({
  productId: Joi.number().integer().positive().required(),
  status: Joi.string().valid("active", "inactive", "paused").default("active"),
  notes: Joi.string().trim().max(255).allow(null, "").optional(),
});

module.exports = vendorTortAssignmentSchema;
