const express = require("express");
const router = express.Router();

const validateLogin = require("../middlewares/validateLogin");
const { login, getCurrentUser } = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/authMiddleware");

// Public login
router.post("/login", validateLogin, login);

// Protected
router.get("/validateUser", authMiddleware, getCurrentUser);

module.exports = router;
