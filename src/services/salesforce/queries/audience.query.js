function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildTypeInClause(types) {
  const normalized = [...new Set((types || []).map((item) => item.trim()))];
  const quoted = normalized.map((item) => `'${escapeSoqlString(item)}'`);
  return quoted.join(",");
}

function buildAudiencePendingCasesQuery(types) {
  const typeInClause = buildTypeInClause(types);

  return `
SELECT
  FirstName__c,
  Last_Name__c,
  Phone_Numbercontact__c,
  Email__c,
  Type,
  OwnerId
FROM Case
WHERE Type IN (${typeInClause})
  AND CreatedDate = LAST_N_DAYS:21
  AND Substatus__c IN ('Busy', 'No Answer', 'VM', 'Dead Air', 'TCPA OK')
  AND Origin NOT IN ('Aged Data')
`;
}

function buildAudienceNonResponsiveQuery(types) {
  const typeInClause = buildTypeInClause(types);
  const hasRideshare = (types || []).some(
    (item) => item.trim().toLowerCase() === "rideshare",
  );

  return `
SELECT
  FirstName__c,
  Last_Name__c,
  Phone_Numbercontact__c,
  Email__c,
  Type,
  OwnerId
FROM Case
WHERE Type IN (${typeInClause})
  ${hasRideshare ? "AND Tier__c IN ('9','10')" : ""}
  AND Substatus__c IN ('Reject')
  AND Reason_for_Rejection__c IN ('NON-RESPONSIVE')
`;
}

function buildAudienceUsersQuery() {
  return `
SELECT
  Id,
  Name
FROM User
`;
}

module.exports = {
  buildAudiencePendingCasesQuery,
  buildAudienceNonResponsiveQuery,
  buildAudienceUsersQuery,
};
