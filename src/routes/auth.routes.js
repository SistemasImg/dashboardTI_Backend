const express = require("express");
const router = express.Router();

const loginSchema = require("../schemas/loginSchema");
const validate = require("../middlewares/validate");
const { login, getCurrentUser } = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/authMiddleware");

// Public login
router.post("/login", validate(loginSchema), login);

// Protected
router.get("/validateUser", authMiddleware, getCurrentUser);

module.exports = router;
