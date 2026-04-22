const { Op } = require("sequelize");
const { DateTime } = require("luxon");
const logger = require("../../../utils/logger");
const { AttemptsDaily } = require("../../../models");
const sfMetrics = require("./salesforce.metrics");
const sqlServerService = require("../../../services/sqlserver");
const {
  getAgentsRealtime,
} = require("../../../services/vicidial/vicidialAgents.service");

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replaceAll(/\D/g, "");
  if (!digits) return null;

  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveTargetDate(dateKeyword, date) {
  if (dateKeyword === "today") {
    return DateTime.now().toISODate();
  }

  if (dateKeyword === "yesterday") {
    return DateTime.now().minus({ days: 1 }).toISODate();
  }

  if (date) {
    const parsed = DateTime.fromISO(date);
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    return parsed.toISODate();
  }

  return DateTime.now().toISODate();
}

function resolveAttemptsDateScope({ dateKeyword, date, lastDays, includeAll }) {
  if (includeAll) {
    return { scope: "all" };
  }

  if (date) {
    const parsed = DateTime.fromISO(date);
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    const isoDate = parsed.toISODate();
    return {
      scope: "single_day",
      startDate: isoDate,
      endDate: isoDate,
      label: isoDate,
    };
  }

  if (dateKeyword === "today" || dateKeyword === "yesterday") {
    const isoDate = resolveTargetDate(dateKeyword);
    return {
      scope: "single_day",
      startDate: isoDate,
      endDate: isoDate,
      label: isoDate,
    };
  }

  if (Number.isInteger(lastDays) && lastDays >= 2) {
    const endDate = DateTime.now().toISODate();
    const startDate = DateTime.now()
      .minus({ days: lastDays - 1 })
      .toISODate();

    return {
      scope: "range",
      startDate,
      endDate,
      label: `last_${lastDays}_days`,
    };
  }

  const today = DateTime.now().toISODate();
  return {
    scope: "single_day",
    startDate: today,
    endDate: today,
    label: today,
  };
}

exports.getAttemptsByPhone = async (phone, filters = {}) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error("INVALID_PHONE");
  }

  const scope = resolveAttemptsDateScope(filters);

  const where = {
    phone: {
      [Op.like]: `%${normalizedPhone}`,
    },
  };

  if (scope.scope === "single_day") {
    where.call_date = scope.startDate;
  }

  if (scope.scope === "range") {
    where.call_date = {
      [Op.between]: [scope.startDate, scope.endDate],
    };
  }

  const rows = await AttemptsDaily.findAll({
    where: {
      ...where,
    },
    raw: true,
    order: [["call_date", "DESC"]],
  });

  const totalAttempts = rows.reduce((sum, row) => sum + (row.attempts || 0), 0);

  return {
    phone: normalizedPhone,
    totalAttempts,
    totalDays: rows.length,
    scope: scope.scope,
    scopeLabel: scope.label || "all",
    records: rows,
  };
};

exports.getAttemptsByCaseNumber = async (caseNumber) => {
  const caseData = await sfMetrics.getCaseByNumber(caseNumber);

  if (!caseData) {
    return null;
  }

  const normalizedPhone = normalizePhone(caseData.Phone_Numbercontact__c);

  if (!normalizedPhone) {
    return {
      caseNumber: caseData.CaseNumber,
      phone: null,
      totalAttempts: 0,
      totalDays: 0,
      records: [],
    };
  }

  const attemptsData = await exports.getAttemptsByPhone(normalizedPhone, {
    includeAll: true,
  });

  return {
    caseNumber: caseData.CaseNumber,
    phone: attemptsData.phone,
    totalAttempts: attemptsData.totalAttempts,
    totalDays: attemptsData.totalDays,
    records: attemptsData.records,
  };
};

exports.getCaseAttemptsByDate = async ({ dateKeyword, date }) => {
  const targetDate = resolveTargetDate(dateKeyword, date);

  logger.info(`Fetching case attempts for date: ${targetDate}`);

  const sfResult = await sfMetrics.getCasesByDateRange(targetDate, targetDate);
  const sfCases = sfResult?.records || [];

  if (!sfCases.length) {
    return {
      date: targetDate,
      totalCases: 0,
      totalAttempts: 0,
      records: [],
    };
  }

  const phones = Array.from(
    new Set(
      sfCases
        .map((caseItem) => normalizePhone(caseItem.Phone_Numbercontact__c))
        .filter(Boolean),
    ),
  );

  const attemptsRows = phones.length
    ? await AttemptsDaily.findAll({
        where: {
          call_date: targetDate,
          phone: {
            [Op.in]: phones,
          },
        },
        raw: true,
      })
    : [];

  const attemptsByPhone = new Map(
    attemptsRows.map((row) => [normalizePhone(row.phone), row.attempts || 0]),
  );

  const records = sfCases.map((caseItem) => {
    const normalizedPhone = normalizePhone(caseItem.Phone_Numbercontact__c);
    const attempts = normalizedPhone
      ? (attemptsByPhone.get(normalizedPhone) ?? 0)
      : 0;

    return {
      CaseNumber: caseItem.CaseNumber,
      phone: normalizedPhone,
      attempts,
      Status: caseItem.Status,
      Substatus__c: caseItem.Substatus__c,
      Owner: caseItem.Owner,
      CreatedDate: caseItem.CreatedDate,
    };
  });

  const totalAttempts = records.reduce(
    (sum, row) => sum + (row.attempts || 0),
    0,
  );

  return {
    date: targetDate,
    totalCases: records.length,
    totalAttempts,
    records,
  };
};

exports.getTotalAttemptsByAgent = async (
  agentName,
  { dateKeyword, date } = {},
) => {
  const targetDate = resolveTargetDate(dateKeyword, date);
  const allRows = await Promise.resolve(
    sqlServerService.getAgentsAttempts(targetDate),
  );

  const normalizedAgent = normalizeText(agentName);
  const rows = allRows.filter((row) =>
    normalizeText(row["AGENT NAME"]).includes(normalizedAgent),
  );

  const totalAttempts = rows.reduce(
    (sum, row) => sum + Number(row.ATTEMPTS || 0),
    0,
  );

  const phones = new Set(
    rows.map((row) => normalizePhone(row["PHONE NUMBER"])).filter(Boolean),
  );

  const byHourMap = new Map();
  rows.forEach((row) => {
    const hour = Number(row.HOUR);
    byHourMap.set(hour, (byHourMap.get(hour) || 0) + Number(row.ATTEMPTS || 0));
  });

  const byHour = Array.from(byHourMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, attempts]) => ({ hour, attempts }));

  return {
    agentName,
    date: targetDate,
    totalAttempts,
    totalRows: rows.length,
    totalPhones: phones.size,
    byHour,
    records: rows,
  };
};

exports.getAgentAttemptsByPhonePerHour = async (
  agentName,
  phone,
  { dateKeyword, date } = {},
) => {
  const targetDate = resolveTargetDate(dateKeyword, date);
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error("INVALID_PHONE");
  }

  const allRows = await Promise.resolve(
    sqlServerService.getAgentsAttempts(targetDate),
  );
  const normalizedAgent = normalizeText(agentName);

  const rows = allRows.filter((row) => {
    const rowAgent = normalizeText(row["AGENT NAME"]);
    const rowPhone = normalizePhone(row["PHONE NUMBER"]);

    return rowAgent.includes(normalizedAgent) && rowPhone === normalizedPhone;
  });

  const byHourMap = new Map();
  rows.forEach((row) => {
    const hour = Number(row.HOUR);
    byHourMap.set(hour, (byHourMap.get(hour) || 0) + Number(row.ATTEMPTS || 0));
  });

  const byHour = Array.from(byHourMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, attempts]) => ({ hour, attempts }));

  const totalAttempts = byHour.reduce((sum, row) => sum + row.attempts, 0);

  return {
    agentName,
    phone: normalizedPhone,
    date: targetDate,
    totalAttempts,
    byHour,
    records: rows,
  };
};

exports.getVicidialAgentsStatus = async ({ agentName } = {}) => {
  const agents = await getAgentsRealtime();
  const normalizedAgent = normalizeText(agentName);

  const records = normalizedAgent
    ? agents.filter((agent) =>
        normalizeText(agent.name).includes(normalizedAgent),
      )
    : agents;

  return {
    total: records.length,
    records,
  };
};
