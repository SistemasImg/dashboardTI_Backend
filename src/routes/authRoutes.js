const express = require("express");
const router = express.Router();
const { login, getCurrentUser } = require("../controllers/loginController");
const validateLogin = require("../middlewares/validateLogin");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createTestLanding,
  createTestDid,
  getTestLanding,
  getTestDid,
  updateTestLanding,
  updateTestDid,
} = require("../controllers/uatController");
const {
  allUsers,
  createUser,
  updateUsers,
  deleteUsers,
} = require("../controllers/allUserController");
const { allProducts } = require("../controllers/productController");
const { allDomains } = require("../controllers/domainController");
const { allRoles } = require("../controllers/rolesController");

// PUBLIC ROUTES
router.post("/login", login);

// PROTECTED ROUTES
router.use(authMiddleware);

//user
router.get("/allUsers", allUsers);
router.get("/validateUser", getCurrentUser);
router.post("/createUser", createUser);
router.put("/updateUser/:id", updateUsers);
router.delete("/deleteUser/:id", deleteUsers);

//product
router.get("/allProducts", allProducts);

//Domain
router.get("/allDomains", allDomains);

//uat
router.post("/landingUatCreate", createTestLanding);
router.post("/didUatCreate", createTestDid);
router.get("/landingUatGet", getTestLanding);
router.get("/didUatGet", getTestDid);
router.put("/uatLandingUpdate/:id", updateTestLanding);
router.put("/uatDidUpdate/:id", updateTestDid);

//roles
router.get("/allRoles", allRoles);

module.exports = router;
