const express = require("express");
const router = express.Router();
const { login, getCurrentUser } = require("../controllers/loginController");
const validateLogin = require("../middlewares/validateLogin");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createTest,
  getTests,
  updateTest,
  deleteTest,
} = require("../controllers/uatController");

//user
router.post("/login", validateLogin, login);
router.get("/validateUser", authMiddleware, getCurrentUser);

router.use(authMiddleware);
//uat
router.post("/uatCreate", createTest);
router.get("/uatGet", getTests);
router.put("/uatUpdate/:id", updateTest);
router.delete("/uatDelete/:id", deleteTest);
module.exports = router;
