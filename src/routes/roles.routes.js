const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allRoles } = require("../controllers/roles.controller");

// All protected
router.use(authMiddleware);

router.get("/all", allRoles);

module.exports = router;
