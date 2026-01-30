const express = require("express");
const router = express.Router();
const createUserSchema = require("../schemas/userSchema");
const validate = require("../middlewares/validate");
const authMiddleware = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");
const ROLES = require("../constants/roles");

const {
  allUsers,
  createUser,
  updateUsers,
  deleteUsers,
} = require("../controllers/users.controller");

// All routes protected
router.use(authMiddleware);

router.get("/all", allUsers);
router.post(
  "/create",
  requireRole(ROLES.SUPERADMIN),
  validate(createUserSchema),
  createUser
);
router.put("/update/:id", updateUsers);
router.delete("/delete/:id", deleteUsers);

module.exports = router;
