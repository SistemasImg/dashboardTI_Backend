const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const {
  allUsers,
  createUser,
  updateUsers,
  deleteUsers,
} = require("../controllers/users.controller");

// All routes protected
router.use(authMiddleware);

router.get("/all", allUsers);
router.post("/create", createUser);
router.put("/update/:id", updateUsers);
router.delete("/delete/:id", deleteUsers);

module.exports = router;
