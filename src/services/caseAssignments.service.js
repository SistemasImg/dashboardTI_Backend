const { CaseAssignment, Agents } = require("../models");
const logger = require("../utils/logger");

/**
 * Get all active case assignments
 */
async function getActiveAssignments() {
  logger.info("Fetching active case assignments");

  return CaseAssignment.findAll({
    where: {
      unassigned_at: null,
    },
    include: [
      {
        model: Agents,
        as: "agent",
        attributes: ["id", "fullname", "call_center"],
      },
    ],
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
    }
  );
}

//Create a new case assignment
async function createAssignment({ caseNumber, agentId, userId }) {
  logger.info(
    `Creating new assignment | case: ${caseNumber} | agent: ${agentId} | user: ${userId}`
  );

  return CaseAssignment.create({
    case_number: caseNumber,
    agent_id: agentId,
    created_by: userId,
  });
}

module.exports = {
  assignAgent,
  getActiveAssignments,
};
