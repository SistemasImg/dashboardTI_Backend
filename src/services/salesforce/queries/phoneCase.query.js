function escapeSoqlString(value) {
  const backslash = String.fromCodePoint(92);
  return String(value)
    .split(backslash)
    .join(backslash + backslash)
    .split("'")
    .join(backslash + "'");
}

function buildCasesByPhonesQuery(phoneValues = []) {
  const normalized = [...new Set((phoneValues || []).filter(Boolean))];

  if (!normalized.length) {
    return null;
  }

  const phonesInClause = normalized
    .map((phone) => `'${escapeSoqlString(phone)}'`)
    .join(",");

  return `
SELECT
  CaseNumber,
  Phone_Numbercontact__c,
  Type,
  Status,
  Substatus__c,
  Owner.Name,
  CreatedDate
FROM Case
WHERE Phone_Numbercontact__c IN (${phonesInClause})
ORDER BY CreatedDate DESC
`;
}

module.exports = {
  buildCasesByPhonesQuery,
};
