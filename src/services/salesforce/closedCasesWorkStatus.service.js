const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const { ClosedCaseWorkStatus } = require("../../models");

const EVENT_TYPE_TO_FIELD = {
  excel_downloaded: "excel_downloaded",
  recording_reviewed: "recording_reviewed",
};

function normalizeCaseNumber(caseNumber) {
  return String(caseNumber || "").trim();
}

function normalizeCaseNumbers(caseNumbers = []) {
  if (!Array.isArray(caseNumbers)) {
    return [];
  }

  return [...new Set(caseNumbers.map(normalizeCaseNumber).filter(Boolean))];
}

function normalizeStatusRecord(record) {
  const excelDownloaded = Boolean(record.excel_downloaded);
  const recordingReviewed = Boolean(record.recording_reviewed);

  return {
    excelDownloaded,
    recordingReviewed,
    worked: excelDownloaded || recordingReviewed,
    firstWorkedAt: record.first_worked_at || null,
    lastWorkedAt: record.last_worked_at || null,
  };
}

async function getWorkStatusByCaseNumbers(caseNumbers = []) {
  const normalizedCaseNumbers = normalizeCaseNumbers(caseNumbers);

  if (!normalizedCaseNumbers.length) {
    return new Map();
  }

  const rows = await ClosedCaseWorkStatus.findAll({
    where: {
      case_number: {
        [Op.in]: normalizedCaseNumbers,
      },
    },
  });

  return new Map(
    rows.map((row) => [
      normalizeCaseNumber(row.case_number),
      normalizeStatusRecord(row),
    ]),
  );
}

function enrichCasesWithWorkStatus(cases = [], statusMap = new Map()) {
  return cases.map((item) => {
    const caseNumber = normalizeCaseNumber(item.caseNumber);
    const status = statusMap.get(caseNumber);

    if (!status) {
      return {
        ...item,
        excelDownloaded: false,
        recordingReviewed: false,
        worked: false,
        firstWorkedAt: null,
        lastWorkedAt: null,
      };
    }

    return {
      ...item,
      excelDownloaded: status.excelDownloaded,
      recordingReviewed: status.recordingReviewed,
      worked: status.worked,
      firstWorkedAt: status.firstWorkedAt,
      lastWorkedAt: status.lastWorkedAt,
    };
  });
}

async function markClosedCasesWorked({ caseNumbers, eventType, performedBy }) {
  const normalizedCaseNumbers = normalizeCaseNumbers(caseNumbers);
  const eventField = EVENT_TYPE_TO_FIELD[eventType];

  if (!eventField) {
    throw Object.assign(new Error(`Invalid eventType: ${eventType}`), {
      statusCode: 400,
    });
  }

  if (!normalizedCaseNumbers.length) {
    return {
      eventType,
      totalRequested: 0,
      totalUpdated: 0,
      totalCreated: 0,
      caseNumbers: [],
    };
  }

  const now = new Date();

  return sequelize.transaction(async (transaction) => {
    const existingRows = await ClosedCaseWorkStatus.findAll({
      where: {
        case_number: {
          [Op.in]: normalizedCaseNumbers,
        },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const existingByCaseNumber = new Map(
      existingRows.map((row) => [normalizeCaseNumber(row.case_number), row]),
    );

    let totalUpdated = 0;
    let totalCreated = 0;

    for (const caseNumber of normalizedCaseNumbers) {
      const current = existingByCaseNumber.get(caseNumber);

      if (!current) {
        await ClosedCaseWorkStatus.create(
          {
            case_number: caseNumber,
            excel_downloaded: eventField === "excel_downloaded",
            recording_reviewed: eventField === "recording_reviewed",
            first_worked_at: now,
            last_worked_at: now,
            updated_by: performedBy || null,
          },
          { transaction },
        );

        totalCreated += 1;
        continue;
      }

      current[eventField] = true;
      current.first_worked_at = current.first_worked_at || now;
      current.last_worked_at = now;
      current.updated_by = performedBy || current.updated_by || null;
      await current.save({ transaction });
      totalUpdated += 1;
    }

    return {
      eventType,
      totalRequested: normalizedCaseNumbers.length,
      totalUpdated,
      totalCreated,
      caseNumbers: normalizedCaseNumbers,
    };
  });
}

module.exports = {
  getWorkStatusByCaseNumbers,
  enrichCasesWithWorkStatus,
  markClosedCasesWorked,
};
