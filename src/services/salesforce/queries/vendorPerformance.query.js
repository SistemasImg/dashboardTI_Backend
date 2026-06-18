function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildInClause(values) {
  const normalized = [...new Set((values || []).filter(Boolean))];
  if (!normalized.length) return "";

  return normalized.map((item) => `'${escapeSoqlString(item)}'`).join(",");
}

function buildVendorCasesAggregateQuery(ownerIds = [], lastDays = 90) {
  const inClause = buildInClause(ownerIds);
  if (!inClause) return null;

  return `
SELECT
  OwnerId,
  Type,
  COUNT(Id)
FROM Case
WHERE OwnerId IN (${inClause})
  AND CreatedDate = LAST_N_DAYS:${Number(lastDays)}
GROUP BY OwnerId, Type
`;
}

function buildVendorCasesByTypeTierAggregateQuery(
  ownerIds = [],
  lastDays = 90,
) {
  const inClause = buildInClause(ownerIds);
  if (!inClause) return null;

  return `
SELECT
  OwnerId,
  Type,
  Tier__c,
  COUNT(Id)
FROM Case
WHERE OwnerId IN (${inClause})
  AND CreatedDate = LAST_N_DAYS:${Number(lastDays)}
GROUP BY OwnerId, Type, Tier__c
`;
}

function buildVendorSignedCasesAggregateQuery(ownerIds = [], lastDays = 90) {
  const inClause = buildInClause(ownerIds);
  if (!inClause) return null;

  return `
SELECT
  OwnerId,
  COUNT(Id)
FROM Case
WHERE OwnerId IN (${inClause})
  AND CreatedDate = LAST_N_DAYS:${Number(lastDays)}
  AND Signed_Date__c != NULL
GROUP BY OwnerId
`;
}

function buildVendorCaseNumbersByTypeQuery(
  ownerIds = [],
  lastDays = 90,
  options = {},
) {
  const inClause = buildInClause(ownerIds);
  if (!inClause) return null;

  const includeCustomSubStatus = options.includeCustomSubStatus !== false;
  const customSubStatusField =
    String(options.customSubStatusField || "Substatus__c").trim() ||
    "Substatus__c";
  const selectFields = [
    "  Id",
    "  OwnerId",
    "  Type",
    "  CaseNumber",
    "  CreatedDate",
    "  Signed_Date__c",
    "  Status",
  ];

  if (includeCustomSubStatus) {
    selectFields.push(`  ${customSubStatusField}`);
  }

  return `
SELECT
${selectFields.join(",\n")}
FROM Case
WHERE OwnerId IN (${inClause})
  AND CreatedDate = LAST_N_DAYS:${Number(lastDays)}
  AND CaseNumber != NULL
ORDER BY CreatedDate DESC
`;
}

function buildVendorCaseSnapshotsQuery(
  ownerIds = [],
  lastDays = 90,
  options = {},
) {
  const inClause = buildInClause(ownerIds);
  if (!inClause) return null;

  const createdDateFilter = options.createdDateFrom
    ? `CreatedDate >= ${options.createdDateFrom}`
    : `CreatedDate = LAST_N_DAYS:${Number(lastDays)}`;
  const signedDateFilter = options.signedDateFrom
    ? `Signed_Date__c >= ${options.signedDateFrom}`
    : `Signed_Date__c = LAST_N_DAYS:${Number(lastDays)}`;

  return `
SELECT
  Id,
  OwnerId,
  Type,
  CaseNumber,
  CreatedDate,
  Signed_Date__c,
  Sent_Date2__c,
  Status,
  Substatus__c
FROM Case
WHERE OwnerId IN (${inClause})
  AND CaseNumber != NULL
  AND (
    ${createdDateFilter}
    OR ${signedDateFilter}
  )
ORDER BY CreatedDate DESC
`;
}

module.exports = {
  buildVendorCasesAggregateQuery,
  buildVendorCasesByTypeTierAggregateQuery,
  buildVendorSignedCasesAggregateQuery,
  buildVendorCaseNumbersByTypeQuery,
  buildVendorCaseSnapshotsQuery,
};
