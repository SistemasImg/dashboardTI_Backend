const Joi = require("joi");

const createUserSchema = Joi.object({
  fullname: Joi.string().min(3).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  phone: Joi.string()
    .pattern(/^[0-9]{9}$/)
    .required(),
  role_id: Joi.number().integer().valid(1, 2).required(),
  status: Joi.string().valid("active", "inactive", "suspended").required(),
  username: Joi.string().min(3).max(50).required(),
});

module.exports = createUserSchema;
