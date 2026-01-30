function buildAttemptsTotalQuery() {
  return `
SELECT 
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''),'(', ''),')', ''),'-', ''),' ', ''),':', '') AS Clean_ANI,
    COUNT(ANI) AS 'Attempts'
FROM INTAKE.Call_Records_five9
WHERE 
    CONVERT(DATE, TIMESTAMP) >= CONVERT(DATE, DATEADD(DAY, -29, GETDATE()))
    AND CONVERT(DATE, TIMESTAMP) <= CONVERT(DATE, GETDATE())
    AND (DISPOSITION IS NULL OR DISPOSITION NOT IN ('Inbound Queue Timeout Drop', 'Lead To Be Called', 'Agent Not Available'))
GROUP BY 
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''),'(', ''),')', ''),'-', ''),' ', ''),':', '');
`;
}

module.exports = {
  buildAttemptsTotalQuery,
};
