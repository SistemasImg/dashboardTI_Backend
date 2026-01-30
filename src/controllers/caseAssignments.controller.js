const logger = require("../utils/logger");
const { assignAgent } = require("../services/caseAssignments.service");

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
      } | user: ${userId}`
    );

    res.json({ message: "Assignment updated successfully" });
  } catch (error) {
    logger.error(
      `Assign Agent Error | case: ${req.body.caseNumber} | error: ${error.message}`
    );

    res.status(500).json({ message: "Error assigning agent" });
  }
}

module.exports = {
  assignAgentToCase,
};
