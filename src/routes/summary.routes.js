const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { summary } = require("../controllers/summary.controller");

// All protected
router.use(authMiddleware);

router.get("/", summary);

module.exports = router;
