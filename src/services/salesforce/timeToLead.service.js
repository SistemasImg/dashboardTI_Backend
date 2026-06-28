const { DateTime } = require("luxon");
const { DataTypes, Op } = require("sequelize");
const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("./auth.service");
const { runSoqlQueryAll } = require("./client.service");
const {
  buildCaseSubstatusHistoryQuery,
  buildTimeToLeadCasesQuery,
} = require("./queries/timeToLead.query");
const { normalizePhone } = require("./phoneLookup.service");
const { TimeToLeadSnapshot, TimeToLeadSyncRun } = require("../../models");
const {
  searchVicidialLeadByPhone,
} = require("../vicidial/vicidialLeadSearch.service");
const {
  canUseVicidialOutboundLog,
  searchVicidialOutboundCallsByPhone,
} = require("../vicidial/vicidialOutboundLog.service");
const {
  buildVicidialOutboundIndexFromUserStats,
} = require("../vicidial/vicidialUserStats.service");

const LIMA_TIMEZONE = "America/Lima";
const DEFAULT_BUSINESS_START_HOUR = 9;
const DEFAULT_BUSINESS_END_HOUR = 20;
const TIME_RANGE_LABELS = [
  "[0,5)",
  "[5,10)",
  "[10,15)",
  "[15,20)",
  "[20,25)",
  "[25,30)",
  "[30,35)",
  "[35,40)",
  "[40,45)",
  "[45,50)",
  "[50,55)",
  "[55,60)",
  "[60,+)",
];
const SLA_THRESHOLDS_MINUTES = [5, 10, 15];
const LOOKUP_CONCURRENCY = Math.min(
  3,
  Math.max(1, Number(process.env.TIME_TO_LEAD_LOOKUP_CONCURRENCY) || 2),
);
const DEFAULT_METRICS_REFRESH_LIMIT = 3;
const MAX_METRICS_REFRESH_LIMIT = 5;
const VICIDIAL_LOOKUP_TIMEOUT_MS = 8000;
const DEFAULT_RETRYABLE_MATCH_STATUSES = ["pending_lookup"];
const LIVE_RETRYABLE_MATCH_STATUSES = [
  "pending_lookup",
  "no_first_call_found",
  "lookup_timeout",
  "lookup_failed",
];
const TCPA_BLOCKING_SUBSTATUSES = new Set(["Redo TCPA", "No TCPA"]);
const EXCLUDED_TCPA_HISTORY_MATCH_STATUS = "excluded_tcpa_history";
const CASE_HISTORY_CHUNK_SIZE = 150;

let snapshotTableReadyPromise;

async function ensureTimeToLeadSnapshotTable() {
  if (!snapshotTableReadyPromise) {
    snapshotTableReadyPromise = Promise.all([
      TimeToLeadSnapshot.sync().then(ensureTimeToLeadSnapshotColumns),
      TimeToLeadSyncRun.sync(),
    ]);
  }

  return snapshotTableReadyPromise;
}

async function ensureTimeToLeadSnapshotColumns() {
  const queryInterface = TimeToLeadSnapshot.sequelize.getQueryInterface();
  const tableDefinition = await queryInterface.describeTable(
    "time_to_lead_snapshots",
  );

  if (!tableDefinition.original_case_created_at) {
    await queryInterface.addColumn(
      "time_to_lead_snapshots",
      "original_case_created_at",
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
    );
  }

  if (!tableDefinition.ttl_start_source) {
    await queryInterface.addColumn(
      "time_to_lead_snapshots",
      "ttl_start_source",
      {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "case_created",
      },
    );
  }

  if (!tableDefinition.ttl_start_substatus) {
    await queryInterface.addColumn(
      "time_to_lead_snapshots",
      "ttl_start_substatus",
      {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
    );
  }
}

function buildDateWindow(startDate, endDate) {
  const nowInLima = DateTime.now().setZone(LIMA_TIMEZONE);
  const start = startDate
    ? DateTime.fromISO(startDate, { zone: LIMA_TIMEZONE }).startOf("day")
    : nowInLima.startOf("day");
  const end = endDate
    ? DateTime.fromISO(endDate, { zone: LIMA_TIMEZONE }).endOf("day")
    : start.endOf("day");

  if (!start.isValid || !end.isValid) {
    const error = new Error("Invalid date range. Use YYYY-MM-DD format.");
    error.status = 400;
    throw error;
  }

  if (end < start) {
    const error = new Error(
      "Invalid date range. endDate must be >= startDate.",
    );
    error.status = 400;
    throw error;
  }

  return {
    start,
    end,
    nowInLima,
    endExclusive: end.plus({ milliseconds: 1 }).startOf("day"),
  };
}

function listDateKeysInWindow(window) {
  const dates = [];
  let cursor = window.start.startOf("day");
  const end = window.end.startOf("day");

  while (cursor <= end) {
    dates.push(cursor.toISODate());
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}

function sanitizeText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function computeWeekLabel(dateTime) {
  if (!dateTime?.isValid) return null;

  const jan1 = DateTime.fromObject(
    { year: dateTime.year, month: 1, day: 1 },
    { zone: LIMA_TIMEZONE },
  );
  const week1Monday = jan1.minus({ days: jan1.weekday - 1 });
  const diffDays = Math.floor(
    dateTime.startOf("day").diff(week1Monday.startOf("day"), "days").days,
  );

  return `Week ${Math.floor(diffDays / 7) + 1}`;
}

function computeResponseDelay(firstContact, dateReceived) {
  if (!firstContact || !dateReceived) return null;

  const diffMillis = firstContact.toMillis() - dateReceived.toMillis();
  if (diffMillis < 0) {
    return null;
  }

  const totalSeconds = Math.floor(diffMillis / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    "0",
  );
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function responseDelayToMinutes(responseDelay) {
  if (!responseDelay) return null;

  const [hours, minutes, seconds] = responseDelay.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function computeRangeTime(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return null;
  if (minutes >= 60) return TIME_RANGE_LABELS.at(-1);

  const bucketIndex = Math.min(
    Math.floor(minutes / 5),
    TIME_RANGE_LABELS.length - 2,
  );
  return TIME_RANGE_LABELS[bucketIndex];
}

function formatDurationFromMinutes(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return null;

  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${hours}:${mins}:${seconds}`;
}

function roundMetric(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(2));
}

function buildMetricValue(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return {
      minutes: null,
      duration: null,
    };
  }

  return {
    minutes: roundMetric(minutes),
    duration: formatDurationFromMinutes(minutes),
  };
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];

  if (lowerIndex === upperIndex) return lowerValue;

  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex);
}

function buildLatencyStats(values) {
  if (!values.length) {
    return {
      count: 0,
      average: buildMetricValue(null),
      median: buildMetricValue(null),
      min: buildMetricValue(null),
      max: buildMetricValue(null),
      p75: buildMetricValue(null),
      p90: buildMetricValue(null),
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    average: buildMetricValue(total / sorted.length),
    median: buildMetricValue(computePercentile(sorted, 0.5)),
    min: buildMetricValue(sorted[0]),
    max: buildMetricValue(sorted.at(-1)),
    p75: buildMetricValue(computePercentile(sorted, 0.75)),
    p90: buildMetricValue(computePercentile(sorted, 0.9)),
  };
}

function buildSlaSummary(values) {
  const total = values.length;

  return SLA_THRESHOLDS_MINUTES.reduce((accumulator, threshold, index) => {
    const previousThreshold =
      index === 0 ? 0 : SLA_THRESHOLDS_MINUTES[index - 1];
    const met = values.filter((value) => {
      if (index === 0) {
        return value < threshold;
      }

      return value >= previousThreshold && value < threshold;
    }).length;
    const breached = total - met;

    accumulator[`under${threshold}Minutes`] = {
      label:
        index === 0
          ? `less_than_${threshold}_minutes`
          : `${previousThreshold}_to_${threshold - 1}_minutes`,
      minMinutesInclusive: index === 0 ? 0 : previousThreshold,
      thresholdMinutes: threshold,
      maxMinutesExclusive: threshold,
      met,
      breached,
      rate: total ? roundMetric((met / total) * 100) : 0,
    };

    return accumulator;
  }, {});
}

function countBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function chunkArray(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeHistoryValue(value) {
  return sanitizeText(value);
}

function isTcpaBlockingSubstatus(value) {
  const normalized = normalizeHistoryValue(value);
  return normalized ? TCPA_BLOCKING_SUBSTATUSES.has(normalized) : false;
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex;
      currentIndex += 1;
      results[itemIndex] = await iteratee(items[itemIndex], itemIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function buildBreakdown({
  completedItems,
  pendingItems,
  keySelector,
  keyName,
}) {
  const completedGroups = new Map();
  const pendingCounts = countBy(pendingItems, keySelector);

  completedItems.forEach((item) => {
    const key = keySelector(item);
    if (!completedGroups.has(key)) {
      completedGroups.set(key, []);
    }
    completedGroups.get(key).push(item);
  });

  const allKeys = new Set([
    ...completedGroups.keys(),
    ...Object.keys(pendingCounts),
  ]);

  return [...allKeys]
    .map((key) => {
      const groupItems = completedGroups.get(key) || [];
      const responseDelayMinutes = groupItems
        .map((item) => item.responseDelayMinutes)
        .filter((value) => value !== null && !Number.isNaN(value));
      const stats = buildLatencyStats(responseDelayMinutes);
      const totalCompleted = groupItems.length;
      const pendingWithoutFirstContact = pendingCounts[key] || 0;
      const within15Minutes = responseDelayMinutes.filter(
        (value) => value <= 15,
      ).length;

      return {
        [keyName]: key,
        totalCompleted,
        pendingWithoutFirstContact,
        totalCases: totalCompleted + pendingWithoutFirstContact,
        averageResponseDelay: stats.average,
        medianResponseDelay: stats.median,
        sla15Rate: totalCompleted
          ? roundMetric((within15Minutes / totalCompleted) * 100)
          : null,
      };
    })
    .sort((left, right) => right.totalCases - left.totalCases);
}

function parseVicidialDateTime(value) {
  if (!value) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const candidates = [
    DateTime.fromFormat(normalized, "yyyy-LL-dd HH:mm:ss", {
      zone: LIMA_TIMEZONE,
    }),
    DateTime.fromFormat(normalized, "yyyy-LL-dd HH:mm", {
      zone: LIMA_TIMEZONE,
    }),
    DateTime.fromFormat(normalized, "LL/dd/yyyy hh:mm:ss a", {
      zone: LIMA_TIMEZONE,
    }),
    DateTime.fromFormat(normalized, "LL/dd/yyyy hh:mm a", {
      zone: LIMA_TIMEZONE,
    }),
    DateTime.fromISO(normalized, { zone: LIMA_TIMEZONE }),
  ];

  return candidates.find((item) => item.isValid) || null;
}

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

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = sanitizeText(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function collectSearchRowDateCandidates(record, fallbackAgentName) {
  const values = [
    ...(Array.isArray(record?.columns) ? record.columns : []),
    record?.rowText,
  ];
  const dateTimeTextCandidates = values.flatMap((value) => {
    const directCandidate = parseVicidialDateTime(value);

    return directCandidate?.isValid
      ? [String(value)]
      : extractVicidialDateTimeTextCandidates(value);
  });

  return [...new Set(dateTimeTextCandidates)]
    .map((value) => parseVicidialDateTime(value))
    .filter((dateTime) => dateTime?.isValid)
    .map((dateTime) => ({
      dateTime,
      agentName: fallbackAgentName,
      source: "vicidial_lead_search",
    }));
}

function collectVicidialCandidateContacts(records) {
  return (records || []).flatMap((record) => {
    const candidates = [];
    const fallbackAgentName = pickFirstNonEmpty(record?.columns?.[3]);

    if (Array.isArray(record.recordings)) {
      record.recordings.forEach((recording) => {
        const parsed = parseVicidialDateTime(recording?.dateTime);
        if (parsed) {
          candidates.push({
            dateTime: parsed,
            agentName: pickFirstNonEmpty(
              recording?.agent,
              recording?.tsr,
              fallbackAgentName,
            ),
            source: "vicidial_lead_search",
          });
        }
      });
    }

    if (Array.isArray(record.leadCallDates)) {
      record.leadCallDates.forEach((value) => {
        const parsed = parseVicidialDateTime(value);
        if (parsed?.isValid) {
          candidates.push({
            dateTime: parsed,
            agentName: fallbackAgentName,
            source: "vicidial_lead_search",
          });
        }
      });
    }

    candidates.push(
      ...collectSearchRowDateCandidates(record, fallbackAgentName),
    );

    return candidates;
  });
}

function getEarliestValidContact(candidateContacts, caseCreatedAt) {
  return candidateContacts
    .filter((item) => item.dateTime?.toMillis() >= caseCreatedAt.toMillis())
    .sort(
      (left, right) => left.dateTime.toMillis() - right.dateTime.toMillis(),
    )[0];
}

function mapSalesforceCase(record) {
  const dateReceived = record.CreatedDate
    ? DateTime.fromISO(record.CreatedDate, { zone: "utc" }).setZone(
        LIMA_TIMEZONE,
      )
    : null;

  return {
    caseId: sanitizeText(record.Id),
    caseNumber: sanitizeText(record.CaseNumber),
    fullName: sanitizeText(record.FullName__c),
    phoneNumber: normalizePhone(record.Phone_Numbercontact__c),
    email: sanitizeText(record.Email__c),
    status: sanitizeText(record.Status),
    substatus: sanitizeText(record.Substatus__c, "Pending"),
    reasonForDQ: sanitizeText(record.Reason_for_DQ__c, ""),
    reasonForDoesntMeetCriteria: sanitizeText(
      record.Reason_for_Doesn_t_meet_criteria__c,
      "",
    ),
    reasonForSpam: sanitizeText(record.Reason_for_Spam__c, ""),
    dateSent: record.Sent_Date2__c
      ? DateTime.fromISO(record.Sent_Date2__c, { zone: "utc" })
          .setZone(LIMA_TIMEZONE)
          .toISODate()
      : null,
    ethnicity: sanitizeText(record.ethnicity__c, "Unknown"),
    origin: sanitizeText(record.Origin),
    type: sanitizeText(record.Type),
    reasonForRejection: sanitizeText(record.Reason_for_Rejection__c),
    ownerId: sanitizeText(record.OwnerId),
    ownerName: sanitizeText(record.Owner?.Name),
    dateReceived,
    originalDateReceived: dateReceived,
    timeToLeadStartSource: "case_created",
    timeToLeadStartSubstatus: null,
  };
}

function getTcpaHistoryByCaseId(historyRecords = []) {
  return historyRecords.reduce((accumulator, record) => {
    const caseId = sanitizeText(record.CaseId);
    if (!caseId || accumulator.has(caseId)) return accumulator;

    const oldSubstatus = normalizeHistoryValue(record.OldValue);
    const newSubstatus = normalizeHistoryValue(record.NewValue);

    if (
      isTcpaBlockingSubstatus(oldSubstatus) ||
      isTcpaBlockingSubstatus(newSubstatus)
    ) {
      const detectedAt = record.CreatedDate
        ? DateTime.fromISO(record.CreatedDate, { zone: "utc" }).setZone(
            LIMA_TIMEZONE,
          )
        : null;

      if (detectedAt?.isValid) {
        accumulator.set(caseId, {
          detectedAt,
          substatus: isTcpaBlockingSubstatus(oldSubstatus)
            ? oldSubstatus
            : newSubstatus,
        });
      }
    }

    return accumulator;
  }, new Map());
}

async function fetchTcpaHistoryByCaseId(sf, caseIds = []) {
  const uniqueCaseIds = [...new Set(caseIds.filter(Boolean))];
  if (!uniqueCaseIds.length) return new Map();

  const records = [];

  for (const chunk of chunkArray(uniqueCaseIds, CASE_HISTORY_CHUNK_SIZE)) {
    const soql = buildCaseSubstatusHistoryQuery(chunk);
    if (!soql) continue;

    try {
      const chunkRecords = await runSoqlQueryAll(sf, soql);
      records.push(...chunkRecords);
    } catch (error) {
      logger.warn("TimeToLeadService -> CaseHistory lookup skipped", {
        message: error.message,
        caseIds: chunk.length,
      });
      return new Map();
    }
  }

  return getTcpaHistoryByCaseId(records);
}

function applyTimeToLeadExclusionFromHistory(item, tcpaHistoryByCaseId) {
  const history = item.caseId ? tcpaHistoryByCaseId.get(item.caseId) : null;
  const currentBlockingSubstatus = isTcpaBlockingSubstatus(item.substatus)
    ? item.substatus
    : null;

  if (!history && !currentBlockingSubstatus) {
    return item;
  }

  return {
    ...item,
    excludedFromTimeToLead: true,
    timeToLeadStartSource: EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
    timeToLeadStartSubstatus: history?.substatus || currentBlockingSubstatus,
  };
}

function buildInitialMatchSource({ hasValidPhone, isExcludedByTcpaHistory }) {
  if (isExcludedByTcpaHistory) return null;
  return hasValidPhone ? "vicidial" : null;
}

function buildInitialMatchStatus({ hasValidPhone, isExcludedByTcpaHistory }) {
  if (isExcludedByTcpaHistory) return EXCLUDED_TCPA_HISTORY_MATCH_STATUS;
  return hasValidPhone ? "pending_lookup" : "invalid_phone";
}

function clearReasonsByStatus(item) {
  const shouldClearReasons =
    item.status === "In progress" ||
    item.status === "Sent" ||
    item.substatus === "Reject" ||
    item.substatus === "Accepted";

  if (!shouldClearReasons) {
    return item;
  }

  return {
    ...item,
    reasonForDQ: "",
    reasonForDoesntMeetCriteria: "",
  };
}

async function fetchFirstContactForCase({
  caseCreatedAt,
  phoneNumber,
  userStatsIndex,
}) {
  const normalizedPhone = normalizePhone(phoneNumber);

  if (!normalizedPhone || !caseCreatedAt?.isValid) {
    return {
      firstContact: null,
      timedOut: false,
      failed: false,
    };
  }

  try {
    const allCandidates = [];
    let lookupTimedOut = false;
    let lookupFailed = false;
    let lookupErrorMessage = null;

    try {
      const outboundLogResult = await searchVicidialOutboundCallsByPhone({
        phoneNumber: normalizedPhone,
        startAt: caseCreatedAt,
        endAt: DateTime.now().setZone(LIMA_TIMEZONE),
        limit: 5,
      });

      allCandidates.push(...(outboundLogResult.records || []));
    } catch (error) {
      logger.warn("TimeToLeadService -> Vicidial outbound log lookup skipped", {
        message: error.message,
        phoneNumber: normalizedPhone,
      });
    }

    if (userStatsIndex?.size) {
      allCandidates.push(...(userStatsIndex.get(normalizedPhone) || []));
    }

    try {
      const payload = await searchVicidialLeadByPhone(normalizedPhone, {
        resolveRecordingLocations: false,
        enrichRecords: false,
        timeoutMs: VICIDIAL_LOOKUP_TIMEOUT_MS,
      });
      const candidateContacts = collectVicidialCandidateContacts(
        payload.records,
      );
      allCandidates.push(...candidateContacts);
    } catch (error) {
      lookupTimedOut =
        error.code === "ETIMEOUT" ||
        String(error.message || "")
          .toLowerCase()
          .includes("timeout");
      lookupFailed = !lookupTimedOut;
      lookupErrorMessage = error.message;

      logger.warn("TimeToLeadService -> Vicidial lead search skipped", {
        timedOut: lookupTimedOut,
        message: error.message,
        phoneNumber: normalizedPhone,
      });
    }

    const earliestValidContact = getEarliestValidContact(
      allCandidates,
      caseCreatedAt,
    );

    if (!earliestValidContact) {
      return {
        firstContact: null,
        firstContactAgentName: null,
        matchSource: null,
        timedOut: lookupTimedOut,
        failed: lookupFailed,
        errorMessage: lookupErrorMessage,
      };
    }

    return {
      firstContact: earliestValidContact.dateTime,
      firstContactAgentName: earliestValidContact.agentName || null,
      matchSource: earliestValidContact.source || "vicidial_lead_search",
      timedOut: false,
      failed: false,
    };
  } catch (error) {
    const timedOut =
      error.code === "ETIMEOUT" ||
      String(error.message || "")
        .toLowerCase()
        .includes("timeout");

    logger.warn("TimeToLeadService -> Vicidial lookup skipped", {
      timedOut,
      message: error.message,
      phoneNumber: normalizedPhone,
    });

    return {
      firstContact: null,
      firstContactAgentName: null,
      matchSource: null,
      timedOut,
      failed: !timedOut,
      errorMessage: error.message,
    };
  }
}

function getSnapshotBaseUpdateFields() {
  return [
    "case_created_at",
    "original_case_created_at",
    "case_created_date",
    "ttl_start_source",
    "ttl_start_substatus",
    "full_name",
    "phone_number",
    "email",
    "status",
    "substatus",
    "reason_for_dq",
    "reason_for_doesnt_meet_criteria",
    "reason_for_spam",
    "date_sent",
    "ethnicity",
    "origin",
    "case_type",
    "reason_for_rejection",
    "owner_id",
    "owner_name",
    "week_label",
    "has_valid_phone",
    "business_hours_eligible",
    "first_contact_at",
    "first_contact_agent_name",
    "response_delay",
    "response_delay_minutes",
    "range_time",
    "match_source",
    "match_status",
    "match_confidence",
    "has_potential_phone_reuse",
    "pending_minutes",
    "synced_at",
    "updated_at",
  ];
}

function buildSnapshotBaseRow({ item, syncedAt, hasPotentialPhoneReuse }) {
  const hasValidPhone = Boolean(item.phoneNumber);
  const isExcludedByTcpaHistory = Boolean(item.excludedFromTimeToLead);
  const businessHoursEligible =
    !isExcludedByTcpaHistory &&
    item.dateReceived.hour >= DEFAULT_BUSINESS_START_HOUR &&
    item.dateReceived.hour < DEFAULT_BUSINESS_END_HOUR;

  return {
    case_number: item.caseNumber,
    case_created_at: item.dateReceived.toJSDate(),
    original_case_created_at: item.originalDateReceived?.isValid
      ? item.originalDateReceived.toJSDate()
      : item.dateReceived.toJSDate(),
    case_created_date: item.dateReceived.toISODate(),
    ttl_start_source: item.timeToLeadStartSource || "case_created",
    ttl_start_substatus: item.timeToLeadStartSubstatus || null,
    full_name: item.fullName,
    phone_number: item.phoneNumber,
    email: item.email,
    status: item.status,
    substatus: item.substatus,
    reason_for_dq: item.reasonForDQ,
    reason_for_doesnt_meet_criteria: item.reasonForDoesntMeetCriteria,
    reason_for_spam: item.reasonForSpam,
    date_sent: item.dateSent,
    ethnicity: item.ethnicity,
    origin: item.origin,
    case_type: item.type,
    reason_for_rejection: item.reasonForRejection,
    owner_id: item.ownerId,
    owner_name: item.ownerName,
    week_label: computeWeekLabel(item.dateReceived),
    has_valid_phone: hasValidPhone,
    business_hours_eligible: businessHoursEligible,
    first_contact_at: null,
    first_contact_agent_name: null,
    response_delay: null,
    response_delay_minutes: null,
    range_time: null,
    match_source: buildInitialMatchSource({
      hasValidPhone,
      isExcludedByTcpaHistory,
    }),
    match_status: buildInitialMatchStatus({
      hasValidPhone,
      isExcludedByTcpaHistory,
    }),
    match_confidence: null,
    has_potential_phone_reuse: hasPotentialPhoneReuse,
    pending_minutes:
      hasValidPhone && !isExcludedByTcpaHistory
        ? roundMetric(syncedAt.diff(item.dateReceived, "minutes").minutes)
        : null,
    synced_at: syncedAt.toJSDate(),
    created_at: syncedAt.toJSDate(),
    updated_at: syncedAt.toJSDate(),
  };
}

function buildMetricsResetState({ baseRow, syncedAt }) {
  const isExcludedByTcpaHistory =
    baseRow.match_status === EXCLUDED_TCPA_HISTORY_MATCH_STATUS;

  return {
    ...baseRow,
    first_contact_at: null,
    first_contact_agent_name: null,
    response_delay: null,
    response_delay_minutes: null,
    range_time: null,
    match_source: buildInitialMatchSource({
      hasValidPhone: baseRow.has_valid_phone,
      isExcludedByTcpaHistory,
    }),
    match_status: buildInitialMatchStatus({
      hasValidPhone: baseRow.has_valid_phone,
      isExcludedByTcpaHistory,
    }),
    match_confidence: null,
    pending_minutes:
      baseRow.has_valid_phone && !isExcludedByTcpaHistory
        ? roundMetric(
            syncedAt.diff(
              DateTime.fromJSDate(new Date(baseRow.case_created_at), {
                zone: LIMA_TIMEZONE,
              }),
              "minutes",
            ).minutes,
          )
        : null,
    synced_at: syncedAt.toJSDate(),
    updated_at: syncedAt.toJSDate(),
  };
}

function shouldPreserveSnapshotMetrics(existingRow, nextBaseRow) {
  if (!existingRow) return false;
  if (nextBaseRow.match_status === EXCLUDED_TCPA_HISTORY_MATCH_STATUS) {
    return false;
  }
  if (existingRow.match_status === EXCLUDED_TCPA_HISTORY_MATCH_STATUS) {
    return false;
  }

  const samePhoneNumber = existingRow.phone_number === nextBaseRow.phone_number;
  const sameCaseCreatedAt =
    new Date(existingRow.case_created_at).getTime() ===
    new Date(nextBaseRow.case_created_at).getTime();

  return samePhoneNumber && sameCaseCreatedAt;
}

function mergeSnapshotRowWithExistingMetrics({
  existingRow,
  baseRow,
  syncedAt,
}) {
  if (!existingRow) {
    return baseRow;
  }

  if (!shouldPreserveSnapshotMetrics(existingRow, baseRow)) {
    return buildMetricsResetState({ baseRow, syncedAt });
  }

  return {
    ...baseRow,
    first_contact_at: existingRow.first_contact_at,
    first_contact_agent_name: existingRow.first_contact_agent_name,
    response_delay: existingRow.response_delay,
    response_delay_minutes: existingRow.response_delay_minutes,
    range_time: existingRow.range_time,
    match_source: existingRow.match_source,
    match_status: existingRow.match_status,
    match_confidence: existingRow.match_confidence,
    pending_minutes: existingRow.pending_minutes,
    synced_at: syncedAt.toJSDate(),
    created_at: existingRow.created_at || baseRow.created_at,
    updated_at: syncedAt.toJSDate(),
  };
}

function normalizeBatchLimit(
  limit,
  defaultValue = DEFAULT_METRICS_REFRESH_LIMIT,
) {
  const parsed = Number(limit);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(Math.floor(parsed), MAX_METRICS_REFRESH_LIMIT);
}

function normalizeRetryableMatchStatuses(statuses) {
  if (!statuses) return DEFAULT_RETRYABLE_MATCH_STATUSES;

  const values = Array.isArray(statuses)
    ? statuses
    : String(statuses).split(",");
  const normalized = Array.from(
    new Set(values.map((item) => sanitizeText(item)).filter(Boolean)),
  );

  return normalized.length ? normalized : DEFAULT_RETRYABLE_MATCH_STATUSES;
}

function buildTimeToLeadCaseSyncResult({
  fetched,
  synced,
  startDate,
  endDate,
}) {
  return {
    phase: "salesforce_cases",
    fetched,
    synced,
    startDate,
    endDate,
  };
}

async function upsertTimeToLeadSyncRuns({ window, rows, fetched, syncedAt }) {
  const dates = listDateKeysInWindow(window);
  const rowCountsByDate = rows.reduce((accumulator, row) => {
    accumulator.set(
      row.case_created_date,
      (accumulator.get(row.case_created_date) || 0) + 1,
    );
    return accumulator;
  }, new Map());

  const syncRows = dates.map((date) => ({
    sync_date: date,
    start_date: window.start.toISODate(),
    end_date: window.end.toISODate(),
    salesforce_total_cases:
      dates.length === 1 ? fetched : rowCountsByDate.get(date) || 0,
    snapshot_total_cases: rowCountsByDate.get(date) || 0,
    status: "synced",
    synced_at: syncedAt.toJSDate(),
    created_at: syncedAt.toJSDate(),
    updated_at: syncedAt.toJSDate(),
  }));

  if (!syncRows.length) return;

  await TimeToLeadSyncRun.bulkCreate(syncRows, {
    updateOnDuplicate: [
      "start_date",
      "end_date",
      "salesforce_total_cases",
      "snapshot_total_cases",
      "status",
      "synced_at",
      "updated_at",
    ],
  });
}

async function syncTimeToLeadSnapshots({ startDate, endDate }) {
  await ensureTimeToLeadSnapshotTable();

  logger.info("TimeToLeadService -> syncTimeToLeadSnapshots() started", {
    startDate,
    endDate,
    mode: "salesforce_cases_only",
  });

  const window = buildDateWindow(startDate, endDate);
  const sf = await authenticateSalesforce();

  const soql = buildTimeToLeadCasesQuery({
    startDateTimeUtc: window.start.toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss'Z'"),
    endDateTimeUtc: window.endExclusive
      .toUTC()
      .toFormat("yyyy-LL-dd'T'HH:mm:ss'Z'"),
  });

  const records = await runSoqlQueryAll(sf, soql);
  const rawItems = records
    .map(mapSalesforceCase)
    .map(clearReasonsByStatus)
    .filter((item) => item.dateReceived);
  const tcpaHistoryByCaseId = await fetchTcpaHistoryByCaseId(
    sf,
    rawItems.map((item) => item.caseId),
  );
  const items = rawItems.map((item) =>
    applyTimeToLeadExclusionFromHistory(item, tcpaHistoryByCaseId),
  );

  const syncedAt = DateTime.now().setZone(LIMA_TIMEZONE);
  const phoneCaseCounts = items.reduce((accumulator, item) => {
    if (!item.phoneNumber) {
      return accumulator;
    }

    accumulator.set(
      item.phoneNumber,
      (accumulator.get(item.phoneNumber) || 0) + 1,
    );
    return accumulator;
  }, new Map());

  const existingRows = items.length
    ? await TimeToLeadSnapshot.findAll({
        where: {
          case_number: {
            [Op.in]: items.map((item) => item.caseNumber).filter(Boolean),
          },
        },
        raw: true,
      })
    : [];
  const existingRowsByCaseNumber = new Map(
    existingRows.map((row) => [row.case_number, row]),
  );

  const rows = items.map((item) => ({
    ...mergeSnapshotRowWithExistingMetrics({
      existingRow: existingRowsByCaseNumber.get(item.caseNumber),
      baseRow: buildSnapshotBaseRow({
        item,
        syncedAt,
        hasPotentialPhoneReuse: Boolean(
          item.phoneNumber && (phoneCaseCounts.get(item.phoneNumber) || 0) > 1,
        ),
      }),
      syncedAt,
    }),
  }));

  const caseNumbers = rows.map((row) => row.case_number).filter(Boolean);

  if (caseNumbers.length) {
    await TimeToLeadSnapshot.destroy({
      where: {
        case_created_date: {
          [Op.gte]: window.start.toISODate(),
          [Op.lte]: window.end.toISODate(),
        },
        case_number: {
          [Op.notIn]: caseNumbers,
        },
      },
    });
  } else {
    await TimeToLeadSnapshot.destroy({
      where: {
        case_created_date: {
          [Op.gte]: window.start.toISODate(),
          [Op.lte]: window.end.toISODate(),
        },
      },
    });
  }

  if (rows.length) {
    await TimeToLeadSnapshot.bulkCreate(rows, {
      updateOnDuplicate: getSnapshotBaseUpdateFields(),
    });
  }

  await upsertTimeToLeadSyncRuns({
    window,
    rows,
    fetched: records.length,
    syncedAt,
  });

  const result = buildTimeToLeadCaseSyncResult({
    fetched: records.length,
    synced: rows.length,
    startDate: window.start.toISODate(),
    endDate: window.end.toISODate(),
  });

  logger.success("TimeToLeadService -> syncTimeToLeadSnapshots() completed", {
    ...result,
  });

  return result;
}

async function syncRecentTimeToLeadSnapshots(daysBack = 1) {
  const totalDays = Math.max(0, Number(daysBack) || 0);
  const nowInLima = DateTime.now().setZone(LIMA_TIMEZONE).startOf("day");
  const results = [];

  for (let offset = totalDays; offset >= 0; offset -= 1) {
    const targetDate = nowInLima.minus({ days: offset }).toISODate();
    results.push(
      await syncTimeToLeadSnapshots({
        startDate: targetDate,
        endDate: targetDate,
      }),
    );
  }

  return results;
}

async function refreshTimeToLeadSnapshotMetrics({
  startDate,
  endDate,
  limit = DEFAULT_METRICS_REFRESH_LIMIT,
  force = false,
  retryableMatchStatuses,
  prefetchedUserStatsIndex,
}) {
  await ensureTimeToLeadSnapshotTable();

  logger.info(
    "TimeToLeadService -> refreshTimeToLeadSnapshotMetrics() started",
    {
      startDate,
      endDate,
      limit,
      force,
      retryableMatchStatuses,
    },
  );

  const window = buildDateWindow(startDate, endDate);
  const batchLimit = normalizeBatchLimit(limit);
  const matchStatusesToRetry = normalizeRetryableMatchStatuses(
    retryableMatchStatuses,
  );
  const where = {
    case_created_date: {
      [Op.gte]: window.start.toISODate(),
      [Op.lte]: window.end.toISODate(),
    },
    has_valid_phone: true,
    match_status: {
      [Op.ne]: EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
    },
  };

  if (!force) {
    where.first_contact_at = {
      [Op.is]: null,
    };
    where.match_status = {
      [Op.in]: matchStatusesToRetry,
      [Op.ne]: EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
    };
  }

  const candidateRows = await TimeToLeadSnapshot.findAll({
    where,
    attributes: [
      "case_number",
      "case_created_at",
      "phone_number",
      "has_potential_phone_reuse",
    ],
    raw: true,
    order: [["case_created_at", "ASC"]],
    limit: batchLimit,
  });

  if (!candidateRows.length) {
    return {
      phase: "metrics_refresh",
      processed: 0,
      matched: 0,
      unmatched: 0,
      startDate: window.start.toISODate(),
      endDate: window.end.toISODate(),
      limit: batchLimit,
      force,
      retryableMatchStatuses: force ? "all" : matchStatusesToRetry,
    };
  }

  const phoneCaseCounts = candidateRows.reduce((accumulator, row) => {
    if (!row.phone_number) {
      return accumulator;
    }

    accumulator.set(
      row.phone_number,
      (accumulator.get(row.phone_number) || 0) + 1,
    );
    return accumulator;
  }, new Map());

  const lookupSyncedAt = DateTime.now().setZone(LIMA_TIMEZONE);
  let userStatsIndex = prefetchedUserStatsIndex || null;
  let matched = 0;
  let unmatched = 0;
  let lookupTimeouts = 0;
  let lookupFailures = 0;

  if (!userStatsIndex) {
    try {
      const hasVicidialDbAccess = await canUseVicidialOutboundLog();

      if (!hasVicidialDbAccess) {
        const userStatsLookup = await buildVicidialOutboundIndexFromUserStats({
          startDate: window.start,
          endDate: window.end,
          phoneNumbers: [...phoneCaseCounts.keys()],
        });
        userStatsIndex = userStatsLookup.byPhone;
      }
    } catch (error) {
      logger.warn("TimeToLeadService -> user_stats prefetch skipped", {
        message: error.message,
        startDate: window.start.toISODate(),
        endDate: window.end.toISODate(),
      });
    }
  }

  await mapWithConcurrency(candidateRows, LOOKUP_CONCURRENCY, async (row) => {
    const caseCreatedAt = toLimaDateTime(row.case_created_at);

    if (!caseCreatedAt?.isValid) {
      unmatched += 1;
      lookupFailures += 1;
      return;
    }

    const lookupResult = await fetchFirstContactForCase({
      caseCreatedAt,
      phoneNumber: row.phone_number,
      userStatsIndex,
    });
    const firstContact = lookupResult.firstContact;
    const firstContactAgentName = lookupResult.firstContactAgentName;
    const matchSource = lookupResult.matchSource || "vicidial";

    const responseDelay = computeResponseDelay(firstContact, caseCreatedAt);
    const responseDelayMinutes = responseDelayToMinutes(responseDelay);
    const hasPotentialPhoneReuse =
      (phoneCaseCounts.get(row.phone_number) || 0) > 1;
    let matchConfidence = null;

    if (firstContact) {
      matchConfidence = hasPotentialPhoneReuse ? "medium" : "high";
    }

    if (firstContact) {
      matched += 1;
    } else if (lookupResult.timedOut) {
      lookupTimeouts += 1;
      unmatched += 1;
    } else if (lookupResult.failed) {
      lookupFailures += 1;
      unmatched += 1;
    } else {
      unmatched += 1;
    }

    let matchStatus = "no_first_call_found";
    if (firstContact) {
      matchStatus = "matched";
    } else if (lookupResult.timedOut) {
      matchStatus = "lookup_timeout";
    } else if (lookupResult.failed) {
      matchStatus = "lookup_failed";
    }

    await TimeToLeadSnapshot.update(
      {
        first_contact_at: firstContact ? firstContact.toJSDate() : null,
        first_contact_agent_name: firstContactAgentName,
        response_delay: responseDelay,
        response_delay_minutes: roundMetric(responseDelayMinutes),
        range_time: computeRangeTime(responseDelayMinutes),
        match_source: matchSource,
        match_status: matchStatus,
        match_confidence: matchConfidence,
        has_potential_phone_reuse: hasPotentialPhoneReuse,
        pending_minutes: firstContact
          ? null
          : roundMetric(lookupSyncedAt.diff(caseCreatedAt, "minutes").minutes),
        synced_at: lookupSyncedAt.toJSDate(),
      },
      {
        where: {
          case_number: row.case_number,
        },
      },
    );
  });

  const result = {
    phase: "metrics_refresh",
    processed: candidateRows.length,
    matched,
    unmatched,
    lookupTimeouts,
    lookupFailures,
    startDate: window.start.toISODate(),
    endDate: window.end.toISODate(),
    limit: batchLimit,
    force,
    retryableMatchStatuses: force ? "all" : matchStatusesToRetry,
  };

  logger.success(
    "TimeToLeadService -> refreshTimeToLeadSnapshotMetrics() completed",
    result,
  );

  return result;
}

async function refreshTimeToLeadSnapshotMetricsBatches({
  startDate,
  endDate,
  limit = DEFAULT_METRICS_REFRESH_LIMIT,
  maxBatches = 1,
  retryableMatchStatuses,
}) {
  const totalBatches = Math.max(1, Number(maxBatches) || 1);
  const batches = [];
  let prefetchedUserStatsIndex = null;

  try {
    const hasVicidialDbAccess = await canUseVicidialOutboundLog();

    if (!hasVicidialDbAccess) {
      const userStatsLookup = await buildVicidialOutboundIndexFromUserStats({
        startDate,
        endDate,
      });
      prefetchedUserStatsIndex = userStatsLookup.byPhone;
    }
  } catch (error) {
    logger.warn("TimeToLeadService -> batch user_stats prefetch skipped", {
      message: error.message,
      startDate,
      endDate,
    });
  }

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const result = await refreshTimeToLeadSnapshotMetrics({
      startDate,
      endDate,
      limit,
      force: false,
      retryableMatchStatuses,
      prefetchedUserStatsIndex,
    });

    batches.push(result);

    if (!result.processed || result.processed < result.limit) {
      break;
    }
  }

  return {
    phase: "metrics_refresh_batches",
    batches,
    totalBatches: batches.length,
    processed: batches.reduce((sum, item) => sum + (item.processed || 0), 0),
    matched: batches.reduce((sum, item) => sum + (item.matched || 0), 0),
    unmatched: batches.reduce((sum, item) => sum + (item.unmatched || 0), 0),
    lookupTimeouts: batches.reduce(
      (sum, item) => sum + (item.lookupTimeouts || 0),
      0,
    ),
    lookupFailures: batches.reduce(
      (sum, item) => sum + (item.lookupFailures || 0),
      0,
    ),
    startDate,
    endDate,
    limit,
    maxBatches: totalBatches,
  };
}

async function refreshRecentTimeToLeadSnapshotMetrics({
  daysBack = 1,
  limit = 25,
  force = false,
  retryableMatchStatuses = LIVE_RETRYABLE_MATCH_STATUSES,
}) {
  const totalDays = Math.max(0, Number(daysBack) || 0);
  const nowInLima = DateTime.now().setZone(LIMA_TIMEZONE).startOf("day");
  const results = [];

  for (let offset = totalDays; offset >= 0; offset -= 1) {
    const targetDate = nowInLima.minus({ days: offset }).toISODate();
    results.push(
      await refreshTimeToLeadSnapshotMetrics({
        startDate: targetDate,
        endDate: targetDate,
        limit,
        force,
        retryableMatchStatuses,
      }),
    );
  }

  return results;
}

function toLimaDateTime(value) {
  if (!value) return null;
  return DateTime.fromJSDate(new Date(value), { zone: LIMA_TIMEZONE });
}

function mapSnapshotRowToCase(row, nowInLima) {
  const caseCreatedAt = toLimaDateTime(row.case_created_at);
  const originalCaseCreatedAt = toLimaDateTime(
    row.original_case_created_at || row.case_created_at,
  );
  const firstContactAt = toLimaDateTime(row.first_contact_at);
  const pendingMinutes = firstContactAt
    ? null
    : roundMetric(nowInLima.diff(caseCreatedAt, "minutes").minutes);

  return {
    caseNumber: row.case_number,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    email: row.email,
    status: row.status,
    substatus: row.substatus,
    reasonForDQ: row.reason_for_dq,
    reasonForDoesntMeetCriteria: row.reason_for_doesnt_meet_criteria,
    reasonForSpam: row.reason_for_spam,
    dateSent: row.date_sent,
    ethnicity: row.ethnicity,
    origin: row.origin,
    type: row.case_type,
    reasonForRejection: row.reason_for_rejection,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    dateReceived: caseCreatedAt?.toFormat("yyyy-LL-dd HH:mm:ss") || null,
    originalDateReceived:
      originalCaseCreatedAt?.toFormat("yyyy-LL-dd HH:mm:ss") || null,
    timeToLeadStart: caseCreatedAt?.toFormat("yyyy-LL-dd HH:mm:ss") || null,
    timeToLeadStartSource: row.ttl_start_source || "case_created",
    timeToLeadStartSubstatus: row.ttl_start_substatus || null,
    firstContact: firstContactAt?.toFormat("yyyy-LL-dd HH:mm:ss") || null,
    firstContactAgentName: row.first_contact_agent_name,
    responseDelay: row.response_delay,
    responseDelayMinutes:
      row.response_delay_minutes === null
        ? null
        : Number(row.response_delay_minutes),
    rangeTime: row.range_time,
    week: row.week_label,
    matchSource: row.match_source,
    matchStatus: row.match_status,
    matchConfidence: row.match_confidence,
    hasPotentialPhoneReuse: Boolean(row.has_potential_phone_reuse),
    pendingMinutes,
  };
}

function buildSnapshotCoverage({
  rows,
  eligibleRows,
  window,
  businessHoursOnly,
  syncRuns,
}) {
  const expectedDates = listDateKeysInWindow(window);
  const syncRunsByDate = new Map(syncRuns.map((run) => [run.sync_date, run]));
  const syncedDates = expectedDates.filter((date) => syncRunsByDate.has(date));
  const missingDates = expectedDates.filter(
    (date) => !syncRunsByDate.has(date),
  );
  const countByMatchStatus = countBy(
    eligibleRows,
    (row) => row.match_status || "unknown",
  );
  const pendingLookup = countByMatchStatus.pending_lookup || 0;
  const matched = countByMatchStatus.matched || 0;
  const noFirstCallFound = countByMatchStatus.no_first_call_found || 0;
  const lookupTimeouts = countByMatchStatus.lookup_timeout || 0;
  const lookupFailures = countByMatchStatus.lookup_failed || 0;
  const invalidPhone = rows.filter((row) => !row.has_valid_phone).length;
  const excludedByTcpaHistory = rows.filter(
    (row) => row.match_status === EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
  ).length;
  const withValidPhone = rows.length - invalidPhone;
  const lastSyncedAt = rows.reduce((latest, row) => {
    if (!row.synced_at) return latest;
    if (!latest) return row.synced_at;
    return new Date(row.synced_at) > new Date(latest) ? row.synced_at : latest;
  }, null);

  return {
    startDate: window.start.toISODate(),
    endDate: window.end.toISODate(),
    source: "time_to_lead_snapshots",
    expectedDays: expectedDates.length,
    syncedDays: syncedDates.length,
    missingDays: missingDates.length,
    missingDates,
    hasData: rows.length > 0,
    totalSnapshotRows: rows.length,
    withValidPhone,
    invalidPhone,
    excludedByTcpaHistory,
    eligibleAfterFilters: eligibleRows.length,
    businessHoursOnly,
    matched,
    pendingLookup,
    noFirstCallFound,
    lookupTimeouts,
    lookupFailures,
    processedCases:
      matched + noFirstCallFound + lookupTimeouts + lookupFailures,
    isFullySynced: missingDates.length === 0,
    isFullyProcessed: missingDates.length === 0 && pendingLookup === 0,
    lastSyncedAt: lastSyncedAt
      ? DateTime.fromJSDate(new Date(lastSyncedAt), {
          zone: LIMA_TIMEZONE,
        }).toISO()
      : null,
  };
}

async function getTimeToLead({ startDate, endDate, businessHoursOnly = true }) {
  await ensureTimeToLeadSnapshotTable();

  logger.info("TimeToLeadService -> getTimeToLead() started", {
    startDate,
    endDate,
    businessHoursOnly,
  });

  try {
    const window = buildDateWindow(startDate, endDate);
    const rows = await TimeToLeadSnapshot.findAll({
      where: {
        case_created_date: {
          [Op.gte]: window.start.toISODate(),
          [Op.lte]: window.end.toISODate(),
        },
      },
      raw: true,
      order: [["case_created_at", "DESC"]],
    });
    const syncRuns = await TimeToLeadSyncRun.findAll({
      where: {
        sync_date: {
          [Op.gte]: window.start.toISODate(),
          [Op.lte]: window.end.toISODate(),
        },
      },
      raw: true,
      order: [["sync_date", "ASC"]],
    });

    const excludedMissingCreatedDate = 0;
    const excludedMissingPhone = rows.filter(
      (row) => !row.has_valid_phone,
    ).length;
    const excludedByTcpaHistory = rows.filter(
      (row) => row.match_status === EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
    ).length;
    const validPhoneRows = rows.filter(
      (row) =>
        row.has_valid_phone &&
        row.match_status !== EXCLUDED_TCPA_HISTORY_MATCH_STATUS,
    );

    let eligibleRows = validPhoneRows;
    let excludedOutsideBusinessHours = 0;

    if (businessHoursOnly) {
      excludedOutsideBusinessHours = validPhoneRows.filter(
        (row) => !row.business_hours_eligible,
      ).length;
      eligibleRows = validPhoneRows.filter(
        (row) => row.business_hours_eligible,
      );
    }

    const nowInLima = DateTime.now().setZone(LIMA_TIMEZONE);
    const snapshotCoverage = buildSnapshotCoverage({
      rows,
      eligibleRows,
      window,
      businessHoursOnly,
      syncRuns,
    });
    const mappedCases = eligibleRows.map((row) =>
      mapSnapshotRowToCase(row, nowInLima),
    );

    const completedItems = mappedCases.filter(
      (item) => item.firstContact && item.responseDelay !== null,
    );
    const pendingItems = mappedCases
      .filter((item) => !item.firstContact || item.responseDelay === null)
      .map((item) => ({
        caseNumber: item.caseNumber,
        fullName: item.fullName,
        phoneNumber: item.phoneNumber,
        email: item.email,
        status: item.status,
        substatus: item.substatus,
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        type: item.type,
        origin: item.origin,
        dateReceived: item.dateReceived,
        originalDateReceived: item.originalDateReceived,
        timeToLeadStart: item.timeToLeadStart,
        timeToLeadStartSource: item.timeToLeadStartSource,
        timeToLeadStartSubstatus: item.timeToLeadStartSubstatus,
        week: item.week,
        waitingMinutes: item.pendingMinutes,
        waitingTime: formatDurationFromMinutes(item.pendingMinutes),
        matchSource: item.matchSource,
        matchStatus: item.matchStatus,
        matchConfidence: item.matchConfidence,
        hasPotentialPhoneReuse: item.hasPotentialPhoneReuse,
      }))
      .sort((left, right) => right.waitingMinutes - left.waitingMinutes);

    const responseDelayValues = completedItems
      .map((item) => item.responseDelayMinutes)
      .filter((value) => value !== null && !Number.isNaN(value));

    const summaryByRange = TIME_RANGE_LABELS.reduce((accumulator, label) => {
      accumulator[label] = 0;
      return accumulator;
    }, {});

    completedItems.forEach((item) => {
      if (item.rangeTime && summaryByRange[item.rangeTime] !== undefined) {
        summaryByRange[item.rangeTime] += 1;
      }
    });

    const pendingByOwner = countBy(
      pendingItems,
      (item) => item.ownerName || "Unassigned",
    );
    const pendingByType = countBy(
      pendingItems,
      (item) => item.type || "Unknown",
    );

    const matchedPhoneReuseCount = completedItems.filter(
      (item) => item.hasPotentialPhoneReuse,
    ).length;

    const result = {
      total: completedItems.length,
      filters: {
        startDate: window.start.toISODate(),
        endDate: window.end.toISODate(),
        businessHoursOnly,
        timezone: LIMA_TIMEZONE,
      },
      meta: {
        source: "snapshot",
        lastSyncedAt: snapshotCoverage.lastSyncedAt,
        snapshotCoverage,
      },
      snapshotCoverage,
      summary: {
        totals: {
          salesforceCasesFetched: rows.length,
          eligibleAfterFilters: eligibleRows.length,
          completedWithFirstContact: completedItems.length,
          pendingWithoutFirstContact: pendingItems.length,
          potentialPhoneReuseCases: matchedPhoneReuseCount,
        },
        exclusions: {
          missingCreatedDate: excludedMissingCreatedDate,
          missingOrInvalidPhone: excludedMissingPhone,
          tcpaHistory: excludedByTcpaHistory,
          outsideBusinessHours: excludedOutsideBusinessHours,
          withoutFirstContact: pendingItems.length,
        },
        responseDelay: buildLatencyStats(responseDelayValues),
        sla: buildSlaSummary(responseDelayValues),
        byRangeTime: summaryByRange,
        breakdowns: {
          byOwner: buildBreakdown({
            completedItems,
            pendingItems,
            keySelector: (item) => item.ownerName || "Unassigned",
            keyName: "ownerName",
          }),
          byType: buildBreakdown({
            completedItems,
            pendingItems,
            keySelector: (item) => item.type || "Unknown",
            keyName: "type",
          }),
        },
        matching: {
          source: "vicidial",
          eligibleCasesReviewed: eligibleRows.length,
          matchedCases: completedItems.length,
          unmatchedCases: pendingItems.length,
          completedCasesWithPotentialPhoneReuse: matchedPhoneReuseCount,
          pendingCasesWithPotentialPhoneReuse: pendingItems.filter(
            (item) => item.hasPotentialPhoneReuse,
          ).length,
        },
        pendingInsights: {
          oldestWaitingCase: pendingItems[0] || null,
          byOwner: pendingByOwner,
          byType: pendingByType,
        },
      },
      pendingFirstContact: {
        total: pendingItems.length,
        data: pendingItems,
      },
      data: completedItems,
    };

    logger.success("TimeToLeadService -> getTimeToLead() completed", {
      total: result.total,
      pendingFirstCall: pendingItems.length,
      source: result.meta.source,
    });

    return result;
  } catch (error) {
    logger.error("TimeToLeadService -> getTimeToLead() failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  getTimeToLead,
  syncTimeToLeadSnapshots,
  syncRecentTimeToLeadSnapshots,
  refreshTimeToLeadSnapshotMetrics,
  refreshTimeToLeadSnapshotMetricsBatches,
  refreshRecentTimeToLeadSnapshotMetrics,
  ensureTimeToLeadSnapshotTable,
};
