const { Op } = require("sequelize");
const { CaseComment } = require("../../models");
const logger = require("../../utils/logger");

function normalizeCaseNumber(caseNumber) {
  return String(caseNumber || "").trim();
}

function normalizeComment(comment) {
  return String(comment || "").trim();
}

async function upsertClosedCaseComment({ caseNumber, comment, userId }) {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedComment = normalizeComment(comment);

  const existing = await CaseComment.findOne({
    where: { case_number: normalizedCaseNumber },
  });

  if (existing) {
    existing.comment = normalizedComment;
    existing.updated_by = userId ?? null;
    await existing.save();

    logger.info(
      `ClosedCasesCommentService → updated comment | case: ${normalizedCaseNumber}`,
    );

    return existing;
  }

  const created = await CaseComment.create({
    case_number: normalizedCaseNumber,
    comment: normalizedComment,
    created_by: userId ?? null,
    updated_by: userId ?? null,
  });

  logger.info(
    `ClosedCasesCommentService → created comment | case: ${normalizedCaseNumber}`,
  );

  return created;
}

async function deleteClosedCaseComment(caseNumber) {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);

  const deletedRows = await CaseComment.destroy({
    where: { case_number: normalizedCaseNumber },
  });

  logger.info(
    `ClosedCasesCommentService → deleted comment | case: ${normalizedCaseNumber} | rows: ${deletedRows}`,
  );

  return deletedRows > 0;
}

async function getCommentsByCaseNumbers(caseNumbers = []) {
  const normalizedCaseNumbers = [
    ...new Set(caseNumbers.map(normalizeCaseNumber)),
  ].filter(Boolean);

  if (!normalizedCaseNumbers.length) {
    return new Map();
  }

  const comments = await CaseComment.findAll({
    where: {
      case_number: {
        [Op.in]: normalizedCaseNumbers,
      },
    },
    attributes: ["case_number", "comment"],
  });

  return new Map(comments.map((item) => [item.case_number, item.comment]));
}

module.exports = {
  upsertClosedCaseComment,
  deleteClosedCaseComment,
  getCommentsByCaseNumbers,
};
