function buildTimeToLeadFirstContactQuery({
  startDateTime,
  endDateTime,
  phoneVariants = [],
}) {
  const normalizedVariants = [
    ...new Set((phoneVariants || []).filter(Boolean)),
  ];

  if (!normalizedVariants.length) {
    return null;
  }

  const phonesInClause = normalizedVariants
    .map((phone) => `'${phone}'`)
    .join(",");

  return `
SELECT TOP 1
  ANI,
  TIMESTAMP AS ContactTimestamp
FROM INTAKE.Call_Records_five9
WHERE TIMESTAMP >= '${startDateTime}'
  AND TIMESTAMP < '${endDateTime}'
  AND ANI IN (${phonesInClause})
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
ORDER BY TIMESTAMP ASC
`;
}

module.exports = {
  buildTimeToLeadFirstContactQuery,
};
