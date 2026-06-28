function buildSalesforceDateRange(startDate, endDate = startDate) {
  const timezone = process.env.SALESFORCE_TIMEZONE || "America/Los_Angeles";
  const startInput = String(startDate || "").trim();
  const endInput = String(endDate || startDate || "").trim();
  const [year, month, day] = startInput.split("-").map(Number);
  const [endYear, endMonth, endDay] = endInput.split("-").map(Number);

  if (!year || !month || !day) {
    throw Object.assign(
      new Error("startDate is required in YYYY-MM-DD format"),
      {
        statusCode: 400,
      },
    );
  }

  if (!endYear || !endMonth || !endDay) {
    throw Object.assign(new Error("endDate is required in YYYY-MM-DD format"), {
      statusCode: 400,
    });
  }

  const formatUtcInstantInTimeZone = (utcInstant) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(utcInstant);

    const partMap = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    return {
      year: Number(partMap.year),
      month: Number(partMap.month),
      day: Number(partMap.day),
      hour: Number(partMap.hour),
      minute: Number(partMap.minute),
      second: Number(partMap.second),
    };
  };

  const getUtcOffsetMinutes = (utcInstant) => {
    const local = formatUtcInstantInTimeZone(utcInstant);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );

    return Math.round((localAsUtc - utcInstant.getTime()) / 60000);
  };

  const getDayStartUtc = (targetYear, targetMonth, targetDay) => {
    const approxUtcMidday = new Date(
      Date.UTC(targetYear, targetMonth - 1, targetDay, 12, 0, 0),
    );
    const offsetMinutes = getUtcOffsetMinutes(approxUtcMidday);

    return new Date(
      Date.UTC(targetYear, targetMonth - 1, targetDay, 0, 0, 0) -
        offsetMinutes * 60000,
    );
  };

  const start = getDayStartUtc(year, month, day);
  const nextDate = new Date(
    Date.UTC(endYear, endMonth - 1, endDay + 1, 12, 0, 0),
  );
  const nextParts = formatUtcInstantInTimeZone(nextDate);
  const end = getDayStartUtc(nextParts.year, nextParts.month, nextParts.day);

  return {
    start: start.toISOString().replace(".000", ""),
    end: end.toISOString().replace(".000", ""),
  };
}

function escapeSoqlString(value) {
  return String(value).replaceAll("'", String.raw`\'`);
}

function buildOptionalCaseTypeFilter(caseType, fieldPrefix = "") {
  const normalized = String(caseType || "").trim();

  if (!normalized) {
    return "";
  }

  return `  AND ${fieldPrefix}Type = '${escapeSoqlString(normalized)}'`;
}

function buildOperationalFlowSelect() {
  return `
  Id,
  CaseNumber,
  CreatedDate,
  Sent_Date2__c,
  FullName__c,
  Phone_Numbercontact__c,
  Email__c,
  Status,
  Substatus__c,
  Tier__c,
  Type,
  Supplier_Segment__c,
  Origin,
  Reason_for_Callback__c,
  OwnerId,
  Owner.Name`;
}

function buildDailyInflowCasesQuery(startDate, endDate, caseType) {
  const { start, end } = buildSalesforceDateRange(startDate, endDate);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT${buildOperationalFlowSelect()}
FROM Case
WHERE CreatedDate >= ${start}
  AND CreatedDate < ${end}
${typeFilter}
ORDER BY CreatedDate DESC
`;
}

function buildDailyOutflowCasesQuery(startDate, endDate, caseType) {
  const { start, end } = buildSalesforceDateRange(startDate, endDate);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT${buildOperationalFlowSelect()}
FROM Case
WHERE Sent_Date2__c >= ${start}
  AND Sent_Date2__c < ${end}
${typeFilter}
ORDER BY Sent_Date2__c DESC
`;
}

function buildLeadOpportunityCaseNumbersQuery(caseNumbers, caseType) {
  const validCaseNumbers = Array.from(
    new Set((caseNumbers || []).map((item) => String(item || "").trim())),
  ).filter(Boolean);

  if (!validCaseNumbers.length) {
    throw Object.assign(new Error("caseNumbers are required"), {
      statusCode: 400,
    });
  }

  const caseNumberList = validCaseNumbers
    .map((caseNumber) => `'${escapeSoqlString(caseNumber)}'`)
    .join(", ");
  const typeFilter = buildOptionalCaseTypeFilter(caseType, "Lead__r.");

  return `
SELECT
  Lead__r.CaseNumber
FROM Lead_de_oportunidad__c
WHERE Lead__r.CaseNumber IN (${caseNumberList})
  AND Lead__r.Substatus__c = 'Signed'
${typeFilter}
`;
}

function buildMonitoringCasesQuery() {
  return `
SELECT 
  CreatedDate,
  CaseNumber,
  FullName__c,
  Phone_Numbercontact__c,
  Email__c,
  Status,
  Substatus__c,
  Tier__c,
  Type,
  Id,
  Supplier_Segment__c,
  Origin,
  Reason_for_Callback__c,
  OwnerId
FROM Case
WHERE Status IN ('In Progress','New')
  AND Origin NOT IN ('Coreg','Coreg CPA','Aged Data')
  AND (
       (Supplier_Segment__c = 'High Quality' 
        AND CreatedDate >= LAST_N_DAYS:90 )
    OR (Supplier_Segment__c != 'High Quality' 
        AND CreatedDate >= LAST_N_DAYS:90 )
      )
`;
}

module.exports = {
  buildMonitoringCasesQuery,
  buildDailyInflowCasesQuery,
  buildDailyOutflowCasesQuery,
  buildLeadOpportunityCaseNumbersQuery,
};
