const Joi = require("joi");

const closedCasesMarkWorkedByFilterSchema = Joi.object({
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  type: Joi.string().valid("disqualified", "rejected", "signed").required(),
  typeFilter: Joi.string().trim().allow(null, "", "all").optional(),
  eventType: Joi.string()
    .valid("excel_downloaded", "recording_reviewed")
    .required(),
  performedBy: Joi.string().trim().max(120).allow(null, "").optional(),
});

module.exports = closedCasesMarkWorkedByFilterSchema;
