const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { getOwners } = require("../controllers/salesforce/owner.controller");

// All protected
router.use(authMiddleware);

router.get("/all", getOwners);

module.exports = router;
