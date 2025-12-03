const Joi = require("joi");

const checklistItemSchema = Joi.object({
  useCase: Joi.string().max(255).required(),
  criteria: Joi.string().max(255).required(),
  checked: Joi.boolean().allow(null),
  status: Joi.boolean().allow(null),
});

const landingUatSchema = Joi.object({
  testType: Joi.string().valid("provider", "client").required(),
  testerId: Joi.string().required(),
  user: Joi.string().max(255).required(),
  idProduct: Joi.number().integer().required(),
  uatType: Joi.string().valid("landing", "other").required(),
  status: Joi.string().valid("pending", "failed", "passed").required(),
  observations: Joi.string().max(500).optional(),
  checklist: Joi.array().items(checklistItemSchema).optional(),
  urlLanding: Joi.string().uri().required(),
  nameRegister: Joi.string().max(255).required(),
  idDomain: Joi.number().integer().required(),
});

module.exports = landingUatSchema;
