/**
 * Build query to get agents attempts for a specific date
 * @param {String} date - Date in format YYYY-MM-DD (optional, defaults to today)
 * @returns {String} SQL query string
 */
function buildAgentsAttemptsQuery(date = null) {
  // If no date provided, use today's date
  const dateFilter = date ? `'${date}'` : "CONVERT(DATE, GETDATE())";
  
  return `
SELECT 
    CONVERT(DATE, TIMESTAMP) AS [DATE], 
    DATEPART(HOUR, TIMESTAMP) AS [HOUR],
	CASE
		WHEN [AGENT NAME] LIKE 'ABC %' THEN 'ABC'
		WHEN [AGENT NAME] LIKE 'IMG %' THEN 'IMG'
		WHEN [AGENT NAME] LIKE 'VDM %' THEN 'VDM'
		WHEN [AGENT NAME] LIKE 'CZX %' THEN 'CZX'
		WHEN [AGENT NAME] = 'Naibi Jaimes' THEN 'IMG'
		WHEN [AGENT NAME] = 'Aleida Novelo' THEN 'ABC'
		WHEN [AGENT NAME] = 'Diego Paredes' THEN 'IMG'
		ELSE 'Otro'
	END AS 'CALL CENTER',
    CASE
			WHEN [AGENT NAME] LIKE 'ABC %' THEN SUBSTRING([AGENT NAME], 5, LEN([AGENT NAME]))
			WHEN [AGENT NAME] LIKE 'IMG %' THEN SUBSTRING([AGENT NAME], 5, LEN([AGENT NAME]))
			WHEN [AGENT NAME] LIKE 'CZX %' THEN SUBSTRING([AGENT NAME], 5, LEN([AGENT NAME]))
			WHEN [AGENT NAME] LIKE 'VDM %' THEN SUBSTRING([AGENT NAME], 5, LEN([AGENT NAME]))
        ELSE [AGENT NAME]
		END AS [AGENT NAME],
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''), '(', ''), ')', ''), '-', ''), ' ', ''), ':', '') AS [PHONE NUMBER],
	COUNT(ANI) AS ATTEMPTS
FROM imgdb.INTAKE.Call_Records_five9
WHERE CONVERT(DATE, TIMESTAMP) = CONVERT(DATE, ${dateFilter})
AND (DISPOSITION IS NULL OR DISPOSITION NOT IN ('Inbound Queue Timeout Drop', 'Lead To Be Called', 'Agent Not Available','Inbound After Hours Drop',
'Outbound Pre-Routing Drop','Answering Machine Msg Played','Outbound Auto Dial'))
GROUP BY CONVERT(DATE, TIMESTAMP), DATEPART(HOUR, TIMESTAMP), [AGENT NAME], REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ANI, '+1', ''), '(', ''), ')', ''), '-', ''), ' ', ''), ':', '')
`;
}

module.exports = {
  buildAgentsAttemptsQuery,
};

// WHERE CONVERT(DATE, TIMESTAMP) = CONVERT(DATE, GETDATE())

//WHERE CONVERT(DATE, TIMESTAMP) = CONVERT(DATE, DATEADD(DAY, -1, GETDATE()))
