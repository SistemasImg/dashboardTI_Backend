const Joi = require("joi");

const createUserSchema = Joi.object({
  fullname: Joi.string().min(3).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  role_id: Joi.number().integer().required(),
  call_center_id: Joi.number().integer().required(),
  status: Joi.string().valid("active", "inactive", "suspended").required(),
});

module.exports = createUserSchema;
