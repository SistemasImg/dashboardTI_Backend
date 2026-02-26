const express = require("express");
const router = express.Router();
const { sendToGHL } = require("../../controllers/ghl/gravityForms");

router.post("/", sendToGHL);

module.exports = router;
