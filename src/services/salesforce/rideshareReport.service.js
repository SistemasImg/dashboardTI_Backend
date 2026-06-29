const logger = require("../../utils/logger");
const { verifyAccessToken } = require("../../utils/verifyAccessToken");
const { DateTime } = require("luxon");
const { Op } = require("sequelize");
const {
  AttemptsAnalysisSnapshot,
  AttemptsAnalysisSyncRun,
  CallCenter,
  User,
} = require("../../models");
const {
  updateActiveAssignmentAttempts,
} = require("../../services/caseAssignments.service");
const {
  getVicidialLeadFirstAgentLogAttempt,
  getVicidialLeadDetailAttempts,
  searchVicidialLeadByPhone,
} = require("../../services/vicidial/vicidialLeadSearch.service");

const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const {
  runSoqlQuery,
  runSoqlQueryAll,
} = require("../../services/salesforce/client.service");

const {
  buildMonitoringCasesQuery,
  buildDailyInflowCasesQuery,
  buildDailyOutflowCasesQuery,
  buildLeadOpportunityCaseNumbersQuery,
} = require("../../services/salesforce/queries/case.query");
const {
  buildUsersQuery,
} = require("../../services/salesforce/queries/user.query");

const {
  mapMonitoringCase,
  mapOperationalFlowCase,
} = require("../../services/salesforce/mappers/case.mapper");
const {
  mapUsersName,
} = require("../../services/salesforce/mappers/users.mapper");

const {
  getAttemptsLastNDays,
  getTotalAttempts,
} = require("../../services/attemptsDaily.service");

const {
  ActiveAssignmentsDaily,
} = require("../../services/caseAssignments.service");

const DEFAULT_CASE_OWNER = "Marketing Digital";
const SALESFORCE_DISPLAY_TIMEZONE =
  process.env.SALESFORCE_TIMEZONE || "America/Los_Angeles";
const LEAD_OPPORTUNITY_CASE_NUMBER_BATCH_SIZE = 100;
const ATTEMPTS_ANALYSIS_CONCURRENCY = Math.min(
  4,
  Math.max(1, Number(process.env.ATTEMPTS_ANALYSIS_CONCURRENCY) || 2),
);
const ATTEMPTS_ANALYSIS_VICIDIAL_TIMEOUT_MS =
  Number(process.env.ATTEMPTS_ANALYSIS_VICIDIAL_TIMEOUT_MS) || 10000;
let attemptsAnalysisTableReadyPromise;
const AGENTS_WITH_CALL_CENTER_ID_2 = new Set([
  "lzavala",
  "agarcia",
  "jcabello",
]);
const AGENTS_WITH_CALL_CENTER_ID_1 = new Set(["dparedes", "vdcl"]);

function extractVicidialDateTimeTextCandidates(value) {
  const text = String(value || "");
  const matches = [];
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\b/g,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapm]{2})?\b/g,
  ];

  patterns.forEach((pattern) => {
    let match = pattern.exec(text);

    while (match) {
      matches.push(match[0]);
      match = pattern.exec(text);
    }
  });

  return [...new Set(matches)];
}

async function ensureAttemptsAnalysisTables() {
  if (!attemptsAnalysisTableReadyPromise) {
    attemptsAnalysisTableReadyPromise = Promise.all([
      AttemptsAnalysisSnapshot.sync(),
      AttemptsAnalysisSyncRun.sync(),
    ]);
  }

  return attemptsAnalysisTableReadyPromise;
}

function listDateKeysInRange(startDate, endDate) {
  const start = DateTime.fromISO(startDate, { zone: "America/Lima" });
  const end = DateTime.fromISO(endDate, { zone: "America/Lima" });
  const dates = [];
  let cursor = start.startOf("day");

  while (cursor <= end.endOf("day")) {
    dates.push(cursor.toISODate());
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}

function normalizeVicidialAgentName(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function formatAttemptsAnalysisDateTime(value) {
  if (!value) return null;

  const parsed = DateTime.fromISO(String(value), { setZone: true });
  return parsed.isValid
    ? parsed
        .setZone(SALESFORCE_DISPLAY_TIMEZONE)
        .toFormat("dd/MM/yyyy HH:mm:ss")
    : value;
}

function parseAttemptsAnalysisCreatedDate(value) {
  if (!value) return null;

  const parsed = DateTime.fromISO(String(value), { setZone: true });
  return parsed.isValid ? parsed.setZone(SALESFORCE_DISPLAY_TIMEZONE) : null;
}

function parseVicidialCallDateTime(value) {
  if (!value) return null;

  const parsedIso = DateTime.fromISO(String(value), {
    zone: SALESFORCE_DISPLAY_TIMEZONE,
  });
  if (parsedIso.isValid) return parsedIso;

  const parsedSql = DateTime.fromFormat(String(value), "yyyy-MM-dd HH:mm:ss", {
    zone: SALESFORCE_DISPLAY_TIMEZONE,
  });
  if (parsedSql.isValid) return parsedSql;

  return null;
}

function filterCallsAfterCaseCreatedDate(calls, createdDate) {
  const parsedCreatedDate = parseAttemptsAnalysisCreatedDate(createdDate);

  if (!parsedCreatedDate) return calls;

  return calls.filter((call) => {
    const parsedCallDate = parseVicidialCallDateTime(call?.dateTime);
    return !parsedCallDate || parsedCallDate >= parsedCreatedDate;
  });
}

function extractVicidialAgentName(record) {
  const columns = Array.isArray(record?.columns) ? record.columns : [];
  const prefixedAgent = columns.find((column) =>
    /^[A-Za-z]{2,5}_[A-Za-z0-9]+$/.test(String(column || "").trim()),
  );

  if (prefixedAgent) {
    return normalizeVicidialAgentName(prefixedAgent);
  }

  const specialAgent = columns.find((column) =>
    AGENTS_WITH_CALL_CENTER_ID_2.has(
      String(column || "")
        .trim()
        .toLowerCase(),
    ),
  );

  if (specialAgent) {
    return normalizeVicidialAgentName(specialAgent);
  }

  const defaultMappedAgent = columns.find((column) =>
    AGENTS_WITH_CALL_CENTER_ID_1.has(
      String(column || "")
        .trim()
        .toLowerCase(),
    ),
  );

  if (defaultMappedAgent) {
    return normalizeVicidialAgentName(defaultMappedAgent);
  }

  return null;
}

function isUsableVicidialAgentName(agentName) {
  const normalized = String(agentName || "").trim();
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return false;

  const lowerAgent = normalized.toLowerCase();
  const prefix = normalized.includes("_")
    ? normalized.split("_")[0].toUpperCase()
    : null;

  return (
    AGENTS_WITH_CALL_CENTER_ID_2.has(lowerAgent) ||
    AGENTS_WITH_CALL_CENTER_ID_1.has(lowerAgent) ||
    prefix === "ABC" ||
    prefix === "CZX" ||
    prefix === "VDM"
  );
}

function resolveVicidialAgentCallCenterId(agentName) {
  const normalized = String(agentName || "").trim();
  if (!isUsableVicidialAgentName(normalized)) return null;

  const lowerAgent = normalized.toLowerCase();
  const prefix = normalized.includes("_")
    ? normalized.split("_")[0].toUpperCase()
    : null;

  if (AGENTS_WITH_CALL_CENTER_ID_2.has(lowerAgent)) return 2;
  if (AGENTS_WITH_CALL_CENTER_ID_1.has(lowerAgent)) return 1;
  if (prefix === "ABC") return 3;
  if (prefix === "CZX") return 4;
  if (prefix === "VDM") return 5;
  return null;
}

function mapVicidialAttemptToCall(attempt, callCentersById, fallback = {}) {
  if (!attempt?.dateTime) return null;

  const agentName = isUsableVicidialAgentName(attempt?.agentName)
    ? attempt.agentName
    : fallback.agentName || null;
  const callCenterId = resolveVicidialAgentCallCenterId(agentName);
  if (!agentName || !callCenterId) return null;

  const callCenter = callCentersById.get(callCenterId) || null;

  return {
    dateTime: attempt.dateTime,
    agentName,
    callCenterId,
    callCenterName: callCenter?.name || null,
    vicidialLeadId: attempt.leadId || fallback.leadId || null,
  };
}

async function resolveDetailAgentForLeadCall(record, dateTime) {
  if (!record?.leadId || !dateTime) return null;

  try {
    const attempts = await getVicidialLeadDetailAttempts(record.leadId, {
      timeoutMs: ATTEMPTS_ANALYSIS_VICIDIAL_TIMEOUT_MS,
    });
    const matchedAttempt =
      attempts.find(
        (attempt) =>
          String(attempt.leadId) === String(record.leadId) &&
          String(attempt.dateTime).slice(0, 16) ===
            String(dateTime).slice(0, 16),
      ) ||
      attempts.find(
        (attempt) => String(attempt.leadId) === String(record.leadId),
      );

    return isUsableVicidialAgentName(matchedAttempt?.agentName)
      ? matchedAttempt.agentName
      : null;
  } catch (error) {
    logger.warn(
      `RideshareReportService → unable to resolve Vicidial detail agent for lead ${record.leadId}: ${error.message}`,
    );
    return null;
  }
}

async function mapVicidialSearchRecordsToCalls(records, callCentersById) {
  const callsByRecord = await Promise.all(
    (records || []).map(async (record) => {
      const values = [
        ...(Array.isArray(record?.columns) ? record.columns : []),
        record?.rowText,
      ];
      const rowDateTimeCandidates = [
        ...new Set(
          values.flatMap((value) =>
            extractVicidialDateTimeTextCandidates(value),
          ),
        ),
      ];
      const rowDateTime =
        (record?.hasLastCallColumn
          ? normalizeVicidialAgentName(record?.lastCall)
          : rowDateTimeCandidates[0]) || null;
      const rowAgentName =
        (record?.hasLastAgentColumn
          ? normalizeVicidialAgentName(record?.lastAgent)
          : extractVicidialAgentName(record)) || null;
      const needsDetailFallback =
        (!rowDateTime || !isUsableVicidialAgentName(rowAgentName)) &&
        record?.leadId;
      const detailFallback = needsDetailFallback
        ? await getVicidialLeadFirstAgentLogAttempt(record.leadId, {
            timeoutMs: ATTEMPTS_ANALYSIS_VICIDIAL_TIMEOUT_MS,
          })
        : null;
      const dateTime = rowDateTime || detailFallback?.dateTime || null;
      const agentName = isUsableVicidialAgentName(rowAgentName)
        ? rowAgentName
        : detailFallback?.agentName || null;

      return mapVicidialAttemptToCall(
        {
          dateTime,
          agentName,
          leadId: record?.leadId || null,
        },
        callCentersById,
        {
          leadId: record?.leadId || null,
        },
      );
    }),
  );

  return callsByRecord
    .flat()
    .flat()
    .filter(Boolean)
    .sort((left, right) => String(left.dateTime).localeCompare(right.dateTime));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function buildUsersMap(userRecords) {
  return new Map(
    userRecords
      .map(mapUsersName)
      .filter(Boolean)
      .map((user) => [user.id, user.name]),
  );
}

function normalizeDailyFlowParams({ date, startDate, endDate, type }) {
  const normalizedDate = String(date || "").trim();
  const normalizedStartDate = String(startDate || "").trim();
  const normalizedEndDate = String(endDate || "").trim();
  const normalizedType = String(type || "").trim();
  const resolvedStartDate =
    normalizedStartDate ||
    normalizedDate ||
    normalizedEndDate ||
    getPeruDateKey(0);
  const resolvedEndDate =
    normalizedEndDate ||
    normalizedDate ||
    normalizedStartDate ||
    getPeruDateKey(0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedStartDate)) {
    throw Object.assign(
      new Error("startDate/date must use YYYY-MM-DD format"),
      {
        statusCode: 400,
      },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedEndDate)) {
    throw Object.assign(new Error("endDate/date must use YYYY-MM-DD format"), {
      statusCode: 400,
    });
  }

  if (resolvedEndDate < resolvedStartDate) {
    throw Object.assign(
      new Error("endDate must be greater than or equal to startDate"),
      {
        statusCode: 400,
      },
    );
  }

  return {
    date: resolvedStartDate === resolvedEndDate ? resolvedStartDate : null,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    type: normalizedType || null,
  };
}

function toAttemptsAnalysisSnapshotRow(item, syncedAt) {
  const parsedCreatedDate =
    DateTime.fromFormat(item.createdDate || "", "dd/MM/yyyy HH:mm:ss", {
      zone: SALESFORCE_DISPLAY_TIMEZONE,
    }) || DateTime.invalid("missing createdDate");
  const fallbackCreatedDate = DateTime.fromISO(String(item.createdDate || ""), {
    setZone: true,
  }).setZone(SALESFORCE_DISPLAY_TIMEZONE);
  const caseCreatedDate = parsedCreatedDate.isValid
    ? parsedCreatedDate.toISODate()
    : fallbackCreatedDate.toISODate();

  return {
    case_number: item.caseNumber,
    case_id: item.caseId,
    case_created_date: caseCreatedDate,
    created_date: item.createdDate,
    sent_date: item.sentDate,
    owner_id: item.ownerId,
    owner_name: item.ownerName,
    origin: item.origin,
    full_name: item.fullName,
    phone_number: item.phoneNumber,
    email: item.email,
    status: item.status,
    substatus: item.substatus,
    case_type: item.type,
    tier: item.tier,
    supplier_segment: item.supplierSegment,
    reason_for_callback: item.reasonForCallback,
    phone: item.phone,
    total_calls: item.totalCalls,
    calls: item.calls || [],
    vicidial_lookup_status: item.vicidialLookup?.status || "unknown",
    vicidial_lookup_error: item.vicidialLookup?.error || null,
    synced_at: syncedAt.toJSDate(),
    updated_at: syncedAt.toJSDate(),
    created_at: syncedAt.toJSDate(),
  };
}

function mapAttemptsAnalysisSnapshotRow(row) {
  return {
    caseNumber: row.case_number,
    caseId: row.case_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    origin: row.origin,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    email: row.email,
    status: row.status,
    substatus: row.substatus,
    type: row.case_type,
    tier: row.tier,
    supplierSegment: row.supplier_segment,
    reasonForCallback: row.reason_for_callback,
    createdDate: row.created_date,
    sentDate: row.sent_date,
    phone: row.phone,
    totalCalls: Number(row.total_calls) || 0,
    calls: Array.isArray(row.calls) ? row.calls : [],
    vicidialLookup: {
      status: row.vicidial_lookup_status,
      error: row.vicidial_lookup_error,
    },
    syncedAt: row.synced_at,
  };
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function getLeadOpportunityCaseNumberSet(sf, caseRecords, caseType) {
  const caseNumbers = caseRecords
    .map((record) => record.CaseNumber)
    .filter(Boolean);

  if (!caseNumbers.length) {
    return new Set();
  }

  const chunks = chunkItems(
    caseNumbers,
    LEAD_OPPORTUNITY_CASE_NUMBER_BATCH_SIZE,
  );
  const results = await Promise.all(
    chunks.map((chunk) =>
      runSoqlQueryAll(
        sf,
        buildLeadOpportunityCaseNumbersQuery(chunk, caseType),
      ),
    ),
  );

  return new Set(
    results
      .flat()
      .map((record) => record.Lead__r?.CaseNumber)
      .filter(Boolean),
  );
}

async function getDailyOperationalFlow({ date, type, flowType }) {
  const params = normalizeDailyFlowParams(arguments[0] || {});
  const isInflow = flowType === "inflow";

  logger.info(
    `RideshareReportService → getDailyOperationalFlow() | flowType=${flowType} startDate=${params.startDate} endDate=${params.endDate} type=${params.type || "all"}`,
  );

  const sf = await authenticateSalesforce();
  const query = isInflow
    ? buildDailyInflowCasesQuery(params.startDate, params.endDate, params.type)
    : buildDailyOutflowCasesQuery(
        params.startDate,
        params.endDate,
        params.type,
      );

  const [caseRecords, userRecords] = await Promise.all([
    runSoqlQueryAll(sf, query),
    runSoqlQuery(sf, buildUsersQuery()),
  ]);

  let eligibleCaseRecords = caseRecords;
  let excludedWithoutLeadOpportunityRecords = [];
  let leadOpportunityValidation = null;

  if (!isInflow) {
    const leadOpportunityCaseNumbers = await getLeadOpportunityCaseNumberSet(
      sf,
      caseRecords,
      params.type,
    );

    eligibleCaseRecords = caseRecords.filter((record) =>
      leadOpportunityCaseNumbers.has(record.CaseNumber),
    );
    excludedWithoutLeadOpportunityRecords = caseRecords.filter(
      (record) => !leadOpportunityCaseNumbers.has(record.CaseNumber),
    );

    leadOpportunityValidation = {
      required: true,
      source: "Lead_de_oportunidad__c",
      matched: eligibleCaseRecords.length,
      excludedWithoutLeadOpportunity:
        excludedWithoutLeadOpportunityRecords.length,
    };
  }

  const usersMap = buildUsersMap(userRecords);
  const data = eligibleCaseRecords.map((record) =>
    mapOperationalFlowCase(
      record,
      usersMap.get(record.OwnerId) ?? DEFAULT_CASE_OWNER,
    ),
  );
  const excludedWithoutLeadOpportunityCases =
    excludedWithoutLeadOpportunityRecords.map((record) => {
      const mapped = mapOperationalFlowCase(
        record,
        usersMap.get(record.OwnerId) ?? DEFAULT_CASE_OWNER,
      );

      return {
        caseId: mapped.caseId,
        caseNumber: mapped.caseNumber,
        fullName: mapped.fullName,
        phoneNumber: mapped.phoneNumber,
        type: mapped.type,
        tier: mapped.tier,
        ownerName: mapped.ownerName,
        origin: mapped.origin,
        substatus: mapped.substatus,
        createdDate: mapped.createdDate,
        sentDate: mapped.sentDate,
      };
    });

  logger.success(
    `RideshareReportService → getDailyOperationalFlow() success | flowType=${flowType} total=${data.length}`,
  );

  return {
    total: data.length,
    flowType,
    date: params.date,
    startDate: params.startDate,
    endDate: params.endDate,
    type: params.type || "all",
    basedOn: isInflow
      ? {
          rule:
            params.startDate === params.endDate
              ? "Case created during the selected Salesforce day"
              : "Case created during the selected Salesforce date range",
          dateField: "CreatedDate",
          filters: [
            params.startDate === params.endDate
              ? "CreatedDate inside selected day"
              : "CreatedDate inside selected date range",
            params.type ? "Type equals requested type" : "All case types",
          ],
        }
      : {
          rule:
            params.startDate === params.endDate
              ? "Case sent during the selected Salesforce day"
              : "Case sent during the selected Salesforce date range",
          dateField: "Sent_Date2__c",
          filters: [
            params.startDate === params.endDate
              ? "Sent_Date2__c inside selected day"
              : "Sent_Date2__c inside selected date range",
            params.type ? "Type equals requested type" : "All case types",
            "CaseNumber exists in Lead_de_oportunidad__c with Lead__r.Substatus__c = Signed",
          ],
        },
    leadOpportunityValidation,
    excludedWithoutLeadOpportunityCases,
    data,
  };
}

async function getDailyInflowReport(params) {
  return getDailyOperationalFlow({ ...params, flowType: "inflow" });
}

async function getDailyOutflowReport(params) {
  return getDailyOperationalFlow({ ...params, flowType: "outflow" });
}

function buildAttemptsAnalysisMetadata() {
  return {
    salesforceDateField: "CreatedDate",
    vicidialMatch: "phone_number",
    callCenterRules: {
      ABC: 3,
      CZX: 4,
      VDM: 5,
      lzavala: 2,
      agarcia: 2,
      jcabello: 2,
      dparedes: 1,
      default: 1,
    },
  };
}

async function buildAttemptsAnalysisLiveData(normalizedParams) {
  const sf = await authenticateSalesforce();
  const query = buildDailyInflowCasesQuery(
    normalizedParams.startDate,
    normalizedParams.endDate,
  );

  const [caseRecords, userRecords, callCenters] = await Promise.all([
    runSoqlQueryAll(sf, query),
    runSoqlQuery(sf, buildUsersQuery()),
    CallCenter.findAll({ raw: true }),
  ]);
  const usersMap = buildUsersMap(userRecords);
  const callCentersById = new Map(
    callCenters.map((callCenter) => [Number(callCenter.id), callCenter]),
  );
  const mappedCases = caseRecords.map((record) =>
    mapOperationalFlowCase(
      record,
      usersMap.get(record.OwnerId) ?? DEFAULT_CASE_OWNER,
    ),
  );

  const data = await mapWithConcurrency(
    mappedCases,
    ATTEMPTS_ANALYSIS_CONCURRENCY,
    async (item) => {
      const phone = normalizeSFPhone(item.phoneNumber);

      if (!phone) {
        return {
          ...item,
          createdDate: formatAttemptsAnalysisDateTime(item.createdDate),
          phone,
          totalCalls: 0,
          calls: [],
          vicidialLookup: {
            status: "invalid_phone",
            error: null,
          },
        };
      }

      try {
        const vicidialResult = await searchVicidialLeadByPhone(phone, {
          enrichRecords: false,
          keepRecordsWithoutDate: true,
          resolveRecordingLocations: false,
          timeoutMs: ATTEMPTS_ANALYSIS_VICIDIAL_TIMEOUT_MS,
        });
        const calls = await mapVicidialSearchRecordsToCalls(
          vicidialResult.records,
          callCentersById,
        );
        const filteredCalls = filterCallsAfterCaseCreatedDate(
          calls,
          item.createdDate,
        );

        return {
          ...item,
          createdDate: formatAttemptsAnalysisDateTime(item.createdDate),
          phone,
          totalCalls: filteredCalls.length,
          calls: filteredCalls,
          vicidialLookup: {
            status: "ok",
            error: null,
          },
        };
      } catch (error) {
        logger.warn(
          `RideshareReportService → Vicidial attempts lookup failed for case ${item.caseNumber}: ${error.message}`,
        );

        return {
          ...item,
          createdDate: formatAttemptsAnalysisDateTime(item.createdDate),
          phone,
          totalCalls: 0,
          calls: [],
          vicidialLookup: {
            status: "failed",
            error: error.message,
          },
        };
      }
    },
  );

  logger.success(
    `RideshareReportService → buildAttemptsAnalysisLiveData() success | total=${data.length}`,
  );

  return {
    total: data.length,
    startDate: normalizedParams.startDate,
    endDate: normalizedParams.endDate,
    date: normalizedParams.date,
    basedOn: buildAttemptsAnalysisMetadata(),
    data,
  };
}

async function syncAttemptsAnalysisReport(params = {}) {
  await ensureAttemptsAnalysisTables();

  const normalizedParams = normalizeDailyFlowParams({
    date: params.date,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  logger.info(
    `RideshareReportService → syncAttemptsAnalysisReport() | startDate=${normalizedParams.startDate} endDate=${normalizedParams.endDate}`,
  );

  const result = await buildAttemptsAnalysisLiveData(normalizedParams);
  const syncedAt = DateTime.now().setZone("America/Lima");
  const snapshotRows = result.data.map((item) =>
    toAttemptsAnalysisSnapshotRow(item, syncedAt),
  );

  if (snapshotRows.length) {
    await AttemptsAnalysisSnapshot.bulkCreate(snapshotRows, {
      updateOnDuplicate: [
        "case_id",
        "case_created_date",
        "created_date",
        "sent_date",
        "owner_id",
        "owner_name",
        "origin",
        "full_name",
        "phone_number",
        "email",
        "status",
        "substatus",
        "case_type",
        "tier",
        "supplier_segment",
        "reason_for_callback",
        "phone",
        "total_calls",
        "calls",
        "vicidial_lookup_status",
        "vicidial_lookup_error",
        "synced_at",
        "updated_at",
      ],
    });
  }

  const dates = listDateKeysInRange(
    normalizedParams.startDate,
    normalizedParams.endDate,
  );
  const countsByDate = snapshotRows.reduce((accumulator, row) => {
    accumulator.set(
      row.case_created_date,
      (accumulator.get(row.case_created_date) || 0) + 1,
    );
    return accumulator;
  }, new Map());
  const syncRows = dates.map((date) => ({
    sync_date: date,
    start_date: normalizedParams.startDate,
    end_date: normalizedParams.endDate,
    fetched_cases: countsByDate.get(date) || 0,
    synced_at: syncedAt.toJSDate(),
    created_at: syncedAt.toJSDate(),
    updated_at: syncedAt.toJSDate(),
  }));

  await AttemptsAnalysisSyncRun.bulkCreate(syncRows, {
    updateOnDuplicate: [
      "start_date",
      "end_date",
      "fetched_cases",
      "synced_at",
      "updated_at",
    ],
  });

  logger.success(
    `RideshareReportService → syncAttemptsAnalysisReport() success | synced=${snapshotRows.length}`,
  );

  return {
    ...result,
    source: "live_sync",
    syncedAt: syncedAt.toISO(),
  };
}

async function getAttemptsAnalysisReport(params = {}) {
  await ensureAttemptsAnalysisTables();

  const normalizedParams = normalizeDailyFlowParams({
    date: params.date,
    startDate: params.startDate,
    endDate: params.endDate,
  });
  const requestedDates = listDateKeysInRange(
    normalizedParams.startDate,
    normalizedParams.endDate,
  );
  const syncRuns = await AttemptsAnalysisSyncRun.findAll({
    where: {
      sync_date: {
        [Op.in]: requestedDates,
      },
    },
    raw: true,
  });
  const syncedDates = new Set(syncRuns.map((row) => row.sync_date));
  const missingDates = requestedDates.filter((date) => !syncedDates.has(date));

  if (missingDates.length) {
    logger.info(
      `RideshareReportService → attempts analysis cache miss | dates=${missingDates.join(",")}`,
    );

    await syncAttemptsAnalysisReport({
      startDate: missingDates[0],
      endDate: missingDates.at(-1),
    });
  }

  const rows = await AttemptsAnalysisSnapshot.findAll({
    where: {
      case_created_date: {
        [Op.gte]: normalizedParams.startDate,
        [Op.lte]: normalizedParams.endDate,
      },
    },
    raw: true,
    order: [["created_date", "DESC"]],
  });
  const data = rows.map(mapAttemptsAnalysisSnapshotRow);
  const latestSyncedAt = rows.reduce((latest, row) => {
    if (!row.synced_at) return latest;
    if (!latest) return row.synced_at;
    return new Date(row.synced_at) > new Date(latest) ? row.synced_at : latest;
  }, null);

  return {
    total: data.length,
    startDate: normalizedParams.startDate,
    endDate: normalizedParams.endDate,
    date: normalizedParams.date,
    source: missingDates.length ? "cache_with_auto_sync" : "cache",
    cache: {
      requestedDays: requestedDates.length,
      missingDates,
      latestSyncedAt,
    },
    basedOn: buildAttemptsAnalysisMetadata(),
    data,
  };
}

function normalizeSFPhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

function getPeruDateKey(daysAgo = 0) {
  return DateTime.now()
    .setZone("America/Lima")
    .minus({ days: daysAgo })
    .toFormat("yyyy-LL-dd");
}

async function getRideshareReport(token) {
  try {
    let decoded = null;
    let userId = null;
    if (token) {
      decoded = verifyAccessToken(token);
      userId = decoded.id;
    }

    // 1️⃣ Auth Salesforce
    const sf = await authenticateSalesforce();

    const [monitoringRecords, usersRecords] = await Promise.all([
      runSoqlQuery(sf, buildMonitoringCasesQuery()),
      runSoqlQuery(sf, buildUsersQuery()),
    ]);

    // SQL Queries in Parallel
    const [attemptsByDate, attemptsTotal, activeAssignments] =
      await Promise.all([
        getAttemptsLastNDays(3),
        getTotalAttempts(),
        ActiveAssignmentsDaily(),
      ]);

    // 2️⃣ Table Case
    const allCases = monitoringRecords.map(mapMonitoringCase);

    // 3️⃣ Users → Supplier
    const usersData = usersRecords.map(mapUsersName);

    // 4️⃣ Agent Assignments
    const assignmentMap = new Map();
    activeAssignments.forEach(({ case_number, agent }) => {
      assignmentMap.set(case_number, {
        fullname: agent.fullname,
        call_center: agent.callCenter.name,
      });
    });

    // 5️⃣ Merge Cases with Users
    const usersMap = new Map(usersData.map((user) => [user.id, user.name]));

    const casesWithSupplier = allCases.map((item) => {
      const phone = normalizeSFPhone(item.phoneNumber);
      return {
        ...item,
        phone,
        ownerName: usersMap.get(item.ownerId) ?? null,
      };
    });

    // 6️⃣ Attempts Data Mapping
    const today = getPeruDateKey(0);
    const yesterday = getPeruDateKey(1);
    const twoDaysAgo = getPeruDateKey(2);
    const todayMap = new Map();
    const yesterdayMap = new Map();
    const twoDaysAgoMap = new Map();

    attemptsByDate.forEach(({ phone, call_date, attempts }) => {
      if (call_date === today) todayMap.set(phone, attempts);
      else if (call_date === yesterday) yesterdayMap.set(phone, attempts);
      else if (call_date === twoDaysAgo) twoDaysAgoMap.set(phone, attempts);
    });

    const totalMap = new Map(
      attemptsTotal.map((r) => [r.phone, Number(r.totalAttempts)]),
    );

    // 7️⃣ Final Data Assembly
    let finalCases = casesWithSupplier.map((item) => {
      const phone = normalizeSFPhone(item.phoneNumber);

      return {
        ...item,
        ownerName: item?.ownerName || "Marketing Digital",
        substatus: item?.substatus || "Pending",
        date1: today,
        attempts1: todayMap.get(phone) ?? 0,

        date2: yesterday,
        attempts2: yesterdayMap.get(phone) ?? 0,

        date3: twoDaysAgo,
        attempts3: twoDaysAgoMap.get(phone) ?? 0,

        totalAttempts: totalMap.get(phone) ?? 0,

        assignedAgent: assignmentMap.get(item.caseNumber) ?? null,
      };
    });

    // 🔥 Update assignment attempts

    logger.info(`Updating attempts`);
    const updates = finalCases
      .filter((item) => item.assignedAgent !== null)
      .map((item) => {
        return updateActiveAssignmentAttempts({
          case_number: item.caseNumber,
          attempts: item.attempts1,
        });
      });
    await Promise.allSettled(updates);

    //Intake User Role Filtering
    if (token) {
      if (decoded.role_id === 4 || decoded.role_id === 5) {
        const { dataValues } = await User.findByPk(userId);
        if (!dataValues) throw new Error("user not found");
        const agent = await User.findOne({
          where: { id: dataValues.id },
        });
        if (agent) {
          finalCases = finalCases.filter(
            (item) =>
              item.assignedAgent &&
              item.assignedAgent.fullname === agent.dataValues.fullname,
          );
        } else {
          finalCases = [];
        }
      }
    }

    // 7️⃣ Return final response
    return {
      total: finalCases.length,
      data: finalCases,
    };
  } catch (error) {
    logger.error("RideshareReportService → getRideshareReport() failed", {
      message: error.message,
      stack: error.stack,
      origin: "service",
    });

    throw error;
  }
}

module.exports = {
  getRideshareReport,
  getDailyInflowReport,
  getDailyOutflowReport,
  getAttemptsAnalysisReport,
  syncAttemptsAnalysisReport,
};
