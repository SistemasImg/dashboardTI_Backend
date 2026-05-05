const CaseAssignment = require("../../../models/caseAssignments");
const User = require("../../../models/user");
const logger = require("../../../utils/logger");

/**
 * Returns the active agent assignment for a given case number.
 * Looks for the latest record where unassigned_at IS NULL.
 */
exports.getAssignedAgentByCaseNumber = async (caseNumber) => {
  try {
    logger.info(`[MySQL] Looking up agent for case: ${caseNumber}`);

    const assignment = await CaseAssignment.findOne({
      where: {
        case_number: caseNumber,
        unassigned_at: null,
      },
      include: [
        {
          model: User,
          as: "agent",
          attributes: ["id", "fullname", "email"],
          required: false,
        },
      ],
      order: [["assigned_at", "DESC"]],
    });

    if (!assignment) {
      return { found: false, caseNumber };
    }

    return {
      found: true,
      caseNumber,
      agentId: assignment.agent_id,
      agentName: assignment.agent?.fullname || null,
      agentEmail: assignment.agent?.email || null,
      assignedAt: assignment.assigned_at,
    };
  } catch (error) {
    logger.error(
      `[MySQL] getAssignedAgentByCaseNumber error: ${error.message}`,
    );
    throw new Error("MYSQL_CASE_ASSIGNMENT_QUERY_FAILED");
  }
};
