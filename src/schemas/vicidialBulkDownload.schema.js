const Joi = require("joi");

const recordingItemSchema = Joi.object({
  url: Joi.string().uri().required(),
  fileName: Joi.string().trim().max(255).required(),
  durationSeconds: Joi.number().integer().min(0).optional(),
});

const vicidialBulkDownloadSchema = Joi.object({
  recordings: Joi.array().items(recordingItemSchema).min(1).required(),
  minDurationSeconds: Joi.number().integer().min(0).default(120),
  zipName: Joi.string().trim().max(120).optional(),
});

module.exports = vicidialBulkDownloadSchema;
