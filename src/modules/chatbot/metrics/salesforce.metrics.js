const logger = require("../../../utils/logger");
const { DateTime } = require("luxon");
const { normalizeDateRange } = require("../../../utils/dateNormalizer");

function buildDateFilter(dateKeyword, date) {
  if (dateKeyword) return `AND CreatedDate = ${dateKeyword.toUpperCase()}`;
  if (date) return `AND CreatedDate = ${date}`;
  return "";
}

function normalizeOriginValue(origin) {
  if (!origin) return origin;

  const normalizedInput = origin.trim().toLowerCase();
  const originAliases = {
    campaign_p: "Campaign_p",
    campaing_p: "Campaign_p",
    campaign_k: "Campaign_k",
    campaing_k: "Campaign_k",
    transfer: "Transfer",
  };

  return originAliases[normalizedInput] || origin;
}

const SOQL_SINGLE_QUOTE_ESCAPE = String.raw`\'`;

function escapeSoqlString(value) {
  return String(value || "").replaceAll("'", SOQL_SINGLE_QUOTE_ESCAPE);
}

function normalizeSupplierSegmentValue(segment) {
  if (!segment) return segment;

  const normalized = String(segment).trim().toLowerCase();
  const aliases = {
    high: "High Quality",
    "high quality": "High Quality",
    highquality: "High Quality",
    "alta calidad": "High Quality",
    medium: "Medium",
    "medium quality": "Medium",
    media: "Medium",
    low: "Low Quality",
    "low quality": "Low Quality",
    baja: "Low Quality",
  };

  return aliases[normalized] || segment;
}

function normalizeTierValue(tier) {
  if (!tier) return tier;

  const raw = String(tier).trim();
  const normalized = raw.toLowerCase().replaceAll(/\s+/g, "");
  const match = /^tier(\d+)$/.exec(normalized);

  if (match?.[1]) return match[1];
  return raw;
}

function normalizeDateKeywordValue(value) {
  if (!value) return null;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "today" || normalized === "hoy") return "TODAY";
  if (normalized === "yesterday" || normalized === "ayer") return "YESTERDAY";

  return null;
}

function addDateConditions(conditions, filters, dateField) {
  if (filters.dateKeyword) {
    conditions.push(`${dateField} = ${filters.dateKeyword.toUpperCase()}`);
    return;
  }

  if (filters.period === "last_month") {
    conditions.push(`${dateField} = LAST_N_DAYS:30`);
    return;
  }

  if (filters.date) {
    const { startUTC, endUTC } = normalizeDateRange(filters.date, filters.date);
    conditions.push(`${dateField} >= ${startUTC} AND ${dateField} < ${endUTC}`);
    return;
  }

  if (filters.startDate && filters.endDate) {
    const { startUTC, endUTC } = normalizeDateRange(
      filters.startDate,
      filters.endDate,
    );
    conditions.push(`${dateField} >= ${startUTC} AND ${dateField} < ${endUTC}`);
    return;
  }

  conditions.push(`${dateField} = TODAY`);
}

function addCaseFilterConditions(conditions, filters, normalizedValues) {
  const { originValue, tierValue } = normalizedValues;

  if (filters.status) conditions.push(`Status = '${filters.status}'`);
  if (originValue) conditions.push(`Origin = '${originValue}'`);
  if (filters.segment) {
    conditions.push(`Supplier_Segment__c = '${filters.segment}'`);
  }
  if (filters.type) {
    const typeVal =
      filters.type.toLowerCase() === "tort" ? "Tort" : filters.type;
    conditions.push(`Type = '${typeVal}'`);
  }
  if (filters.substatus) {
    conditions.push(`Substatus__c = '${filters.substatus}'`);
  }
  if (tierValue) conditions.push(`Tier__c = '${tierValue}'`);
  if (filters.agentName) {
    conditions.push(`Owner.Name LIKE '%${filters.agentName}%'`);
  }
}

function resolveDateFieldForStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return normalized === "sent" ? "Sent_Date2__c" : "CreatedDate";
}

function resolveCalendarTargetDate(dateKeyword, date) {
  const keyword = String(dateKeyword || "")
    .trim()
    .toLowerCase();

  if (keyword === "today" || keyword === "hoy") {
    return DateTime.now().toISODate();
  }

  if (keyword === "yesterday" || keyword === "ayer") {
    return DateTime.now().minus({ days: 1 }).toISODate();
  }

  if (keyword === "tomorrow" || keyword === "manana" || keyword === "mañana") {
    return DateTime.now().plus({ days: 1 }).toISODate();
  }

  if (date) {
    const parsed = DateTime.fromISO(String(date).trim());
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    return parsed.toISODate();
  }

  return DateTime.now().toISODate();
}

function resolveSentRankingDateScope({ dateKeyword, date, period } = {}) {
  const keyword = String(dateKeyword || "")
    .trim()
    .toLowerCase();

  if (keyword === "today" || keyword === "hoy") {
    return {
      clause: "AND Sent_Date2__c = TODAY",
      scope: "today",
      label: "today",
    };
  }

  if (keyword === "yesterday" || keyword === "ayer") {
    return {
      clause: "AND Sent_Date2__c = YESTERDAY",
      scope: "yesterday",
      label: "yesterday",
    };
  }

  if (keyword === "last_week" || period === "last_week") {
    return {
      clause: "AND Sent_Date2__c = LAST_N_DAYS:7",
      scope: "last_week",
      label: "last_week",
    };
  }

  if (date) {
    const parsed = DateTime.fromISO(String(date).trim());
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    const isoDate = parsed.toISODate();
    return {
      clause: `AND Sent_Date2__c = ${isoDate}`,
      scope: isoDate,
      label: isoDate,
    };
  }

  return {
    clause: "AND Sent_Date2__c = TODAY",
    scope: "today",
    label: "today",
  };
}

function resolveFakeLeadRankingDateScope({ dateKeyword, date, period } = {}) {
  const keyword = String(dateKeyword || "")
    .trim()
    .toLowerCase();

  if (keyword === "today" || keyword === "hoy") {
    return {
      clause: "AND CreatedDate = TODAY",
      scope: "today",
      label: "today",
    };
  }

  if (keyword === "yesterday" || keyword === "ayer") {
    return {
      clause: "AND CreatedDate = YESTERDAY",
      scope: "yesterday",
      label: "yesterday",
    };
  }

  if (keyword === "last_week" || period === "last_week") {
    return {
      clause: "AND CreatedDate = LAST_N_DAYS:7",
      scope: "last_week",
      label: "last_week",
    };
  }

  if (date) {
    const parsed = DateTime.fromISO(String(date).trim());
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    const isoDate = parsed.toISODate();
    const { startUTC, endUTC } = normalizeDateRange(isoDate, isoDate);

    return {
      clause: `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`,
      scope: isoDate,
      label: isoDate,
    };
  }

  return {
    clause: "AND CreatedDate = TODAY",
    scope: "today",
    label: "today",
  };
}

function resolveCallbackBacklogDateScope({ dateKeyword, date, period } = {}) {
  const keyword = String(dateKeyword || "")
    .trim()
    .toLowerCase();
  const normalizedPeriod = String(period || "")
    .trim()
    .toLowerCase();

  if (keyword === "today" || keyword === "hoy") {
    return {
      clause: "AND CreatedDate = TODAY",
      scope: "today",
      label: "today",
    };
  }

  if (keyword === "yesterday" || keyword === "ayer") {
    return {
      clause: "AND CreatedDate = YESTERDAY",
      scope: "yesterday",
      label: "yesterday",
    };
  }

  if (
    keyword === "last_week" ||
    normalizedPeriod === "last_week" ||
    normalizedPeriod === "ultima_semana" ||
    normalizedPeriod === "última_semana"
  ) {
    return {
      clause: "AND CreatedDate = LAST_N_DAYS:7",
      scope: "last_week",
      label: "last_week",
    };
  }

  if (
    keyword === "last_7_days" ||
    normalizedPeriod === "last_7_days" ||
    normalizedPeriod === "last7days"
  ) {
    return {
      clause: "AND CreatedDate = LAST_N_DAYS:7",
      scope: "last_7_days",
      label: "last_7_days",
    };
  }

  if (
    keyword === "last_30_days" ||
    normalizedPeriod === "last_30_days" ||
    normalizedPeriod === "last30days"
  ) {
    return {
      clause: "AND CreatedDate = LAST_N_DAYS:30",
      scope: "last_30_days",
      label: "last_30_days",
    };
  }

  if (keyword === "last_month" || normalizedPeriod === "last_month") {
    return {
      clause: "AND CreatedDate = LAST_MONTH",
      scope: "last_month",
      label: "last_month",
    };
  }

  if (date) {
    const parsed = DateTime.fromISO(String(date).trim());
    if (!parsed.isValid) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    const isoDate = parsed.toISODate();
    const { startUTC, endUTC } = normalizeDateRange(isoDate, isoDate);

    return {
      clause: `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`,
      scope: isoDate,
      label: isoDate,
    };
  }

  return {
    clause: "AND CreatedDate = TODAY",
    scope: "today",
    label: "today",
  };
}

function buildVendorDateFilter({
  dateKeyword,
  date,
  startDate,
  endDate,
  period,
}) {
  const normalizedKeyword = normalizeDateKeywordValue(dateKeyword);
  if (normalizedKeyword) {
    return `AND CreatedDate = ${normalizedKeyword}`;
  }

  if (period === "last_month") {
    return "AND CreatedDate = LAST_N_DAYS:30";
  }

  if (date) {
    const { startUTC, endUTC } = normalizeDateRange(date, date);
    return `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  }

  if (startDate && endDate) {
    const { startUTC, endUTC } = normalizeDateRange(startDate, endDate);
    return `AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  }

  return "";
}

function buildOwnerInClause(ownerIds = []) {
  const uniqueIds = [...new Set((ownerIds || []).filter(Boolean))];
  if (!uniqueIds.length) return "";

  const quoted = uniqueIds.map((id) => `'${escapeSoqlString(id)}'`).join(",");
  return `AND OwnerId IN (${quoted})`;
}

function buildIdInClause(ids = []) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return "";

  return uniqueIds.map((id) => `'${escapeSoqlString(id)}'`).join(",");
}

function buildTextInClause(values = []) {
  const uniqueValues = [...new Set((values || []).filter(Boolean))];
  if (!uniqueValues.length) return "";

  return uniqueValues.map((value) => `'${escapeSoqlString(value)}'`).join(",");
}

function getSalesforceErrorDetail(error) {
  const payload = error?.response?.data;
  if (Array.isArray(payload) && payload[0]?.message) {
    return payload[0].message;
  }

  if (typeof payload === "string") return payload;
  if (payload?.message) return payload.message;

  return error?.message || "Unknown Salesforce error";
}

async function getVendorNamesById(sf, ownerIds = []) {
  const idInClause = buildIdInClause(ownerIds);
  if (!idInClause) return new Map();

  const soql = `
    SELECT Id, Name
    FROM User
    WHERE Id IN (${idInClause})
  `;

  const result = await runSoqlQueryFull(sf, soql);
  const map = new Map();

  (result.records || []).forEach((row) => {
    map.set(row.Id, row.Name);
  });

  return map;
}

async function getPrimarySegmentByVendor(sf, filters = {}, ownerIds = []) {
  const dateFilter = buildVendorDateFilter(filters);
  const ownerFilter = buildOwnerInClause(ownerIds);

  const soql = `
    SELECT OwnerId, Supplier_Segment__c
    FROM Case
    WHERE OwnerId != null
    AND Supplier_Segment__c != null
    ${dateFilter}
    ${ownerFilter}
    ORDER BY CreatedDate DESC
  `;

  const result = await runSoqlQueryFull(sf, soql);
  const countsByOwner = new Map();

  (result.records || []).forEach((row) => {
    const ownerId = row.OwnerId;
    const segment = row.Supplier_Segment__c;
    if (!ownerId || !segment) return;

    if (!countsByOwner.has(ownerId)) {
      countsByOwner.set(ownerId, new Map());
    }

    const segmentMap = countsByOwner.get(ownerId);
    segmentMap.set(segment, (segmentMap.get(segment) || 0) + 1);
  });

  const primarySegmentByOwner = new Map();
  countsByOwner.forEach((segmentMap, ownerId) => {
    let bestSegment = "N/A";
    let bestCount = -1;

    segmentMap.forEach((count, segment) => {
      if (count > bestCount) {
        bestCount = count;
        bestSegment = segment;
      }
    });

    primarySegmentByOwner.set(ownerId, bestSegment);
  });

  return primarySegmentByOwner;
}

const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");

const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");

/**
 * Get Case by date keyword (TODAY / YESTERDAY)
 */
exports.getCaseByDate = async (dateKeyword) => {
  try {
    logger.info(`Fetching cases for: ${dateKeyword}`);

    const sf = await authenticateSalesforce();

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
        WHERE CreatedDate = ${dateKeyword}
        ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch (error) {
    logger.error(`Salesforce Case error: ${error.message}`);
    throw new Error("SF_CASE_QUERY_FAILED");
  }
};

exports.getCaseByNumber = async (caseNumber) => {
  try {
    logger.info(`Fetching case: ${caseNumber}`);

    const sf = await authenticateSalesforce();

    const soql = `
   SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        ClosedDate,
        LastModifiedDate
        FROM Case
      WHERE CaseNumber = '${caseNumber}'
      LIMIT 1
    `;

    const result = await runSoqlQueryFull(sf, soql);

    if (!result.records?.length) {
      logger.warn(`Case not found: ${caseNumber}`);
      return null;
    }

    logger.success(`Case ${caseNumber} retrieved`);

    return result.records[0];
  } catch (error) {
    logger.error(`Salesforce case query error: ${error.message}`);
    throw new Error("SF_CASE_QUERY_FAILED");
  }
};

exports.getCasesByStatus = async (status, dateKeyword = null, date = null) => {
  try {
    logger.info(`Fetching cases with status: ${status}`);

    const sf = await authenticateSalesforce();
    const dateField = resolveDateFieldForStatus(status);
    const dateFilter = buildDateFilter(dateKeyword, date).replaceAll(
      "CreatedDate",
      dateField,
    );

    const soql = `
   SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        Sent_Date2__c,
        LastModifiedDate
        FROM Case
      WHERE Status = '${status}'
      ${dateFilter}
      ORDER BY ${dateField} DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    logger.success(`Cases retrieved: ${result.records.length}`);

    return result.records;
  } catch (error) {
    logger.error(`Salesforce status query error: ${error.message}`);
    throw new Error("SF_STATUS_QUERY_FAILED");
  }
};

exports.getCasesByDateRange = async (startDate, endDate) => {
  try {
    const sf = await authenticateSalesforce();
    const { startUTC, endUTC } = normalizeDateRange(startDate, endDate);

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
        ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_CASE_RANGE_FAILED");
  }
};

exports.getCaseByPhone = async (phone) => {
  try {
    const cleanPhone = phone.replace(/\D/g, "");

    const sf = await authenticateSalesforce();

    const soql = `
        SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE Phone_Numbercontact__c LIKE '%${cleanPhone}'
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch {
    throw new Error("SF_PHONE_QUERY_FAILED");
  }
};

exports.getCaseByEmail = async (email) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT   
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        LastModifiedDate
        FROM Case
      WHERE Email__c LIKE '%${email}%'
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return result.records;
  } catch {
    throw new Error("SF_EMAIL_QUERY_FAILED");
  }
};

exports.getCasesByOrigin = async (origin, dateKeyword = null, date = null) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);
    const originValue = normalizeOriginValue(origin);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Origin = '${originValue}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_ORIGIN_QUERY_FAILED");
  }
};

exports.getCasesBySupplierSegment = async (
  segment,
  dateKeyword = null,
  date = null,
) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Supplier_Segment__c = '${segment}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_SEGMENT_QUERY_FAILED");
  }
};

exports.getCasesBySubstatus = async (
  substatus,
  dateKeyword = null,
  date = null,
) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);
    const includeDisqualificationReasons =
      String(substatus || "").toLowerCase() === "disqualified";
    const disqualificationFields = includeDisqualificationReasons
      ? `Reason_for_DQ__c,
        Reason_for_Doesn_t_meet_criteria__c,
        `
      : "";

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        ${disqualificationFields}
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Substatus__c = '${substatus}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_SUBSTATUS_QUERY_FAILED");
  }
};

exports.getCasesStillInCallback = async ({
  dateKeyword = null,
  date = null,
  period = null,
} = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateScope = resolveCallbackBacklogDateScope({
      dateKeyword,
      date,
      period,
    });

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Reason_for_Callback__c,
        BPO_Intaker__c,
        Intaker__r.Name,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Substatus__c = 'Callback'
      ${dateScope.clause}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const records = (result.records || []).map((item) => ({
      ...item,
      BPO_Intaker__c: item.BPO_Intaker__c || item.Intaker__r?.Name || null,
    }));

    return {
      scope: dateScope.scope,
      scopeLabel: dateScope.label,
      total: records.length,
      caseNumbers: records.map((item) => item.CaseNumber).filter(Boolean),
      records,
    };
  } catch (error) {
    logger.error(
      `getCasesStillInCallback failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_CALLBACK_BACKLOG_FAILED");
  }
};

exports.getScheduledCallbacks = async ({
  dateKeyword = null,
  date = null,
} = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const targetDate = resolveCalendarTargetDate(dateKeyword, date);

    // Build the UTC range using the local timezone (America/Lima = UTC-5)
    // so that midnight-to-midnight aligns with the agents' working day,
    // not with UTC midnight (which would bleed into the previous/next day).
    const LOCAL_TZ = "America/Lima";
    const dayStart = DateTime.fromISO(targetDate, { zone: LOCAL_TZ }).startOf(
      "day",
    );
    const dayEnd = dayStart.plus({ days: 1 });
    const startUTC = dayStart.toUTC().toISO();
    const endUTC = dayEnd.toUTC().toISO();

    const soql = `
      SELECT
        Id,
        StartDateTime,
        EndDateTime,
        Owner.Name,
        Subject,
        WhatId
      FROM Event
      WHERE StartDateTime >= ${startUTC}
      AND StartDateTime < ${endUTC}
      AND (
        Subject LIKE '%allback%'
        OR Subject LIKE '%Call to FU%'
      )
      ORDER BY StartDateTime ASC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const events = result.records || [];

    // Resolve CaseNumber for events linked to a Case (WhatId starts with '500')
    const caseIds = [
      ...new Set(
        events
          .map((e) => e.WhatId)
          .filter((id) => id && String(id).startsWith("500")),
      ),
    ];

    const caseNumberById = new Map();
    if (caseIds.length) {
      const idClause = buildIdInClause(caseIds);
      const casesSoql = `
        SELECT Id, CaseNumber
        FROM Case
        WHERE Id IN (${idClause})
        AND Substatus__c = 'Callback'
      `;
      const casesResult = await runSoqlQueryFull(sf, casesSoql);
      (casesResult.records || []).forEach((c) => {
        caseNumberById.set(c.Id, { caseNumber: c.CaseNumber });
      });
    }

    // Only keep events whose linked case currently has Substatus = Callback
    const records = events
      .filter((e) => e.WhatId && caseNumberById.has(e.WhatId))
      .map((e) => ({
        ...e,
        caseInfo: caseNumberById.get(e.WhatId),
      }));

    return {
      date: targetDate,
      total: records.length,
      records,
    };
  } catch (error) {
    logger.error(
      `Salesforce scheduled callbacks query error: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_CALLBACKS_QUERY_FAILED");
  }
};

exports.getSentCasesByAgentRanking = async ({
  sort = "highest",
  dateKeyword = null,
  date = null,
  period = null,
  limit = 10,
} = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateScope = resolveSentRankingDateScope({
      dateKeyword,
      date,
      period,
    });

    const sortMode = String(sort || "highest").toLowerCase();
    const sortDirection = sortMode === "lowest" ? "ASC" : "DESC";
    const safeLimit =
      Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;

    const soql = `
      SELECT BPO_Intaker__c, COUNT(Id) totalSent
      FROM Case
      WHERE Status = 'Sent'
      AND BPO_Intaker__c != null
      ${dateScope.clause}
      GROUP BY BPO_Intaker__c
      ORDER BY COUNT(Id) ${sortDirection}
      LIMIT ${safeLimit}
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      agentName: String(row.BPO_Intaker__c || "").trim(),
      totalSent: Number(row.totalSent || 0),
    }));

    const agentFilter = buildTextInClause(
      baseRecords.map((item) => item.agentName),
    );

    const casesByAgent = new Map();
    if (agentFilter) {
      const casesSoql = `
        SELECT CaseNumber, BPO_Intaker__c, CreatedDate
        FROM Case
        WHERE Status = 'Sent'
        AND BPO_Intaker__c IN (${agentFilter})
        ${dateScope.clause}
        ORDER BY CreatedDate DESC
      `;

      const casesResult = await runSoqlQueryFull(sf, casesSoql);
      (casesResult.records || []).forEach((row) => {
        const agentName = String(row.BPO_Intaker__c || "").trim();
        if (!agentName || casesByAgent.has(agentName)) return;

        casesByAgent.set(agentName, row.CaseNumber || null);
      });
    }

    const records = baseRecords.map((item) => ({
      ...item,
      agentName: item.agentName || "Unknown",
      caseNumber: casesByAgent.get(item.agentName) || null,
    }));

    return {
      sort: sortMode,
      limit: safeLimit,
      scope: dateScope.scope,
      scopeLabel: dateScope.label,
      totalAgents: records.length,
      totalSent: records.reduce((sum, item) => sum + item.totalSent, 0),
      records,
    };
  } catch (error) {
    logger.error(
      `getSentCasesByAgentRanking failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_SENT_AGENT_RANKING_FAILED");
  }
};

exports.getFakeLeadDQByVendorRanking = async ({
  dateKeyword = null,
  date = null,
  period = null,
  limit = 10,
} = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateScope = resolveFakeLeadRankingDateScope({
      dateKeyword,
      date,
      period,
    });

    const safeLimit =
      Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;

    const soql = `
      SELECT OwnerId, Owner.Name, COUNT(Id) totalFakeLead
      FROM Case
      WHERE Substatus__c = 'Disqualified'
      AND Reason_for_DQ__c = 'Fake Lead'
      AND OwnerId != null
      ${dateScope.clause}
      GROUP BY OwnerId, Owner.Name
      ORDER BY COUNT(Id) DESC
      LIMIT ${safeLimit}
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      vendorName: row.Owner?.Name || "",
      totalFakeLead: Number(row.totalFakeLead || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const normalizedRecords = baseRecords.map((item) => ({
      ...item,
      vendorName:
        item.vendorName || vendorNamesById.get(item.vendorId) || "Unknown",
    }));

    const ownerFilter = buildOwnerInClause(
      normalizedRecords.map((item) => item.vendorId),
    );

    const casesByVendorId = new Map();
    if (ownerFilter) {
      const detailSoql = `
        SELECT CaseNumber, OwnerId, CreatedDate
        FROM Case
        WHERE Substatus__c = 'Disqualified'
        AND Reason_for_DQ__c = 'Fake Lead'
        ${dateScope.clause}
        ${ownerFilter}
        ORDER BY CreatedDate DESC
      `;

      const detailResult = await runSoqlQueryFull(sf, detailSoql);
      (detailResult.records || []).forEach((row) => {
        const ownerId = row.OwnerId;
        if (!ownerId) return;

        if (!casesByVendorId.has(ownerId)) {
          casesByVendorId.set(ownerId, []);
        }

        const list = casesByVendorId.get(ownerId);
        if (list.length < 3 && row.CaseNumber) {
          list.push(row.CaseNumber);
        }
      });
    }

    const records = normalizedRecords.map((item) => ({
      ...item,
      caseNumbers: casesByVendorId.get(item.vendorId) || [],
    }));

    return {
      limit: safeLimit,
      scope: dateScope.scope,
      scopeLabel: dateScope.label,
      totalVendors: records.length,
      totalFakeLead: records.reduce((sum, item) => sum + item.totalFakeLead, 0),
      records,
    };
  } catch (error) {
    logger.error(
      `getFakeLeadDQByVendorRanking failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_FAKE_LEAD_DQ_RANKING_FAILED");
  }
};

exports.getCasesByType = async (type, dateKeyword = null, date = null) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildDateFilter(dateKeyword, date);

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Type,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE Type = '${type}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_TYPE_QUERY_FAILED");
  }
};

const FIELD_MAP = {
  status: "Status",
  origin: "Origin",
  type: "Type",
  "supplier segment": "Supplier_Segment__c",
  supplier_segment__c: "Supplier_Segment__c",
  segment: "Supplier_Segment__c",
  substatus: "Substatus__c",
  substatus__c: "Substatus__c",
};

const GROUPED_FIELD_LABELS = {
  Status: "Status",
  Origin: "Origin",
  Type: "Type",
  Supplier_Segment__c: "Supplier Segment",
  Substatus__c: "Substatus",
};

exports.getCasesGroupedByField = async (field, dateKeyword = null) => {
  try {
    const sf = await authenticateSalesforce();

    const normalizedField = FIELD_MAP[field.toLowerCase()] || field;
    const ALLOWED_FIELDS = [
      "Status",
      "Origin",
      "Type",
      "Supplier_Segment__c",
      "Substatus__c",
    ];
    if (!ALLOWED_FIELDS.includes(normalizedField)) {
      throw new Error("SF_INVALID_GROUP_FIELD");
    }

    let dateFilter = "";
    if (dateKeyword) {
      dateFilter = `AND CreatedDate = ${dateKeyword.toUpperCase()}`;
    }

    const soql = `
      SELECT ${normalizedField}, COUNT(Id) cnt
      FROM Case
      WHERE ${normalizedField} != null
      ${dateFilter}
      GROUP BY ${normalizedField}
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    const groups = {};
    let total = 0;
    result.records.forEach((r) => {
      const val = r[normalizedField] || "N/A";
      groups[val] = r.cnt;
      total += r.cnt;
    });

    return {
      field: normalizedField,
      fieldLabel: GROUPED_FIELD_LABELS[normalizedField] || normalizedField,
      groups,
      total,
      dateScope: dateKeyword || "all",
    };
  } catch {
    throw new Error("SF_GROUP_QUERY_FAILED");
  }
};

exports.getCasesByFilters = async (filters) => {
  try {
    const sf = await authenticateSalesforce();

    const conditions = [];
    const dateField = resolveDateFieldForStatus(filters.status);
    const originValue = normalizeOriginValue(filters.origin);
    const tierValue = normalizeTierValue(filters.tier);
    const includeDisqualificationReasons =
      String(filters.substatus || "").toLowerCase() === "disqualified";
    const disqualificationFields = includeDisqualificationReasons
      ? `Reason_for_DQ__c,
        Reason_for_Doesn_t_meet_criteria__c,
        `
      : "";

    addCaseFilterConditions(conditions, filters, { originValue, tierValue });
    addDateConditions(conditions, filters, dateField);

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        ${disqualificationFields}
        Type,
        Tier__c,
        Origin,
        Supplier_Segment__c,
        Email__c,
        Phone_Numbercontact__c,
        Owner.Name,
        FullName__c,
        CreatedDate,
        Sent_Date2__c
      FROM Case
      ${whereClause}
      ORDER BY ${dateField} DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);

    return {
      total: result.totalSize,
      records: result.records,
    };
  } catch {
    throw new Error("SF_DYNAMIC_FILTER_FAILED");
  }
};

exports.getOperationalSummary = async (dateKeyword) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT
        Id,
        CaseNumber,
        Status,
        Substatus__c,
        Origin,
        Supplier_Segment__c,
        Owner.Name
      FROM Case
      WHERE CreatedDate = ${dateKeyword}
      LIMIT 100
    `;

    const result = await runSoqlQueryFull(sf, soql);

    const records = result.records;

    const summary = {
      total: records.length,
      byStatus: {},
      byOrigin: {},
      bySegment: {},
    };

    records.forEach((c) => {
      summary.byStatus[c.Status] = (summary.byStatus[c.Status] || 0) + 1;

      summary.byOrigin[c.Origin] = (summary.byOrigin[c.Origin] || 0) + 1;

      summary.bySegment[c.Supplier_Segment__c] =
        (summary.bySegment[c.Supplier_Segment__c] || 0) + 1;
    });

    return {
      summary,
      sampleCases: records.slice(0, 10),
    };
  } catch {
    throw new Error("SF_SUMMARY_FAILED");
  }
};

exports.getVendorsWithLeads = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const segmentByVendor = await getPrimarySegmentByVendor(
      sf,
      filters,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
      segment: segmentByVendor.get(item.vendorId) || "N/A",
    }));

    return {
      totalVendors: records.length,
      totalLeads: records.reduce((acc, item) => acc + item.totalLeads, 0),
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(
      `getVendorsWithLeads failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_VENDOR_QUERY_FAILED");
  }
};

exports.getTopVendors = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const sortMode = String(filters.sort || "highest").toLowerCase();
    const sortDirection = sortMode === "lowest" ? "ASC" : "DESC";
    const limit =
      Number.isInteger(filters.limit) && filters.limit > 0
        ? Math.min(filters.limit, 50)
        : 10;

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) ${sortDirection}
      LIMIT ${limit}
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const segmentByVendor = await getPrimarySegmentByVendor(
      sf,
      filters,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
      segment: segmentByVendor.get(item.vendorId) || "N/A",
    }));

    return {
      limit,
      sort: sortMode,
      totalVendors: records.length,
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(`getTopVendors failed: ${getSalesforceErrorDetail(error)}`);
    throw new Error("SF_TOP_VENDOR_QUERY_FAILED");
  }
};

exports.getVendorsBySupplierSegment = async (segment, filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const normalizedSegment = normalizeSupplierSegmentValue(segment);
    const escapedSegment = escapeSoqlString(normalizedSegment);

    const soql = `
      SELECT OwnerId, COUNT(Id) totalLeads
      FROM Case
      WHERE OwnerId != null
      AND Supplier_Segment__c = '${escapedSegment}'
      ${dateFilter}
      GROUP BY OwnerId
      ORDER BY COUNT(Id) DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const baseRecords = (result.records || []).map((row) => ({
      vendorId: row.OwnerId,
      segment: normalizedSegment,
      totalLeads: Number(row.totalLeads || 0),
    }));

    const vendorNamesById = await getVendorNamesById(
      sf,
      baseRecords.map((item) => item.vendorId),
    );

    const records = baseRecords.map((item) => ({
      ...item,
      vendor: vendorNamesById.get(item.vendorId) || item.vendorId || "Unknown",
    }));

    return {
      segment: normalizedSegment,
      totalVendors: records.length,
      totalLeads: records.reduce((acc, item) => acc + item.totalLeads, 0),
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(
      `getVendorsBySupplierSegment failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_VENDOR_SEGMENT_QUERY_FAILED");
  }
};

exports.getVendorCases = async (vendorName, filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const dateFilter = buildVendorDateFilter(filters);
    const escapedVendorName = escapeSoqlString(String(vendorName || "").trim());

    const exactSoql = `
      SELECT
        Id,
        CaseNumber,
        Phone_Numbercontact__c,
        Supplier_Segment__c,
        OwnerId,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE OwnerId != null
      AND Owner.Name = '${escapedVendorName}'
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    let result = await runSoqlQueryFull(sf, exactSoql);

    if (!result.records?.length) {
      const fallbackSoql = `
        SELECT
          Id,
          CaseNumber,
          Phone_Numbercontact__c,
          Supplier_Segment__c,
          OwnerId,
          Owner.Name,
          CreatedDate
        FROM Case
        WHERE OwnerId != null
        AND Owner.Name LIKE '%${escapedVendorName}%'
        ${dateFilter}
        ORDER BY CreatedDate DESC
      `;

      result = await runSoqlQueryFull(sf, fallbackSoql);
    }

    const records = (result.records || []).map((row) => ({
      caseId: row.Id,
      caseNumber: row.CaseNumber,
      phone: row.Phone_Numbercontact__c,
      segment: row.Supplier_Segment__c || "N/A",
      vendorId: row.OwnerId,
      vendor: row.Owner?.Name || "Unknown",
      createdDate: row.CreatedDate,
    }));

    return {
      vendorName,
      totalCases: records.length,
      scope:
        filters.dateKeyword ||
        filters.period ||
        (filters.startDate && filters.endDate
          ? `${filters.startDate}..${filters.endDate}`
          : filters.date || "all"),
      records,
    };
  } catch (error) {
    logger.error(`getVendorCases failed: ${getSalesforceErrorDetail(error)}`);
    throw new Error("SF_VENDOR_CASES_QUERY_FAILED");
  }
};

exports.getTopVendorsWithCaseDetails = async (filters = {}) => {
  try {
    const sf = await authenticateSalesforce();
    const ranking = await exports.getTopVendors(filters);

    if (!ranking?.records?.length) {
      return {
        ...ranking,
        totalCaseRows: 0,
        records: [],
      };
    }

    const ownerIds = ranking.records
      .map((item) => item.vendorId)
      .filter(Boolean);
    const ownerFilter = buildOwnerInClause(ownerIds);
    const dateFilter = buildVendorDateFilter(filters);

    const soql = `
      SELECT
        CaseNumber,
        Phone_Numbercontact__c,
        Supplier_Segment__c,
        OwnerId,
        Owner.Name,
        CreatedDate
      FROM Case
      WHERE OwnerId != null
      ${ownerFilter}
      ${dateFilter}
      ORDER BY CreatedDate DESC
    `;

    const result = await runSoqlQueryFull(sf, soql);
    const casesByVendorId = new Map();

    (result.records || []).forEach((row) => {
      const ownerId = row.OwnerId;
      if (!ownerId) return;

      if (!casesByVendorId.has(ownerId)) {
        casesByVendorId.set(ownerId, []);
      }

      casesByVendorId.get(ownerId).push({
        caseNumber: row.CaseNumber,
        phone: row.Phone_Numbercontact__c,
        segment: row.Supplier_Segment__c || "N/A",
        vendor: row.Owner?.Name || "Unknown",
        createdDate: row.CreatedDate,
      });
    });

    const enrichedRecords = ranking.records.map((vendorRow) => {
      const vendorCases = casesByVendorId.get(vendorRow.vendorId) || [];
      return {
        ...vendorRow,
        totalCases: vendorCases.length,
        cases: vendorCases,
      };
    });

    return {
      ...ranking,
      totalCaseRows: enrichedRecords.reduce(
        (sum, item) => sum + (item.totalCases || 0),
        0,
      ),
      records: enrichedRecords,
    };
  } catch (error) {
    logger.error(
      `getTopVendorsWithCaseDetails failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_TOP_VENDOR_CASE_DETAILS_FAILED");
  }
};

// Returns the disqualification reason fields for a case by CaseNumber.
// Assumes substatus Disqualified; no date restriction.
exports.getCaseDisqualificationReason = async (caseNumber) => {
  try {
    const sf = await authenticateSalesforce();

    const soql = `
      SELECT Id, CaseNumber, Status, Substatus__c,
             Reason_for_DQ__c, Reason_for_Doesn_t_meet_criteria__c,
             BPO__c, BPO_Intaker__c,
             Owner.Name, CreatedDate
      FROM Case
      WHERE CaseNumber = '${caseNumber}'
      LIMIT 1
    `;

    const result = await runSoqlQueryFull(sf, soql);

    if (!result.records || result.records.length === 0) {
      return { found: false, caseNumber };
    }

    const rec = result.records[0];
    return {
      found: true,
      caseNumber: rec.CaseNumber,
      status: rec.Status,
      substatus: rec.Substatus__c,
      owner: rec.Owner?.Name || null,
      bpo: rec.BPO__c || null,
      bpoIntaker: rec.BPO_Intaker__c || null,
      createdDate: rec.CreatedDate,
      reasonForDQ: rec.Reason_for_DQ__c || null,
      reasonDoesntMeetCriteria: rec.Reason_for_Doesn_t_meet_criteria__c || null,
    };
  } catch (error) {
    logger.error(
      `getCaseDisqualificationReason failed: ${getSalesforceErrorDetail(error)}`,
    );
    throw new Error("SF_DQ_REASON_FAILED");
  }
};
