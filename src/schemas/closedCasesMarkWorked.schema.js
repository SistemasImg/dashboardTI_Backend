const Joi = require("joi");

const closedCasesMarkWorkedSchema = Joi.object({
  caseNumbers: Joi.array().items(Joi.string().trim().max(50)).min(1).required(),
  eventType: Joi.string()
    .valid("excel_downloaded", "recording_reviewed")
    .required(),
  performedBy: Joi.string().trim().max(120).allow(null, "").optional(),
});

module.exports = closedCasesMarkWorkedSchema;
