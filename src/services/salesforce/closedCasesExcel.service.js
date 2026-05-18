const ExcelJS = require("exceljs");
const logger = require("../../utils/logger");
const { getClosedCasesReport } = require("./closedCases.service");
const {
  searchVicidialLeadByPhone,
} = require("../vicidial/vicidialLeadSearch.service");
const { normalizeDigits } = require("../../utils/vicidialLeadSearchParser");

const VALID_TYPES = new Set(["disqualified", "rejected", "signed"]);
const VICIDIAL_CONCURRENCY = 4;

function getMinimumRecordingSeconds(reportType) {
  if (reportType === "signed") return 120;
  if (reportType === "disqualified") return 60;
  return null;
}

async function mapWithConcurrency(items, limit, handler) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

function normalizePhone(value) {
  const digits = normalizeDigits(value);
  return digits || null;
}

function buildCaseBaseRow(caseItem, reportType, reportDate) {
  return {
    reportDate,
    reportType,
    supplier: caseItem.supplier || null,
    caseNumber: caseItem.caseNumber || null,
    caseOwner: caseItem.caseOwner || null,
    origin: caseItem.origin || null,
    fullName: caseItem.fullName || null,
    phoneNumber: caseItem.phoneNumber || null,
    substatus: caseItem.substatus || null,
    type: caseItem.type || null,
    tier: caseItem.tier || null,
    reasonForDQ: caseItem.reasonForDQ || null,
    reasonForReject: caseItem.reasonForReject || null,
  };
}

function formatSecondsAsMinutes(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

function formatTotalMinutes(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "0.00";
  }

  return (seconds / 60).toFixed(2);
}

function getVicidialLeadStatus(lead) {
  if (!lead) return null;
  if (Array.isArray(lead.columns) && lead.columns[2]) return lead.columns[2];
  return null;
}

function getVicidialLeadAgent(lead) {
  if (!lead) return null;
  if (Array.isArray(lead.columns) && lead.columns[3]) return lead.columns[3];
  return null;
}

function getVicidialLeadDate(lead) {
  if (!lead) return null;
  if (Array.isArray(lead.columns) && lead.columns[6]) return lead.columns[6];
  return null;
}

function buildCaseRowsWithVicidial(
  caseItem,
  reportType,
  reportDate,
  vicidialData,
) {
  const base = buildCaseBaseRow(caseItem, reportType, reportDate);
  const minimumRecordingSeconds = getMinimumRecordingSeconds(reportType);
  const requiresQualifiedRecording =
    typeof minimumRecordingSeconds === "number";
  const isRejected = reportType === "rejected";

  if (
    !vicidialData ||
    !Array.isArray(vicidialData.records) ||
    !vicidialData.records.length
  ) {
    if (requiresQualifiedRecording) {
      return [];
    }

    return [
      {
        ...base,
        recordingName: null,
        recordingAgent: null,
        recordingStatus: null,
        recordingDurationMinutes: null,
        recordingDurationSeconds: null,
        recordingDate: null,
        recordingAudioUrl: null,
      },
    ];
  }

  const rows = [];

  vicidialData.records.forEach((lead) => {
    const leadStatus = getVicidialLeadStatus(lead);
    const leadAgent = getVicidialLeadAgent(lead);
    const leadDate = getVicidialLeadDate(lead);
    const leadRecordings = Array.isArray(lead.recordings)
      ? lead.recordings
      : [];

    if (isRejected) {
      rows.push({
        ...base,
        recordingName: null,
        recordingAgent: leadAgent,
        recordingStatus: leadStatus,
        recordingDurationMinutes: null,
        recordingDurationSeconds: null,
        recordingDate: leadDate,
        recordingAudioUrl: null,
      });
      return;
    }

    const filteredRecordings =
      typeof minimumRecordingSeconds === "number"
        ? leadRecordings.filter(
            (recording) =>
              typeof recording.seconds === "number" &&
              recording.seconds > minimumRecordingSeconds,
          )
        : leadRecordings;

    if (!filteredRecordings.length) {
      if (requiresQualifiedRecording) {
        return;
      }

      rows.push({
        ...base,
        recordingName: null,
        recordingAgent: null,
        recordingStatus: leadStatus,
        recordingDurationMinutes: null,
        recordingDurationSeconds: null,
        recordingDate: null,
        recordingAudioUrl: null,
      });
      return;
    }

    filteredRecordings.forEach((recording) => {
      rows.push({
        ...base,
        recordingName: recording.fileName || null,
        recordingAgent: recording.agent || recording.tsr || null,
        recordingStatus: recording.status || leadStatus,
        recordingDurationMinutes: formatSecondsAsMinutes(recording.seconds),
        recordingDurationSeconds:
          typeof recording.seconds === "number" ? recording.seconds : null,
        recordingDate: recording.dateTime || null,
        recordingAudioUrl: recording.location || null,
      });
    });
  });

  if (requiresQualifiedRecording) {
    return rows;
  }

  return rows.length
    ? rows
    : [
        {
          ...base,
          recordingName: null,
          recordingAgent: null,
          recordingStatus: null,
          recordingDurationMinutes: null,
          recordingDurationSeconds: null,
          recordingDate: null,
          recordingAudioUrl: null,
        },
      ];
}

function buildWorkbookGroups(cases, reportType, reportDate, vicidialPhoneMap) {
  return cases
    .map((caseItem) => {
      const phone = normalizePhone(caseItem.phoneNumber);
      const vicidialData = phone ? vicidialPhoneMap.get(phone) : null;
      const rows = buildCaseRowsWithVicidial(
        caseItem,
        reportType,
        reportDate,
        vicidialData,
      );

      return {
        caseItem,
        rows,
      };
    })
    .filter((group) => group.rows.length > 0);
}

function getTotalRecordingSeconds(groups) {
  return groups.reduce(
    (total, group) =>
      total +
      group.rows.reduce((groupTotal, row) => {
        if (
          typeof row.recordingDurationSeconds === "number" &&
          Number.isFinite(row.recordingDurationSeconds)
        ) {
          return groupTotal + row.recordingDurationSeconds;
        }

        return groupTotal;
      }, 0),
    0,
  );
}

async function fetchVicidialByPhone(cases) {
  const phoneSet = new Set(
    cases.map((item) => normalizePhone(item.phoneNumber)).filter(Boolean),
  );
  const phones = Array.from(phoneSet);
  const phoneMap = new Map();

  await mapWithConcurrency(phones, VICIDIAL_CONCURRENCY, async (phone) => {
    try {
      const payload = await searchVicidialLeadByPhone(phone);
      phoneMap.set(phone, payload);
    } catch (error) {
      logger.warn(
        `ClosedCasesExcelService → Vicidial lookup failed for ${phone}: ${error.message}`,
      );
      phoneMap.set(phone, null);
    }
  });

  return phoneMap;
}

async function getVicidialPhoneMapForReport(cases, reportType) {
  return fetchVicidialByPhone(cases);
}

function mergeCaseColumnsForGroup(worksheet, startRow, endRow) {
  const caseColumnStart = 1;
  const caseColumnEnd = 13;

  if (endRow <= startRow) {
    return;
  }

  for (let column = caseColumnStart; column <= caseColumnEnd; column += 1) {
    worksheet.mergeCells(startRow, column, endRow, column);
    const cell = worksheet.getCell(startRow, column);
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.font = { bold: true };
  }

  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = row.height || 20;

    for (let column = 14; column <= 19; column += 1) {
      const cell = worksheet.getCell(rowNumber, column);
      cell.alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      };
    }
  }

  const topRow = worksheet.getRow(startRow);
  const bottomRow = worksheet.getRow(endRow);

  topRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: "medium", color: { argb: "FF9FB6CD" } },
      bottom: cell.border?.bottom || {
        style: "thin",
        color: { argb: "FFD9E2F1" },
      },
    };
  });

  bottomRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: cell.border?.top || { style: "thin", color: { argb: "FFD9E2F1" } },
      bottom: { style: "medium", color: { argb: "FF9FB6CD" } },
    };
  });
}

function styleHeaderRow(headerRow) {
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
}

function applyColumnSetup(worksheet) {
  worksheet.columns = [
    { header: "Report Date", key: "reportDate", width: 14 },
    { header: "Report Type", key: "reportType", width: 16 },
    { header: "Supplier", key: "supplier", width: 24 },
    { header: "Case Number", key: "caseNumber", width: 16 },
    { header: "Case Owner", key: "caseOwner", width: 24 },
    { header: "Origin", key: "origin", width: 16 },
    { header: "Full Name", key: "fullName", width: 28 },
    { header: "Phone Number", key: "phoneNumber", width: 18 },
    { header: "Substatus", key: "substatus", width: 16 },
    { header: "Type", key: "type", width: 16 },
    { header: "Tier", key: "tier", width: 10 },
    { header: "Reason For DQ", key: "reasonForDQ", width: 24 },
    { header: "Reason For Reject", key: "reasonForReject", width: 28 },
    { header: "Recording Name", key: "recordingName", width: 40 },
    { header: "Recording Agent", key: "recordingAgent", width: 20 },
    { header: "Recording Status", key: "recordingStatus", width: 20 },
    {
      header: "Recording Duration (min)",
      key: "recordingDurationMinutes",
      width: 20,
    },
    { header: "Recording Date", key: "recordingDate", width: 22 },
    { header: "Recording Audio URL", key: "recordingAudioUrl", width: 130 },
  ];

  styleHeaderRow(worksheet.getRow(1));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  };
}

function safeFileNamePart(value, fallback) {
  const raw = String(value || fallback || "report").trim();
  return raw.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

async function streamClosedCasesVicidialExcel({ date, type, caseType, res }) {
  const reportType = String(type || "").toLowerCase();

  if (!VALID_TYPES.has(reportType)) {
    throw Object.assign(
      new Error(
        "Query param 'type' is required: disqualified | rejected | signed",
      ),
      { statusCode: 400 },
    );
  }

  logger.info(
    `ClosedCasesExcelService → start export | date=${date} type=${reportType} caseType=${caseType || "(none)"}`,
  );

  const report = await getClosedCasesReport(date, reportType, caseType);
  const vicidialPhoneMap = await getVicidialPhoneMapForReport(
    report.cases,
    reportType,
  );
  const groups = buildWorkbookGroups(
    report.cases,
    report.reportType,
    report.date,
    vicidialPhoneMap,
  );

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Cases + Vicidial");

  applyColumnSetup(worksheet);

  let currentRow = 2;

  groups.forEach((group) => {
    const startRow = currentRow;

    group.rows.forEach((row) => {
      worksheet.addRow(row);
      currentRow += 1;
    });

    const endRow = currentRow - 1;
    mergeCaseColumnsForGroup(worksheet, startRow, endRow);
  });

  const totalRecordingSeconds = getTotalRecordingSeconds(groups);
  const totalRow = worksheet.addRow({
    recordingStatus: "Total Recording Minutes",
    recordingDurationMinutes: formatTotalMinutes(totalRecordingSeconds),
  });
  totalRow.font = { bold: true };
  totalRow.getCell(16).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(17).alignment = { horizontal: "center", vertical: "middle" };

  const filename = `${safeFileNamePart(reportType, "closed_cases")}_${safeFileNamePart(date, "date")}_vicidial.xlsx`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();

  logger.success(
    `ClosedCasesExcelService → export generated | type=${reportType} rows=${groups.reduce((total, group) => total + group.rows.length, 0)}`,
  );

  return {
    totalCases: report.total,
    totalRows: groups.reduce((total, group) => total + group.rows.length, 0),
  };
}

module.exports = {
  streamClosedCasesVicidialExcel,
};
