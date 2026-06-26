const Joi = require("joi");

const vendorCategorySchema = Joi.object({
  category: Joi.string()
    .valid("new_vendor", "top_vendors", "under_review", "critical_vendor")
    .required(),
});

module.exports = vendorCategorySchema;
