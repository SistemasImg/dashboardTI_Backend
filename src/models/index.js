const User = require("./user");
const Role = require("./roles");
const Domain = require("./domain");
const Product = require("./Products");
const LandingUat = require("./LandingUat");
const DidUat = require("./DidUat");

// ============================
// ROLES ↔ USERS
// ============================
User.belongsTo(Role, { foreignKey: "role_id" });
Role.hasMany(User, { foreignKey: "role_id" });

// ============================
// PRODUCTS ↔ LANDING UAT
// ============================
LandingUat.belongsTo(Product, { foreignKey: "idProduct" });
Product.hasMany(LandingUat, { foreignKey: "idProduct" });

// ============================
// PRODUCTS ↔ DID UAT
// ============================
DidUat.belongsTo(Product, { foreignKey: "idProduct" });
Product.hasMany(DidUat, { foreignKey: "idProduct" });

// ============================
// DOMAINS ↔ LANDING UAT
// ============================
LandingUat.belongsTo(Domain, { foreignKey: "idDomain" });
Domain.hasMany(LandingUat, { foreignKey: "idDomain" });

// ============================
// USERS (testerId) ↔ LANDING UAT
// ============================
LandingUat.belongsTo(User, { foreignKey: "testerId", as: "landingTester" });
User.hasMany(LandingUat, { foreignKey: "testerId", as: "landingTests" });

// ============================
// USERS (testerId) ↔ DID UAT
// ============================
DidUat.belongsTo(User, { foreignKey: "testerId", as: "didTester" });
User.hasMany(DidUat, { foreignKey: "testerId", as: "didTests" });

module.exports = {
  User,
  Role,
  Domain,
  Product,
  LandingUat,
  DidUat,
};
