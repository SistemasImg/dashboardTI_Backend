const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { postApiSend } = require("../controllers/apiSend.controller");

// All protected
router.use(authMiddleware);

router.post("/post", postApiSend);

module.exports = router;
