const express = require("express");
const router = express.Router();
const { handleGhlWebhook } = require("../../controllers/ghl/salesforce");

router.post(
  "/",
  (req, res, next) => {
    next();
  },
  handleGhlWebhook,
);

module.exports = router;
