function buildTimeToLeadFirstContactQuery(
  startDate,
  endDate,
  phoneNumbers = [],
) {
  const normalizedPhones = [...new Set((phoneNumbers || []).filter(Boolean))];

  if (!normalizedPhones.length) {
    return null;
  }

  const phonesInClause = normalizedPhones
    .map((phone) => `'${phone}'`)
    .join(",");

  return `
SELECT
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''), '(', ''), ')', ''), '-', ''), ' ', ''), ':', '') AS CleanANI,
  TIMESTAMP AS ContactTimestamp
FROM INTAKE.Call_Records_five9
WHERE CONVERT(DATE, TIMESTAMP) >= '${startDate}'
  AND CONVERT(DATE, TIMESTAMP) <= '${endDate}'
  AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''), '(', ''), ')', ''), '-', ''), ' ', ''), ':', '') IN (${phonesInClause})
  AND (
    DISPOSITION IS NULL
    OR DISPOSITION NOT IN (
      'Inbound Queue Timeout Drop',
      'Lead To Be Called',
      'Agent Not Available',
      'Inbound After Hours Drop',
      'Outbound Pre-Routing Drop',
      'Answering Machine Msg Played',
      'Outbound Auto Dial'
    )
  )
ORDER BY
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''), '(', ''), ')', ''), '-', ''), ' ', ''), ':', ''),
  TIMESTAMP ASC
`;
}

module.exports = {
  buildTimeToLeadFirstContactQuery,
};
