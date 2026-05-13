const Joi = require("joi");

const closedCaseCommentSchema = Joi.object({
  caseNumber: Joi.string().trim().max(50).required(),
  comment: Joi.string().trim().max(5000).required(),
});

module.exports = closedCaseCommentSchema;
