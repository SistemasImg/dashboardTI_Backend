const metrics = require("./metrics");
const logger = require("../../utils/logger");
const { askModel } = require("./ai.config");
const { systemPrompt } = require("./prompts");
const excelService = require("./excel.service");
const { DateTime } = require("luxon");

// Simple in-memory session storage
const sessionMemory = {};

// Constant for bulk case threshold
const BULK_THRESHOLD = 3; // If more than 3 cases, generate Excel
const ATTEMPTS_BULK_THRESHOLD = 15;

/**
 * Format a date string to a readable format: DD/MM/YYYY HH:mm
 * @param {String} dateString - ISO date string from Salesforce
 * @returns {String} Formatted date or "N/A" if invalid
 */
function formatDate(dateString) {
  if (!dateString) return "N/A";

  try {
    const date = DateTime.fromISO(dateString);
    if (!date.isValid) return "N/A";

    return date.toFormat("dd/MM/yyyy HH:mm");
  } catch (error) {
    logger.warn(`Error formatting date: ${dateString} - ${error.message}`);
    return "N/A";
  }
}

function detectDateRange(message) {
  const text = message.toLowerCase();

  const today = DateTime.now();
  const todayStr = today.toISODate();
  const yesterdayStr = today.minus({ days: 1 }).toISODate();

  if (text.includes("hoy y ayer")) {
    return {
      startDate: yesterdayStr,
      endDate: todayStr,
    };
  }

  if (text.includes("últimos 2 días") || text.includes("last 2 days")) {
    return {
      startDate: today.minus({ days: 2 }).toISODate(),
      endDate: todayStr,
    };
  }

  if (text.includes("última semana") || text.includes("last week")) {
    return {
      startDate: today.minus({ days: 7 }).toISODate(),
      endDate: todayStr,
    };
  }

  if (text.includes("último mes") || text.includes("last month")) {
    return {
      startDate: today.minus({ days: 30 }).toISODate(),
      endDate: todayStr,
    };
  }

  return null;
}

function isAttemptsQuery(message) {
  const text = message.toLowerCase();
  return (
    text.includes("attempt") ||
    text.includes("intento") ||
    text.includes("llamada") ||
    text.includes("calls")
  );
}

exports.processMessage = async (userMessage, sessionId = "default") => {
  try {
    logger.info(`Incoming chatbot message: ${userMessage}`);

    if (!sessionMemory[sessionId]) {
      sessionMemory[sessionId] = {
        lastFilters: null,
        lastResults: null,
      };
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const response = await askModel(messages);
    const detectedRange = detectDateRange(userMessage);

    if (detectedRange && !isAttemptsQuery(userMessage)) {
      logger.info("Date range detected locally");

      const functionResult = await metrics.sf.getCasesByDateRange(
        detectedRange.startDate,
        detectedRange.endDate,
      );

      const formattedResponse = await formatResult(
        "getCasesByDateRange",
        functionResult,
      );

      return formattedResponse;
    }
    const message = response.choices?.[0]?.message;

    if (!message) throw new Error("AI_INVALID_RESPONSE");

    // 🔥 FUNCTION CALL DETECTED
    if (message.function_call) {
      const functionName = message.function_call.name;

      logger.info(`Function requested: ${functionName}`);

      let args;
      try {
        args = JSON.parse(message.function_call.arguments);
      } catch {
        throw new Error("INVALID_FUNCTION_ARGUMENTS");
      }
      let functionResult;

      switch (functionName) {
        case "getCaseByDate":
          functionResult = await metrics.sf.getCaseByDate(
            args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
          );
          break;

        case "getCaseByNumber":
          functionResult = await metrics.sf.getCaseByNumber(args.caseNumber);
          break;

        case "getCaseByPhone":
          functionResult = await metrics.sf.getCaseByPhone(args.phone);
          break;

        case "getCasesByStatus":
          functionResult = await metrics.sf.getCasesByStatus(args.status);
          break;

        case "getCasesByDateRange":
          functionResult = await metrics.sf.getCasesByDateRange(
            args.startDate,
            args.endDate,
          );
          break;

        case "getCaseByEmail":
          functionResult = await metrics.sf.getCaseByEmail(args.email);
          break;

        case "getCasesByOrigin":
          functionResult = await metrics.sf.getCasesByOrigin(args.origin);
          break;

        case "getCasesBySupplierSegment":
          functionResult = await metrics.sf.getCasesBySupplierSegment(
            args.segment,
          );
          break;

        case "getCasesBySubstatus":
          functionResult = await metrics.sf.getCasesBySubstatus(args.substatus);
          break;

        case "getCasesByType":
          functionResult = await metrics.sf.getCasesByType(args.type);
          break;

        case "getCasesByFilters":
          functionResult = await metrics.sf.getCasesByFilters(args);
          sessionMemory[sessionId].lastFilters = args;
          break;

        case "getCasesGroupedByField":
          functionResult = await metrics.sf.getCasesGroupedByField(
            args.field,
            args.dateKeyword,
          );
          break;

        case "getOperationalSummary":
          functionResult = await metrics.sf.getOperationalSummary(
            args.dateKeyword,
          );
          break;

        case "getCasesByAgent":
          functionResult = await metrics.dashboard.getCasesByAgent(
            args.agentName,
          );
          break;

        case "getCasesByCallCenter":
          functionResult = await metrics.dashboard.getCasesByCallCenter(
            args.callCenter,
          );
          break;

        case "getTotalAttemptsByAgent":
          functionResult = await metrics.dashboard.getTotalAttemptsByAgent(
            args.agentName,
          );
          break;

        case "getAttemptsByPhone":
          functionResult = await metrics.sql.getAttemptsByPhone(args.phone, {
            dateKeyword: args.dateKeyword,
            date: args.date,
            lastDays: args.lastDays,
          });
          break;

        case "getAttemptsByCaseNumber":
          functionResult = await metrics.sql.getAttemptsByCaseNumber(
            args.caseNumber,
          );
          break;

        case "getCaseAttemptsByDate":
          functionResult = await metrics.sql.getCaseAttemptsByDate({
            dateKeyword: args.dateKeyword,
            date: args.date,
          });
          break;

        case "getCasesByTypeFromReport":
          functionResult = await metrics.dashboard.getCasesByTypeFromReport(
            args.type,
          );
          break;

        default:
          throw new Error("UNKNOWN_FUNCTION");
      }

      sessionMemory[sessionId].lastResults = functionResult;

      const formattedResponse = await formatResult(
        functionName,
        functionResult,
      );
      return formattedResponse;
    }

    // 🟢 Normal conversation
    return { message: message.content };
  } catch (error) {
    logger.error(`Chatbot processing error: ${error.message}`);

    switch (error.message) {
      case "AI_SERVICE_FAILURE":
        return {
          message: "The artificial intelligence service is not available.",
        };

      case "INVALID_FUNCTION_ARGUMENTS":
        return { message: "There was a problem processing the request." };

      case "INVALID_PHONE":
        return {
          message: "Please provide a valid phone number to check attempts.",
        };

      case "INVALID_DATE_FORMAT":
        return {
          message: "Please provide a valid date in YYYY-MM-DD format.",
        };

      default:
        return { message: "An unexpected error occurred." };
    }
  }
};

async function formatResult(type, data) {
  if (!data) return { message: "No results found." };

  if (type === "getAttemptsByPhone") {
    return await formatAttemptsByPhoneResult(data);
  }

  if (type === "getAttemptsByCaseNumber") {
    return await formatAttemptsByCaseNumberResult(data);
  }

  if (type === "getCaseAttemptsByDate") {
    return await formatCaseAttemptsByDateResult(data);
  }

  // Single case - show full details
  if (type === "getCaseByNumber") {
    return {
      message: `
📌 **Case: ${data.CaseNumber}**
• **Status:** ${data.Status}
• **Substatus:** ${data.Substatus__c}
• **Type:** ${data.Type}
• **Origin:** ${data.Origin}
• **Supplier Segment:** ${data.Supplier_Segment__c}
• **Owner:** ${data.Owner?.Name}
• **Created:** ${formatDate(data.CreatedDate)}
`,
    };
  }

  // Multiple cases - determine if bulk or not
  let casesArray = [];
  let totalCount = 0;

  if (data.records && Array.isArray(data.records)) {
    casesArray = data.records;
    totalCount = data.total || data.records.length;
  } else if (Array.isArray(data)) {
    casesArray = data;
    totalCount = data.length;
  } else if (data.summary) {
    // Operational summary
    return {
      message: `
📊 **Operational Summary**

• **Total:** ${data.summary.total}

**By Status:**
${formatSummary(data.summary.byStatus)}

**By Origin:**
${formatSummary(data.summary.byOrigin)}

**By Segment:**
${formatSummary(data.summary.bySegment)}
`,
    };
  }

  // If cases exist, determine if bulk
  if (casesArray.length > 0) {
    // BULK CASES: Generate Excel
    if (casesArray.length > BULK_THRESHOLD) {
      try {
        const excelFile = await Promise.resolve(
          excelService.generateCasesExcel(casesArray),
        );

        return {
          message: `
📊 **Bulk Results Found**

✅ A total of **${totalCount} cases** were found.

Due to the number of records, I have prepared a complete Excel file with all the details for you to download and analyze:

📥 **File:** ${excelFile.fileName}

The file contains:
• Case Number
• Status and Substatus
• Case Type
• Origin
• Supplier Segment
• Assigned Owner
• Contact Information
• And more details...
`,
          excelFile,
        };
      } catch (error) {
        logger.error(`Error generating Excel: ${error.message}`);
        // Fallback: show first cases in chat
        return {
          message: formatSmallResultSet(casesArray, totalCount),
        };
      }
    }

    // SMALL SET: Show in chat
    return {
      message: formatSmallResultSet(casesArray, totalCount),
    };
  }

  return { message: "No results found." };
}

/**
 * Formats a small result set for chat display
 */
function formatSmallResultSet(casesArray, totalCount) {
  let output = `📋 **Total Cases: ${totalCount}**\n\n`;

  casesArray.slice(0, 20).forEach((caseItem, i) => {
    output += `${i + 1}. **${caseItem.CaseNumber}** | ${caseItem.Substatus__c} | ${caseItem.Owner?.Name || "Unassigned"}\n`;
  });

  return output;
}

/**
 * Formats a summary into a readable structure
 */
function formatSummary(summaryObj) {
  if (!summaryObj) return "N/A";

  return Object.entries(summaryObj)
    .map(([key, value]) => `  • ${key}: ${value}`)
    .join("\n");
}

async function formatAttemptsByPhoneResult(data) {
  if (!data?.records?.length) {
    return {
      message: `No attempts found for phone **${data.phone}** in the requested period.`,
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((row) => ({
        phone: data.phone,
        call_date: row.call_date,
        attempts: row.attempts,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(excelRows),
      );

      return {
        message: `
📞 **Phone:** ${data.phone}
• **Total Attempts:** ${data.totalAttempts}
• **Days with records:** ${data.totalDays}

The result is extensive, so I generated an Excel file with full attempt details.

📥 **File:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 30)
    .map((row, idx) => `${idx + 1}. ${row.call_date}: ${row.attempts} attempts`)
    .join("\n");

  const scopeLabel =
    data.scope === "all" ? "all available dates" : data.scopeLabel;

  return {
    message: `
📞 **Phone:** ${data.phone}
• **Total Attempts:** ${data.totalAttempts}
• **Days with records:** ${data.totalDays}
• **Scope:** ${scopeLabel}

**Attempts by date:**
${lines}
`,
  };
}

async function formatAttemptsByCaseNumberResult(data) {
  if (!data) {
    return { message: "No case found with that case number." };
  }

  if (!data.phone) {
    return {
      message: `
📌 **Case:** ${data.caseNumber}
No phone number is associated with this case, so attempts cannot be calculated.
`,
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((row) => ({
        CaseNumber: data.caseNumber,
        phone: data.phone,
        call_date: row.call_date,
        attempts: row.attempts,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(excelRows),
      );

      return {
        message: `
📌 **Case:** ${data.caseNumber}
📞 **Phone:** ${data.phone}
• **Total Attempts:** ${data.totalAttempts}
• **Days with records:** ${data.totalDays}

The result is extensive, so I generated an Excel file with the full attempts history.

📥 **File:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = (data.records || [])
    .slice(0, 30)
    .map((row, idx) => `${idx + 1}. ${row.call_date}: ${row.attempts} attempts`)
    .join("\n");

  return {
    message: `
📌 **Case:** ${data.caseNumber}
📞 **Phone:** ${data.phone}
• **Total Attempts:** ${data.totalAttempts}
• **Days with records:** ${data.totalDays}

${lines ? `**Attempts by date:**\n${lines}` : "No attempts found for this case phone."}
`,
  };
}

async function formatCaseAttemptsByDateResult(data) {
  if (!data?.records?.length) {
    return { message: `No cases found for ${data.date}.` };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(data.records),
      );

      return {
        message: `
📅 **Date:** ${data.date}
• **Total Cases:** ${data.totalCases}
• **Total Attempts:** ${data.totalAttempts}

The list is extensive, so I generated an Excel file with full attempt details by case.

📥 **File:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 40)
    .map(
      (item, idx) =>
        `${idx + 1}. **${item.CaseNumber}** | attempts: ${item.attempts} | phone: ${item.phone || "N/A"}`,
    )
    .join("\n");

  return {
    message: `
📅 **Date:** ${data.date}
• **Total Cases:** ${data.totalCases}
• **Total Attempts:** ${data.totalAttempts}

**Case Attempts List:**
${lines}
`,
  };
}
