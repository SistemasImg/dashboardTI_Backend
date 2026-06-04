const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/authMiddleware");

const {
  createCaseInSalesforce,
} = require("../../controllers/salesforce/cases.controller");

router.use(authMiddleware);

router.post("/post", createCaseInSalesforce);

module.exports = router;
