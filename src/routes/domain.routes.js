const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allDomains } = require("../controllers/domain.controller");

// All protected
router.use(authMiddleware);

router.get("/all", allDomains);

module.exports = router;
