/**
 * Queries for closed cases report filtered by ClosedDate.
 * Three report types: Disqualified, Rejected, and Signed.
 */

function buildClosedDateRange(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const toSoqlDateTime = (value) => value.toISOString().replace(".000", "");

  return {
    start: toSoqlDateTime(start),
    end: toSoqlDateTime(end),
  };
}

function buildSalesforceDayRange(date) {
  const timezone = process.env.SALESFORCE_TIMEZONE || "America/Los_Angeles";
  const input = String(date || "").trim();
  const [year, month, day] = input.split("-").map(Number);

  if (!year || !month || !day) {
    throw Object.assign(new Error("date is required in YYYY-MM-DD format"), {
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
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
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

function buildOptionalCaseTypeFilter(caseType) {
  const normalized = String(caseType || "").trim();
  if (!normalized) return "";

  return `\n  AND Type = '${escapeSoqlString(normalized)}'`;
}

/**
 * Builds a SOQL query for Disqualified cases.
 * Status = 'Closed', Substatus__c = 'Disqualified'
 * Includes Reason_for_DQ__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildDisqualifiedCasesQuery(date, caseType) {
  const { start, end } = buildClosedDateRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c,
  Reason_for_DQ__c
FROM Case
WHERE Status = 'Closed'
  AND Substatus__c = 'Disqualified'
  AND ClosedDate >= ${start}
  AND ClosedDate < ${end}
${typeFilter}
`;
}

/**
 * Builds a SOQL query for Rejected cases.
 * Status = 'Closed', Substatus__c = 'Reject'
 * Includes Reason_for_Doesn_t_meet_criteria__c
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildRejectedCasesQuery(date, caseType) {
  const { start, end } = buildClosedDateRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c,
  Reason_for_Doesn_t_meet_criteria__c
FROM Case
WHERE Status = 'Closed'
  AND Substatus__c = 'Reject'
  AND ClosedDate >= ${start}
  AND ClosedDate < ${end}
${typeFilter}
`;
}

/**
 * Builds a SOQL query for Signed cases via Sent_Date2__c.
 * Status = 'Sent'
 * @param {string} date - ISO date string (YYYY-MM-DD)
 */
function buildSignedCasesBySentDateQuery(date, caseType) {
  const { start, end } = buildSalesforceDayRange(date);
  const typeFilter = buildOptionalCaseTypeFilter(caseType);

  return `
SELECT
  Supplier_Segment__c,
  CaseNumber,
  OwnerId,
  Origin,
  FullName__c,
  Phone_Numbercontact__c,
  Substatus__c,
  Type,
  Tier__c,
  Sent_Date2__c
FROM Case
WHERE Sent_Date2__c >= ${start}
  AND Sent_Date2__c < ${end}
${typeFilter}

`;
}

module.exports = {
  buildDisqualifiedCasesQuery,
  buildRejectedCasesQuery,
  buildSignedCasesBySentDateQuery,
};
