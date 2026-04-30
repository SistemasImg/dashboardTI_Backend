const User = require("./user");
const Role = require("./roles");
const Domain = require("./domain");
const Product = require("./products");
const LandingUat = require("./landingUat");
const DidUat = require("./didUat");
const CaseAssignment = require("./caseAssignments");
const AttemptsDaily = require("./attemptsDaily");
const State = require("./state");
const MessageRecords = require("./messageRecords");
const sendApiRecords = require("./sendApiRecords");
const MediaFiles = require("./mediaFile");
const CallCenter = require("./callCenter");
const ChatSession = require("./chatSession.model");

// ============================
// ROLES ↔ USERS
// ============================
User.belongsTo(Role, { foreignKey: "role_id" });
Role.hasMany(User, { foreignKey: "role_id" });

// ============================
// CALL CENTER ↔ USERS
// ============================
User.belongsTo(CallCenter, {
  foreignKey: "call_center_id",
  as: "callCenter",
});

CallCenter.hasMany(User, {
  foreignKey: "call_center_id",
  as: "users",
});

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

// CASE ASSIGNMENTS ↔ USERS (agent)
CaseAssignment.belongsTo(User, { foreignKey: "agent_id", as: "agent" });
User.hasMany(CaseAssignment, { foreignKey: "agent_id", as: "assignedCases" });

// CASE ASSIGNMENTS ↔ USERS (created_by)
CaseAssignment.belongsTo(User, { foreignKey: "created_by", as: "createdBy" });
User.hasMany(CaseAssignment, {
  foreignKey: "created_by",
  as: "createdAssignments",
});

module.exports = {
  User,
  Role,
  Domain,
  Product,
  LandingUat,
  DidUat,
  CaseAssignment,
  AttemptsDaily,
  State,
  MessageRecords,
  sendApiRecords,
  MediaFiles,
  CallCenter,
};
