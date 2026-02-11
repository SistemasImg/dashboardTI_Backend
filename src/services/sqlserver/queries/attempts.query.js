function buildAttemptsByDateQuery() {
  return `
SELECT 
    CAST([TIMESTAMP] AS DATE) AS CallDate,
    ANI,
    COUNT(*) AS AttemptsSQL
FROM INTAKE.Call_Records_five9
WHERE [TIMESTAMP] >= DATEADD(DAY, -2, CAST(GETDATE() AS DATE))
  AND (
        DISPOSITION IS NULL
        OR DISPOSITION NOT IN (
            'Inbound Queue Timeout Drop',
            'Lead To Be Called',
            'Agent Not Available'
        )
      )
GROUP BY
    CAST([TIMESTAMP] AS DATE),
    ANI;
`;
}

module.exports = {
  buildAttemptsByDateQuery,
};
