const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  getOwners,
  getOwnerSupplierAccounts,
} = require("../controllers/salesforce/owner.controller");

// All protected
router.use(authMiddleware);

router.get("/all", getOwners);
router.get("/suppliers", getOwnerSupplierAccounts);

module.exports = router;
