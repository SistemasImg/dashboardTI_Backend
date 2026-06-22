const { DateTime } = require("luxon");
const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("./auth.service");
const { runSoqlQueryAll } = require("./client.service");
const { buildTimeToLeadCasesQuery } = require("./queries/timeToLead.query");
const sqlServerPool = require("../sqlserver/pool.service");
const {
  buildTimeToLeadFirstContactQuery,
} = require("../sqlserver/queries/timeToLeadFirstContact.query");
const { normalizePhone } = require("./phoneLookup.service");

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
const SQL_PHONE_CHUNK_SIZE = 200;

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

  const diffMillis = Math.abs(
    firstContact.toMillis() - dateReceived.toMillis(),
  );
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

  return SLA_THRESHOLDS_MINUTES.reduce((accumulator, threshold) => {
    const met = values.filter((value) => value <= threshold).length;
    const breached = total - met;

    accumulator[`under${threshold}Minutes`] = {
      thresholdMinutes: threshold,
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

function selectFirstContactAfterCase(contactHistory, dateReceived) {
  if (!dateReceived?.isValid || !Array.isArray(contactHistory)) {
    return null;
  }

  return (
    contactHistory.find(
      (contactTimestamp) =>
        contactTimestamp?.isValid &&
        contactTimestamp.toMillis() >= dateReceived.toMillis(),
    ) || null
  );
}

function mapSalesforceCase(record) {
  const dateReceived = record.CreatedDate
    ? DateTime.fromISO(record.CreatedDate, { zone: "utc" }).setZone(
        LIMA_TIMEZONE,
      )
    : null;

  return {
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
  };
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

async function fetchFirstContacts(startDate, endDate, phoneNumbers = []) {
  if (!phoneNumbers.length) {
    return new Map();
  }

  const pool = await sqlServerPool.getPool();
  const callsByPhone = new Map();

  const phoneChunks = chunkArray(phoneNumbers, SQL_PHONE_CHUNK_SIZE);

  for (const phoneChunk of phoneChunks) {
    const query = buildTimeToLeadFirstContactQuery(
      startDate,
      endDate,
      phoneChunk,
    );

    if (!query) {
      continue;
    }

    const result = await pool.request().query(query);
    const rows = result.recordset || [];

    rows.forEach((row) => {
      const phone = normalizePhone(row.CleanANI);
      const contactTimestamp = row.ContactTimestamp
        ? DateTime.fromJSDate(new Date(row.ContactTimestamp), {
            zone: LIMA_TIMEZONE,
          })
        : null;

      if (!phone || !contactTimestamp?.isValid) {
        return;
      }

      if (!callsByPhone.has(phone)) {
        callsByPhone.set(phone, []);
      }

      callsByPhone.get(phone).push(contactTimestamp);
    });
  }

  return callsByPhone;
}

async function getTimeToLead({ startDate, endDate, businessHoursOnly = true }) {
  logger.info("TimeToLeadService -> getTimeToLead() started", {
    startDate,
    endDate,
    businessHoursOnly,
  });

  try {
    const window = buildDateWindow(startDate, endDate);
    const sf = await authenticateSalesforce();

    const soql = buildTimeToLeadCasesQuery({
      startDateTimeUtc: window.start
        .toUTC()
        .toFormat("yyyy-LL-dd'T'HH:mm:ss'Z'"),
      endDateTimeUtc: window.endExclusive
        .toUTC()
        .toFormat("yyyy-LL-dd'T'HH:mm:ss'Z'"),
    });

    const records = await runSoqlQueryAll(sf, soql);

    const rawItems = records.map(mapSalesforceCase).map(clearReasonsByStatus);

    const excludedMissingCreatedDate = rawItems.filter(
      (item) => !item.dateReceived,
    ).length;
    const itemsWithValidDate = rawItems.filter((item) => item.dateReceived);
    const excludedMissingPhone = itemsWithValidDate.filter(
      (item) => !item.phoneNumber,
    ).length;

    let items = itemsWithValidDate.filter((item) => item.phoneNumber);

    let excludedOutsideBusinessHours = 0;
    if (businessHoursOnly) {
      const itemsBeforeBusinessHoursFilter = items.length;
      items = items.filter(
        (item) =>
          item.dateReceived.hour >= DEFAULT_BUSINESS_START_HOUR &&
          item.dateReceived.hour < DEFAULT_BUSINESS_END_HOUR,
      );
      excludedOutsideBusinessHours =
        itemsBeforeBusinessHoursFilter - items.length;
    }

    const relevantPhones = [...new Set(items.map((item) => item.phoneNumber))];

    logger.info("TimeToLeadService -> fetching SQL first contacts", {
      startDate: window.start.toISODate(),
      endDate: window.end.toISODate(),
      phoneCount: relevantPhones.length,
      chunkSize: SQL_PHONE_CHUNK_SIZE,
    });

    const firstContactByPhone = await fetchFirstContacts(
      window.start.toISODate(),
      window.end.toISODate(),
      relevantPhones,
    );

    const phoneCaseCounts = items.reduce((accumulator, item) => {
      accumulator.set(
        item.phoneNumber,
        (accumulator.get(item.phoneNumber) || 0) + 1,
      );
      return accumulator;
    }, new Map());

    const nowInLima = window.nowInLima;

    const enrichedItems = items.map((item) => {
      const firstContact = selectFirstContactAfterCase(
        firstContactByPhone.get(item.phoneNumber) || [],
        item.dateReceived,
      );
      const responseDelay = computeResponseDelay(
        firstContact,
        item.dateReceived,
      );
      const responseDelayMinutes = responseDelayToMinutes(responseDelay);
      const hasPotentialPhoneReuse =
        (phoneCaseCounts.get(item.phoneNumber) || 0) > 1;
      let matchConfidence = null;
      if (firstContact) {
        matchConfidence = hasPotentialPhoneReuse ? "medium" : "high";
      }

      return {
        caseNumber: item.caseNumber,
        fullName: item.fullName,
        phoneNumber: item.phoneNumber,
        email: item.email,
        status: item.status,
        substatus: item.substatus,
        reasonForDQ: item.reasonForDQ,
        reasonForDoesntMeetCriteria: item.reasonForDoesntMeetCriteria,
        reasonForSpam: item.reasonForSpam,
        dateSent: item.dateSent,
        ethnicity: item.ethnicity,
        origin: item.origin,
        type: item.type,
        reasonForRejection: item.reasonForRejection,
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        dateReceived: item.dateReceived.toFormat("yyyy-LL-dd HH:mm:ss"),
        firstContact: firstContact
          ? firstContact.toFormat("yyyy-LL-dd HH:mm:ss")
          : null,
        responseDelay,
        responseDelayMinutes: roundMetric(responseDelayMinutes),
        rangeTime: computeRangeTime(responseDelayMinutes),
        week: computeWeekLabel(item.dateReceived),
        matchSource: "phone",
        matchStatus: firstContact ? "matched" : "no_first_call_found",
        matchConfidence,
        hasPotentialPhoneReuse,
        pendingMinutes: firstContact
          ? null
          : roundMetric(nowInLima.diff(item.dateReceived, "minutes").minutes),
      };
    });

    const completedItems = enrichedItems.filter((item) => item.firstContact);
    const pendingItems = enrichedItems
      .filter((item) => !item.firstContact)
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
      summary: {
        totals: {
          salesforceCasesFetched: records.length,
          eligibleAfterFilters: items.length,
          completedWithFirstContact: completedItems.length,
          pendingWithoutFirstContact: pendingItems.length,
          potentialPhoneReuseCases: matchedPhoneReuseCount,
        },
        exclusions: {
          missingCreatedDate: excludedMissingCreatedDate,
          missingOrInvalidPhone: excludedMissingPhone,
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
          source: "phone",
          eligibleCasesReviewed: items.length,
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
};
