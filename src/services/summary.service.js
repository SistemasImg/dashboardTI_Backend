const { Op, fn, col, where } = require("sequelize");

const {
  User,
  Role,
  CaseAssignment,
  AttemptsDaily,
  MessageRecords,
  sendApiRecords,
} = require("../models");

const sqlServerPool = require("./sqlserver/pool.service");
const { authenticateSalesforce } = require("./salesforce/auth.service");
const { sendServiceAlertEmail } = require("./email.service");

const getSummary = async () => {
  // ========================
  // USERS
  // ========================
  const totalUsers = await User.count();
  const lastUser = await User.findOne({
    where: {
      email: {
        [Op.notLike]: "%@abc.com",
        [Op.and]: [
          { [Op.notLike]: "%@callzent.com" },
          { [Op.notLike]: "%@vendamolo.com" },
        ],
      },
    },
    include: [
      {
        model: Role,
        attributes: ["name"],
      },
    ],
    order: [["created_at", "DESC"]],
    attributes: ["id", "fullname", "created_at"],
  });

  // ========================
  // AGENTS
  // ========================
  const totalAgents = await User.count({
    where: {
      role_id: {
        [Op.in]: [4, 5],
      },
    },
  });
  const lastAgent = await User.findOne({
    where: {
      role_id: {
        [Op.in]: [4, 5],
      },
    },
    order: [["id", "DESC"]],
  });

  // ========================
  // CASE ASSIGNMENTS
  // ========================
  const lastAssignmentDateResult = await CaseAssignment.findOne({
    attributes: [[fn("MAX", fn("DATE", col("created_at"))), "lastDate"]],
    raw: true,
  });

  const lastAssignmentDate = lastAssignmentDateResult?.lastDate;

  let totalCaseAssignments = 0;

  if (lastAssignmentDate) {
    totalCaseAssignments = await CaseAssignment.count({
      distinct: true,
      col: "case_number",
      where: where(fn("DATE", col("created_at")), lastAssignmentDate),
    });
  }

  // ========================
  // ATTEMPTS DAILY
  // ========================
  const lastDateResult = await AttemptsDaily.findOne({
    attributes: [[fn("MAX", col("call_date")), "lastDate"]],
    raw: true,
  });

  const lastDate = lastDateResult?.lastDate;

  let attemptsDailyProm = 0;

  if (lastDate) {
    const attemptsOfLastDate = await AttemptsDaily.findAll({
      where: { call_date: lastDate },
      attributes: ["attempts"],
      raw: true,
    });

    const total = attemptsOfLastDate.reduce(
      (sum, row) => sum + Number(row.attempts || 0),
      0,
    );
    attemptsDailyProm =
      attemptsOfLastDate.length > 0
        ? Math.round(total / attemptsOfLastDate.length)
        : 0;
  }

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

  await sendServiceAlertEmail({
    salesforce: salesforceStatus,
    sqlserver: sqlServerStatus,
  });

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
      total: attemptsDailyProm,
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
