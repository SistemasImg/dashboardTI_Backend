const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allStates } = require("../controllers/state.controller");

// All protected
router.use(authMiddleware);

router.get("/all", allStates);

module.exports = router;
