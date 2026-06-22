const Joi = require("joi");
const {
  DOCUMENT_TYPE_CODES,
  IDENTITY_DOCUMENT_TYPE_CODES,
  CURRENCY_TYPE_CODES,
  PURCHASE_TYPE_CODES,
  GOODS_SERVICES_TYPES,
} = require("../constants/financeInvoice.constants");

const dateSchema = Joi.alternatives().try(
  Joi.date().iso(),
  Joi.string()
    .trim()
    .pattern(/^\d{2}\/\d{2}\/\d{4}$/),
);

const moneySchema = Joi.number().precision(2).min(0).required();

const financeInvoiceCreateSchema = Joi.object({
  documentType: Joi.string()
    .trim()
    .valid(...DOCUMENT_TYPE_CODES)
    .required(),
  documentSeries: Joi.string().trim().max(20).required(),
  documentNumber: Joi.string().trim().max(20).required(),
  purchaseType: Joi.string()
    .trim()
    .uppercase()
    .valid(...PURCHASE_TYPE_CODES)
    .required(),
  goodsServicesType: Joi.string()
    .trim()
    .valid(...GOODS_SERVICES_TYPES)
    .required(),
  identityDocumentType: Joi.string()
    .trim()
    .valid(...IDENTITY_DOCUMENT_TYPE_CODES)
    .required(),
  ruc: Joi.string()
    .trim()
    .pattern(/^\d{11}$/)
    .required(),
  businessName: Joi.string().trim().max(255).required(),
  issueDate: dateSchema.required(),
  dueDate: dateSchema.required(),
  currencyType: Joi.string()
    .trim()
    .valid(...CURRENCY_TYPE_CODES)
    .required(),
  taxableBaseAmount: moneySchema,
  igvAmount: moneySchema,
  totalAmount: moneySchema,
  validateDetraction: Joi.boolean()
    .truthy("SI", "Si", "si", "SÍ", "Sí", "sí", "YES", "yes", "1")
    .falsy("NO", "No", "no", "0")
    .required(),
  detractionPercentage: Joi.when("validateDetraction", {
    is: true,
    then: Joi.number().precision(2).min(0).max(100).required(),
    otherwise: Joi.number().precision(2).min(0).max(100).default(0),
  }),
  detractionCode: Joi.when("validateDetraction", {
    is: true,
    then: Joi.string()
      .trim()
      .pattern(/^\d{3}$/)
      .required(),
    otherwise: Joi.string()
      .trim()
      .pattern(/^\d{3}$/)
      .default("000"),
  }),
  detractionAmount: Joi.when("validateDetraction", {
    is: true,
    then: moneySchema,
    otherwise: Joi.number().precision(2).min(0).default(0),
  }),
}).required();

module.exports = financeInvoiceCreateSchema;
