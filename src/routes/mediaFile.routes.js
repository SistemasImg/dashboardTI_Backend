const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  allMediaFilesController,
  mediaFileByIdController,
} = require("../controllers/mediaFile.controller");

// All protected
router.use(authMiddleware);

// Get all
router.get("/all", allMediaFilesController);

// Get by id
router.get("/:id", mediaFileByIdController);

module.exports = router;
