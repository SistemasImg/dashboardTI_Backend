const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { allProducts } = require("../controllers/product.controller");

// All protected
router.use(authMiddleware);

router.get("/all", allProducts);

module.exports = router;
