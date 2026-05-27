const Joi = require("joi");

const vendorRewardSchema = Joi.object({
  bonusAccess: Joi.boolean().required(),
  net7: Joi.boolean().required(),
  replacementFlexibility: Joi.boolean().required(),
});

module.exports = vendorRewardSchema;
