const Joi = require("joi");

const checklistItemSchema = Joi.object({
  useCase: Joi.string().max(255).required(),
  criteria: Joi.string().max(255).required(),
  checked: Joi.boolean().allow(null),
  status: Joi.boolean().allow(null),
});

const didUatSchema = Joi.object({
  testType: Joi.string().valid("provider", "client").required(),
  testerId: Joi.string().required(),
  user: Joi.string().max(255).required(),
  idProduct: Joi.number().integer().required(),
  uatType: Joi.string().valid("did_select", "other").required(),
  status: Joi.string().valid("pending", "failed", "passed").required(),
  observations: Joi.string().max(500).optional(),
  checklist: Joi.array().items(checklistItemSchema).optional(),
  contact: Joi.string().max(255).required(),
  did: Joi.string()
    .length(11)
    .pattern(/^[0-9]+$/)
    .required(),
  didDate: Joi.date().iso().required(),
  mode: Joi.string().valid("transfer", "buffer").required(),
  cpaCpl: Joi.string().valid("transfer", "buffer").required(),
  nameRegister: Joi.string().max(255).required(),
  externalCall: Joi.string().max(255).optional(),
  schedule: Joi.string().max(255).optional(),
  filterPhone: Joi.string().valid("Yes", "No").required(),
});

module.exports = didUatSchema;
