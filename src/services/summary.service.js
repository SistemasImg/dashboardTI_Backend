const {
  User,
  Agents,
  CaseAssignment,
  AttemptsDaily,
  MessageRecords,
  sendApiRecords,
} = require("../models");

const sqlServerPool = require("./sqlserver/pool.service");
const { authenticateSalesforce } = require("./salesforce/auth.service");

const getSummary = async () => {
  // ========================
  // USERS
  // ========================
  const totalUsers = await User.count();
  const lastUser = await User.findOne({
    order: [["id", "DESC"]],
    attributes: ["id", "fullname", "role_id", "created_at"],
  });

  // ========================
  // AGENTS
  // ========================
  const totalAgents = await Agents.count();
  const lastAgent = await Agents.findOne({
    order: [["id", "DESC"]],
  });

  // ========================
  // CASE ASSIGNMENTS
  // ========================
  const totalCaseAssignments = await CaseAssignment.count();

  // ========================
  // ATTEMPTS DAILY
  // ========================
  const totalAttemptsDaily = await AttemptsDaily.count();

  // ========================
  // INFOBIT MESSAGES
  // ========================
  const totalInfobitMessages = await MessageRecords.count();

  // ========================
  // SALESFORCE OPPORTUNITIES
  // ========================
  const totalSalesforceOpportunities = await sendApiRecords.count();

  // ========================
  // CONNECTION STATUS
  // ========================
  let salesforceStatus = "disconnected";
  let sqlServerStatus = "disconnected";
  try {
    await authenticateSalesforce();
    salesforceStatus = "connected";
  } catch (error) {
    salesforceStatus = "error";
  }

  try {
    const pool = await sqlServerPool.getPool();
    if (pool) sqlServerStatus = "connected";
  } catch (error) {
    sqlServerStatus = "error";
  }

  return {
    users: {
      total: totalUsers,
      last: lastUser,
    },
    agents: {
      total: totalAgents,
      last: lastAgent,
    },
    caseAssignments: {
      total: totalCaseAssignments,
    },
    attemptsDaily: {
      total: totalAttemptsDaily,
    },
    infobitMessages: {
      total: totalInfobitMessages,
    },
    salesforceOpportunities: {
      total: totalSalesforceOpportunities,
    },
    connections: {
      salesforce: salesforceStatus,
      sqlserver: sqlServerStatus,
    },
  };
};

module.exports = {
  getSummary,
};
