const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  sendInfobitMessage,
  logMessageRecords,
} = require("../controllers/infobit.controller");

// All protected
router.use(authMiddleware);

router.post("/send", sendInfobitMessage);
router.get("/log", logMessageRecords);

module.exports = router;
