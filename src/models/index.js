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
const ImginaSmsSession = require("./imginaSmsSession");
const casesSalesforce = require("./casesSalesforce");
const MediaFiles = require("./mediaFile");
const CallCenter = require("./callCenter");
const ChatSession = require("./chatSession.model");
const CaseComment = require("./caseComment");
const ClosedCaseWorkStatus = require("./closedCaseWorkStatus");
const TranscriptionJob = require("./transcriptionJob");
const TranscriptionSegment = require("./transcriptionSegment");
const VendorProfile = require("./vendorProfile");
const Vendor = require("./vendors");
const VendorCountry = require("./vendorsCountry");
const VendorTortAssignment = require("./vendorTortAssignment");
const VendorCaseSnapshot = require("./vendorCaseSnapshot");
const VendorWeeklyGoal = require("./vendorWeeklyGoal");
const VendorCategoryLog = require("./vendorCategoryLog");
const VendorTopReward = require("./vendorTopReward");
const FinanceInvoice = require("./financeInvoice");
const TimeToLeadSnapshot = require("./timeToLeadSnapshot");
const TimeToLeadSyncRun = require("./timeToLeadSyncRun");

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

// ============================
// TRANSCRIPTION JOBS ↔ SEGMENTS
// ============================
TranscriptionSegment.belongsTo(TranscriptionJob, {
  foreignKey: "job_id",
  as: "job",
});

TranscriptionJob.hasMany(TranscriptionSegment, {
  foreignKey: "job_id",
  as: "segments",
});

VendorTortAssignment.belongsTo(VendorProfile, {
  foreignKey: "vendor_id",
  as: "vendor",
});

VendorProfile.hasMany(VendorTortAssignment, {
  foreignKey: "vendor_id",
  as: "tortAssignments",
});

VendorTortAssignment.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

Product.hasMany(VendorTortAssignment, {
  foreignKey: "product_id",
  as: "vendorAssignments",
});

VendorTortAssignment.belongsTo(User, {
  foreignKey: "assigned_by",
  as: "assignedBy",
});

User.hasMany(VendorTortAssignment, {
  foreignKey: "assigned_by",
  as: "vendorTortAssignmentsCreated",
});

VendorCaseSnapshot.belongsTo(VendorProfile, {
  foreignKey: "vendor_id",
  as: "vendor",
  constraints: false,
});

VendorProfile.hasMany(VendorCaseSnapshot, {
  foreignKey: "vendor_id",
  as: "caseSnapshots",
  constraints: false,
});

VendorCaseSnapshot.belongsTo(Product, {
  foreignKey: "product_id",
  as: "caseProduct",
  constraints: false,
});

Product.hasMany(VendorCaseSnapshot, {
  foreignKey: "product_id",
  as: "vendorCaseSnapshots",
  constraints: false,
});

// ============================
// VENDOR WEEKLY GOALS
// ============================
VendorWeeklyGoal.belongsTo(VendorProfile, {
  foreignKey: "vendor_id",
  as: "vendor",
  constraints: false,
});

VendorProfile.hasMany(VendorWeeklyGoal, {
  foreignKey: "vendor_id",
  as: "weeklyGoals",
  constraints: false,
});

VendorWeeklyGoal.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
  constraints: false,
});

// ============================
// VENDOR CATEGORY LOGS
// ============================
VendorCategoryLog.belongsTo(VendorProfile, {
  foreignKey: "vendor_id",
  as: "vendor",
  constraints: false,
});

VendorProfile.hasMany(VendorCategoryLog, {
  foreignKey: "vendor_id",
  as: "categoryLogs",
  constraints: false,
});

// ============================
// VENDOR TOP REWARDS
// ============================
VendorTopReward.belongsTo(VendorProfile, {
  foreignKey: "vendor_id",
  as: "vendor",
  constraints: false,
});

VendorProfile.hasOne(VendorTopReward, {
  foreignKey: "vendor_id",
  as: "topReward",
  constraints: false,
});

Vendor.belongsTo(VendorCountry, {
  foreignKey: "country_id",
  as: "countryInfo",
  constraints: false,
});

VendorCountry.hasMany(Vendor, {
  foreignKey: "country_id",
  as: "vendors",
  constraints: false,
});

VendorProfile.belongsTo(Vendor, {
  foreignKey: "salesforce_user_id",
  targetKey: "salesforce_id",
  as: "vendorInfo",
  constraints: false,
});

Vendor.hasOne(VendorProfile, {
  foreignKey: "salesforce_user_id",
  sourceKey: "salesforce_id",
  as: "classificationProfile",
  constraints: false,
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
  ImginaSmsSession,
  casesSalesforce,
  MediaFiles,
  CallCenter,
  CaseComment,
  ClosedCaseWorkStatus,
  TranscriptionJob,
  TranscriptionSegment,
  VendorProfile,
  Vendor,
  VendorCountry,
  VendorTortAssignment,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
  FinanceInvoice,
  TimeToLeadSnapshot,
  TimeToLeadSyncRun,
};
