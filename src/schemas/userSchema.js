const Joi = require("joi");

const userSchema = Joi.object({
  fullname: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  //role: Joi.string().valid("admin", "user").required(),
});

module.exports = userSchema;
