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

function resolveAttemptsDateScope({
  dateKeyword,
  date,
  lastDays,
  includeAll,
  startDate,
  endDate,
}) {
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

  if (dateKeyword === "today and yesterday") {
    const endDate = DateTime.now().toISODate();
    const startDate = DateTime.now().minus({ days: 1 }).toISODate();
    return {
      scope: "range",
      startDate,
      endDate,
      label: `${startDate}..${endDate}`,
    };
  }

  if (startDate && endDate) {
    const parsedStart = DateTime.fromISO(startDate);
    const parsedEnd = DateTime.fromISO(endDate);

    if (!parsedStart.isValid || !parsedEnd.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    return {
      scope: "range",
      startDate: parsedStart.toISODate(),
      endDate: parsedEnd.toISODate(),
      label: `${parsedStart.toISODate()}..${parsedEnd.toISODate()}`,
    };
  }

  // Default behavior without explicit date filters: search full available history.
  return {
    scope: "all",
    label: "all",
  };
}

function listDatesFromScope(scope) {
  if (!scope || scope.scope === "all") return [];

  const start = DateTime.fromISO(scope.startDate);
  const end = DateTime.fromISO(scope.endDate);
  if (!start.isValid || !end.isValid) {
    throw new Error("INVALID_DATE_FORMAT");
  }

  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current.toISODate());
    current = current.plus({ days: 1 });
  }

  return dates;
}

function buildHourLabel(callDate, hour) {
  const safeHour = Number.isFinite(Number(hour))
    ? String(Number(hour)).padStart(2, "0")
    : "00";

  return callDate ? `${callDate} ${safeHour}:00` : `${safeHour}:00`;
}

exports.getAttemptsByPhone = async (phone, filters = {}) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error("INVALID_PHONE");
  }

  const scope = resolveAttemptsDateScope(filters);

  const getSqlAttemptsForDate = async (targetDate) => {
    const sqlRows = await Promise.resolve(
      sqlServerService.getAgentsAttempts(targetDate),
    );

    return sqlRows
      .filter((row) => normalizePhone(row["PHONE NUMBER"]) === normalizedPhone)
      .reduce((sum, row) => sum + Number(row.ATTEMPTS || 0), 0);
  };

  // For date-scoped queries, prefer SQL Server real-time data.
  if (scope.scope === "single_day" || scope.scope === "range") {
    const dates = listDatesFromScope(scope);
    const rows = [];

    for (const targetDate of dates) {
      const attempts = await getSqlAttemptsForDate(targetDate);
      if (attempts > 0) {
        rows.push({ call_date: targetDate, attempts });
      }
    }

    rows.sort((a, b) => String(b.call_date).localeCompare(String(a.call_date)));

    return {
      phone: normalizedPhone,
      totalAttempts: rows.reduce((sum, row) => sum + (row.attempts || 0), 0),
      totalDays: rows.length,
      scope: scope.scope,
      scopeLabel: scope.label || "all",
      records: rows,
    };
  }

  const where = {
    phone: {
      [Op.like]: `%${normalizedPhone}`,
    },
  };

  // Full-history mode: keep historical table but override today's value with SQL real-time.
  const historyRows = await AttemptsDaily.findAll({
    where: {
      ...where,
    },
    raw: true,
    order: [["call_date", "DESC"]],
  });

  const today = DateTime.now().toISODate();
  const todayAttempts = await getSqlAttemptsForDate(today);

  const rowsMap = new Map();
  historyRows.forEach((row) => {
    if (!row.call_date) return;
    rowsMap.set(String(row.call_date), {
      call_date: String(row.call_date),
      attempts: Number(row.attempts || 0),
    });
  });

  rowsMap.set(today, {
    call_date: today,
    attempts: Number(todayAttempts || 0),
  });

  const rows = Array.from(rowsMap.values())
    .filter((row) => Number(row.attempts || 0) > 0)
    .sort((a, b) => String(b.call_date).localeCompare(String(a.call_date)));

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

  const attemptsByPhone = new Map();
  if (phones.length) {
    const phoneSet = new Set(phones);
    const sqlRows = await Promise.resolve(
      sqlServerService.getAgentsAttempts(targetDate),
    );

    sqlRows.forEach((row) => {
      const normalizedPhone = normalizePhone(row["PHONE NUMBER"]);
      if (!normalizedPhone || !phoneSet.has(normalizedPhone)) return;

      attemptsByPhone.set(
        normalizedPhone,
        (attemptsByPhone.get(normalizedPhone) || 0) + Number(row.ATTEMPTS || 0),
      );
    });
  }

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

exports.getVendorLeadAttempts = async (vendorName, filters = {}) => {
  const normalizedVendorName = String(vendorName || "").trim();
  const includeAgentDetails = Boolean(filters.includeAgentDetails);
  if (!normalizedVendorName) {
    throw new Error("INVALID_VENDOR_NAME");
  }

  const vendorCases = await sfMetrics.getVendorCases(normalizedVendorName, {
    dateKeyword: filters.dateKeyword,
    period: filters.period,
    date: filters.date,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  if (!vendorCases?.records?.length) {
    return {
      vendorName: normalizedVendorName,
      scope: vendorCases?.scope || "all",
      totalCases: 0,
      totalAttempts: 0,
      records: [],
    };
  }

  const attemptsScope = resolveAttemptsDateScope(filters);

  const casesByNumber = new Map();
  const caseNumbersByPhone = new Map();

  vendorCases.records.forEach((item) => {
    const normalizedPhone = normalizePhone(item.phone);
    casesByNumber.set(item.caseNumber, {
      vendor: item.vendor,
      caseNumber: item.caseNumber,
      phone: normalizedPhone || item.phone || null,
      segment: item.segment || "N/A",
      createdDate: item.createdDate,
    });

    if (!normalizedPhone) return;
    if (!caseNumbersByPhone.has(normalizedPhone)) {
      caseNumbersByPhone.set(normalizedPhone, []);
    }

    caseNumbersByPhone.get(normalizedPhone).push(item.caseNumber);
  });

  const recordsByCaseNumber = new Map(
    Array.from(casesByNumber.values()).map((item) => [
      item.caseNumber,
      {
        ...item,
        attempts: 0,
        byHour: [],
        matchQuality: "exact",
      },
    ]),
  );

  const exportRows = [];
  let ambiguousRows = 0;
  let unmatchedRows = 0;

  if (attemptsScope.scope !== "all") {
    const dates = listDatesFromScope(attemptsScope);

    for (const targetDate of dates) {
      const sqlRows = await Promise.resolve(
        sqlServerService.getAgentsAttempts(targetDate),
      );

      sqlRows.forEach((row) => {
        const rowPhone = normalizePhone(row["PHONE NUMBER"]);
        const rowCaseNumber = String(row.CASE_NUMBER || "").trim() || null;
        const candidateCaseNumbers = rowPhone
          ? caseNumbersByPhone.get(rowPhone) || []
          : [];

        let resolvedCaseNumber = null;
        let matchQuality = null;

        if (rowCaseNumber && recordsByCaseNumber.has(rowCaseNumber)) {
          resolvedCaseNumber = rowCaseNumber;
          matchQuality = "exact_case";
        } else if (candidateCaseNumbers.length > 1) {
          ambiguousRows += 1;
          return;
        } else {
          unmatchedRows += 1;
          return;
        }

        const record = recordsByCaseNumber.get(resolvedCaseNumber);
        const attempts = Number(row.ATTEMPTS || 0);
        const callDate = row.DATE || targetDate;
        const hour = Number(row.HOUR);

        record.attempts += attempts;
        record.matchQuality = "exact_case";

        record.byHour.push({
          callDate,
          hour,
          attempts,
          label: buildHourLabel(callDate, hour),
          agentName: row["AGENT NAME"] || null,
          callCenter: row["CALL CENTER"] || null,
        });

        exportRows.push({
          vendor: record.vendor,
          caseNumber: record.caseNumber,
          phone: record.phone,
          attempts,
          segment: record.segment,
          createdDate: record.createdDate,
          scope: vendorCases.scope,
          callDate,
          hour,
          assignmentType: matchQuality,
          agentName: row["AGENT NAME"] || null,
          callCenter: row["CALL CENTER"] || null,
        });
      });
    }

    const records = Array.from(recordsByCaseNumber.values())
      .map((item) => ({
        ...item,
        byHour: item.byHour.sort((a, b) => {
          if (a.callDate !== b.callDate) {
            return String(a.callDate).localeCompare(String(b.callDate));
          }
          return Number(a.hour) - Number(b.hour);
        }),
      }))
      .sort((a, b) => b.attempts - a.attempts);

    return {
      vendorName: normalizedVendorName,
      scope: vendorCases.scope,
      attemptsScope: attemptsScope.label || attemptsScope.scope,
      totalCases: records.length,
      totalAttempts: records.reduce((sum, row) => sum + (row.attempts || 0), 0),
      detailMode: "hourly",
      includeAgentDetails,
      agentDetailsAvailable: includeAgentDetails,
      ambiguousRows,
      unmatchedRows,
      exportRows,
      records,
    };
  }

  const normalizedPhones = Array.from(
    new Set(
      vendorCases.records
        .map((row) => normalizePhone(row.phone))
        .filter(Boolean),
    ),
  );

  let attemptsRows = [];
  if (normalizedPhones.length) {
    const phoneWhere = {
      [Op.or]: normalizedPhones.map((phone) => ({
        phone: {
          [Op.like]: `%${phone}`,
        },
      })),
    };

    const where = {
      ...phoneWhere,
    };

    if (attemptsScope.scope === "single_day") {
      where.call_date = attemptsScope.startDate;
    }

    if (attemptsScope.scope === "range") {
      where.call_date = {
        [Op.between]: [attemptsScope.startDate, attemptsScope.endDate],
      };
    }

    attemptsRows = await AttemptsDaily.findAll({
      where,
      raw: true,
    });
  }

  const attemptsByPhone = new Map();
  const attemptsByPhoneDate = new Map();
  attemptsRows.forEach((row) => {
    const phone = normalizePhone(row.phone);
    if (!phone) return;

    const callDate = String(row.call_date || "");
    const key = `${phone}::${callDate}`;
    attemptsByPhoneDate.set(key, Number(row.attempts || 0));
  });

  // Keep history from AttemptsDaily but override today's values using SQL real-time.
  const today = DateTime.now().toISODate();
  const sqlTodayRows = await Promise.resolve(
    sqlServerService.getAgentsAttempts(today),
  );
  const sqlTodayByPhone = new Map();
  sqlTodayRows.forEach((row) => {
    const phone = normalizePhone(row["PHONE NUMBER"]);
    if (!phone) return;
    sqlTodayByPhone.set(
      phone,
      (sqlTodayByPhone.get(phone) || 0) + Number(row.ATTEMPTS || 0),
    );
  });

  normalizedPhones.forEach((phone) => {
    const todayKey = `${phone}::${today}`;
    if (sqlTodayByPhone.has(phone)) {
      attemptsByPhoneDate.set(todayKey, sqlTodayByPhone.get(phone));
    }
  });

  attemptsByPhoneDate.forEach((attempts, key) => {
    const [phone] = key.split("::");
    attemptsByPhone.set(
      phone,
      (attemptsByPhone.get(phone) || 0) + Number(attempts || 0),
    );
  });

  const records = vendorCases.records
    .map((item) => {
      const normalizedPhone = normalizePhone(item.phone);
      const candidateCases = normalizedPhone
        ? caseNumbersByPhone.get(normalizedPhone) || []
        : [];
      const isAmbiguous = candidateCases.length > 1;

      return {
        vendor: item.vendor,
        caseNumber: item.caseNumber,
        phone: normalizedPhone || item.phone || null,
        segment: item.segment || "N/A",
        createdDate: item.createdDate,
        attempts:
          normalizedPhone && !isAmbiguous
            ? attemptsByPhone.get(normalizedPhone) || 0
            : 0,
        byHour: [],
        matchQuality: isAmbiguous ? "ambiguous_phone" : "daily_phone",
        ambiguousPhone: isAmbiguous,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  const aggregatedExportRows = records.map((item) => ({
    vendor: item.vendor,
    caseNumber: item.caseNumber,
    phone: item.phone,
    attempts: item.attempts,
    segment: item.segment,
    createdDate: item.createdDate,
    scope: vendorCases.scope,
    callDate: null,
    hour: null,
    assignmentType: item.matchQuality,
  }));

  return {
    vendorName: normalizedVendorName,
    scope: vendorCases.scope,
    attemptsScope: attemptsScope.label || attemptsScope.scope,
    totalCases: records.length,
    totalAttempts: records.reduce((sum, row) => sum + (row.attempts || 0), 0),
    detailMode: "daily_aggregate",
    includeAgentDetails,
    agentDetailsAvailable: false,
    ambiguousRows: records.filter((row) => row.ambiguousPhone).length,
    unmatchedRows: 0,
    exportRows: aggregatedExportRows,
    records,
  };
};
