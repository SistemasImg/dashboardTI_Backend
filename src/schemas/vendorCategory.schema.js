const Joi = require("joi");

const vendorCategorySchema = Joi.object({
  category: Joi.string()
    .valid("new_review", "top_vendors", "under_review")
    .required(),
});

module.exports = vendorCategorySchema;