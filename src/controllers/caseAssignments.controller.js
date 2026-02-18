const logger = require("../utils/logger");
const {
  assignAgent,
  getActiveAssignments,
} = require("../services/caseAssignments.service");

async function activeAssignments(req, res, next) {
  logger.info("CaseAssignmentsController → getActiveAssignments() called");

  try {
    const result = await getActiveAssignments();

    logger.success(
      "CaseAssignmentsController → getActiveAssignments() completed successfully",
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `CaseAssignmentsController → getActiveAssignments() error: ${error.message}`,
    );
    next(error);
  }
}

async function assignAgentToCase(req, res) {
  try {
    const { caseNumber, agentId } = req.body;
    const userId = req.user.id;

    if (!caseNumber) {
      logger.warn("Assign agent failed: caseNumber is missing");
      return res.status(400).json({ message: "caseNumber is required" });
    }

    await assignAgent({
      caseNumber,
      agentId: agentId ?? null,
      userId,
    });

    logger.info(
      `Assignment updated successfully | case: ${caseNumber} | agent: ${
        agentId ?? "removed"
      } | user: ${userId}`,
    );

    res.json({ message: "Assignment updated successfully" });
  } catch (error) {
    logger.error(
      `Assign Agent Error | case: ${req.body.caseNumber} | error: ${error.message}`,
    );

    res.status(500).json({ message: "Error assigning agent" });
  }
}

module.exports = {
  assignAgentToCase,
  activeAssignments,
};
