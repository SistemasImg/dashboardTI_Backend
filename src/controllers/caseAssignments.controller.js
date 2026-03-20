const logger = require("../utils/logger");
const {
  assignAgent,
  ActiveAssignmentsDaily,
  ActiveAssignmentsAll,
} = require("../services/caseAssignments.service");

async function activeAssignments(req, res, next) {
  logger.info("CaseAssignmentsController → ActiveAssignmentsDaily() called");

  try {
    const result = await ActiveAssignmentsDaily();

    logger.success(
      "CaseAssignmentsController → ActiveAssignmentsDaily() completed successfully",
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `CaseAssignmentsController → ActiveAssignmentsDaily() error: ${error.message}`,
    );
    next(error);
  }
}

async function AllactiveAssignments(req, res, next) {
  logger.info("CaseAssignmentsController → AllactiveAssignments() called");

  try {
    const filters = {
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      agent_id: req.query.agent_id,
      created_by: req.query.created_by,
      case_number: req.query.case_number,
      call_center_id: req.query.call_center_id,
    };

    const result = await ActiveAssignmentsAll(filters);

    logger.success(
      "CaseAssignmentsController → AllactiveAssignments() completed successfully",
    );
    return res.json(result);
  } catch (error) {
    logger.error(
      `CaseAssignmentsController → AllactiveAssignments() error: ${error.message}`,
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
  AllactiveAssignments,
};
