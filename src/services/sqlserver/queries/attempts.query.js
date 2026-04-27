function buildAttemptsByDateQuery() {
  return `
SELECT 
    CONVERT(VARCHAR(10), CAST([TIMESTAMP] AS DATE), 23) AS CallDate,
    ANI,
    COUNT(*) AS AttemptsSQL
FROM INTAKE.Call_Records_five9
WHERE [TIMESTAMP] >= DATEADD(DAY, -2, CAST(GETDATE() AS DATE))
 AND (DISPOSITION IS NULL OR DISPOSITION NOT IN ('Inbound Queue Timeout Drop', 'Lead To Be Called', 'Agent Not Available','Inbound After Hours Drop',
'Outbound Pre-Routing Drop','Answering Machine Msg Played','Outbound Auto Dial'))
GROUP BY
    CAST([TIMESTAMP] AS DATE),
    ANI;
`;
}

module.exports = {
  buildAttemptsByDateQuery,
};
