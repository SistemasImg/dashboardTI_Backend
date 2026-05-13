const logger = require("../../utils/logger");
const {
  upsertClosedCaseComment,
  deleteClosedCaseComment,
} = require("../../services/salesforce/closedCasesComment.service");

async function upsertComment(req, res, next) {
  logger.info("ClosedCasesCommentController → upsertComment() called");

  try {
    const { caseNumber, comment } = req.body;
    const userId = req.user?.id ?? null;

    const saved = await upsertClosedCaseComment({
      caseNumber,
      comment,
      userId,
    });

    return res.json({
      message: "Comment saved successfully",
      data: {
        caseNumber: saved.case_number,
        comment: saved.comment,
      },
    });
  } catch (error) {
    logger.error(
      `ClosedCasesCommentController → upsertComment() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
  }
}

async function deleteComment(req, res, next) {
  logger.info("ClosedCasesCommentController → deleteComment() called");

  try {
    const { caseNumber } = req.params;

    const deleted = await deleteClosedCaseComment(caseNumber);

    if (!deleted) {
      return res.status(404).json({ message: "Comment not found" });
    }

    return res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    logger.error(
      `ClosedCasesCommentController → deleteComment() error: ${error.message}`,
      { stack: error.stack, origin: "controller" },
    );

    next(error);
  }
}

module.exports = {
  upsertComment,
  deleteComment,
};
