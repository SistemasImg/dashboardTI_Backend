const Joi = require("joi");

const financeInvoiceSapSyncSchema = Joi.object({
  force: Joi.boolean().default(false),
}).required();

module.exports = financeInvoiceSapSyncSchema;
