const { Op } = require("sequelize");
const { CaseAssignment, User, CallCenter } = require("../models");
const logger = require("../utils/logger");
const { DateTime } = require("luxon");
const { getPeruDayRange } = require("../utils/dateToday");

/**
 * Get all active case assignments
 */
async function ActiveAssignmentsDaily() {
  const { start: todayStart, end: tomorrowStart } = getPeruDayRange();
  logger.info("Fetching active case assignments (today only)");

  return CaseAssignment.findAll({
    where: {
      unassigned_at: null,
      assigned_at: {
        [Op.gte]: todayStart,
        [Op.lt]: tomorrowStart,
      },
    },
    include: [
      {
        model: User,
        as: "agent",
        attributes: ["id", "fullname"],
        include: [
          {
            model: CallCenter,
            as: "callCenter",
            attributes: ["id", "name"],
          },
        ],
      },
    ],
  });
}

async function ActiveAssignmentsAll(filters = {}) {
  logger.info("Fetching case assignments with filters");

  const { date_from, date_to, agent_id, created_by, call_center_id } = filters;

  const where = {};

  if (date_from || date_to) {
    where.assigned_at = {};

    if (date_from) {
      where.assigned_at[Op.gte] = DateTime.fromISO(date_from)
        .startOf("day")
        .toJSDate();
    }

    if (date_to) {
      where.assigned_at[Op.lte] = DateTime.fromISO(date_to)
        .endOf("day")
        .toJSDate();
    }
  }

  if (agent_id) {
    where.agent_id = {
      [Op.in]: Array.isArray(agent_id) ? agent_id : [agent_id],
    };
  }

  if (created_by) {
    where.created_by = {
      [Op.in]: Array.isArray(created_by) ? created_by : [created_by],
    };
  }

  const agentWhere = {};

  if (call_center_id) {
    agentWhere.call_center_id = {
      [Op.in]: Array.isArray(call_center_id)
        ? call_center_id
        : [call_center_id],
    };
  }

  return CaseAssignment.findAll({
    where,
    include: [
      {
        model: User,
        as: "agent",
        attributes: ["id", "fullname", "call_center_id"],
        where: Object.keys(agentWhere).length ? agentWhere : undefined,
        include: [
          {
            model: CallCenter,
            as: "callCenter",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        model: User,
        as: "createdBy",
        attributes: ["id", "fullname"],
      },
    ],
    order: [["assigned_at", "DESC"]],
  });
}

async function assignAgent({ caseNumber, agentId, userId }) {
  // Always close any active assignment first
  await closeActiveAssignment(caseNumber);

  // Create a new assignment only if an agent is provided
  if (agentId) {
    await createAssignment({
      caseNumber,
      agentId,
      userId,
    });
  } else {
    logger.info(`Agent removed from case ${caseNumber}`);
  }
}

//Close the current active assignment for a case (if any)
async function closeActiveAssignment(caseNumber) {
  logger.info(`Closing active assignment for case ${caseNumber}`);

  return CaseAssignment.update(
    { unassigned_at: new Date() },
    {
      where: {
        case_number: caseNumber,
        unassigned_at: null,
      },
    },
  );
}

//Update AttemptsDaily
async function updateActiveAssignmentAttempts(updates) {
  logger.info(`Updating attempts`);

  await CaseAssignment.update(
    {
      attempts: updates.attempts,
    },
    {
      where: {
        case_number: updates.case_number,
      },
    },
  );
}

//Create a new case assignment
async function createAssignment({ caseNumber, agentId, userId }) {
  logger.info(
    `Creating new assignment | case: ${caseNumber} | agent: ${agentId} | user: ${userId}`,
  );

  return CaseAssignment.create({
    case_number: caseNumber,
    agent_id: agentId,
    created_by: userId,
  });
}

module.exports = {
  assignAgent,
  ActiveAssignmentsDaily,
  ActiveAssignmentsAll,
  updateActiveAssignmentAttempts,
};
