const Joi = require("joi");

const audienceExportSchema = Joi.object({
  type: Joi.alternatives()
    .try(
      Joi.string().trim().min(1),
      Joi.array().items(Joi.string().trim().min(1)).min(1),
    )
    .required(),
  sms: Joi.boolean().default(true),
  mail: Joi.boolean().default(true),
  pending: Joi.boolean().default(true),
  unresponsive: Joi.boolean().default(true),
})
  .custom((value, helpers) => {
    if (!value.sms && !value.mail) {
      return helpers.error("any.custom", {
        message: "Debe enviar sms o mail en true",
      });
    }

    if (!value.pending && !value.unresponsive) {
      return helpers.error("any.custom", {
        message: "Debe enviar pending o unresponsive en true",
      });
    }

    return value;
  }, "at least one channel and group selected")
  .messages({
    "any.custom": "{{#message}}",
  });

module.exports = audienceExportSchema;
