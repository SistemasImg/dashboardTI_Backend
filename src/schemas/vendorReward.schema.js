const Joi = require("joi");

const REWARD_KEYS = [
  "additional",
  "preferred_payment_n7",
  "replacement_flexibility",
  "auto_intake",
];

const vendorRewardSchema = Joi.object({
  rewards: Joi.array()
    .items(Joi.string().valid(...REWARD_KEYS))
    .unique(),
  bonusAccess: Joi.boolean(),
  net7: Joi.boolean(),
  replacementFlexibility: Joi.boolean(),
}).or("rewards", "bonusAccess", "net7", "replacementFlexibility");

module.exports = vendorRewardSchema;
