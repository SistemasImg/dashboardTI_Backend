const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allCallCenters } = require("../controllers/callCenter.controller");

// All protected
router.use(authMiddleware);

router.get("/", allCallCenters);

module.exports = router;
