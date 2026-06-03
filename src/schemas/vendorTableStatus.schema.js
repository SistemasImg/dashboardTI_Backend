const Joi = require("joi");

const vendorTableStatusSchema = Joi.object({
  status: Joi.string().valid("active", "inactive").required(),
}).required();

module.exports = vendorTableStatusSchema;
