const metrics = require("./metrics");
const logger = require("../../utils/logger");
const { askModel } = require("./ai.config");
const { systemPrompt } = require("./prompts");

// Simple in-memory session storage
const sessionMemory = {};

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

        case "getCasesByTypeFromReport":
          functionResult = await metrics.dashboard.getCasesByTypeFromReport(
            args.type,
          );
          break;

        default:
          throw new Error("UNKNOWN_FUNCTION");
      }

      sessionMemory[sessionId].lastResults = functionResult;

      return formatResult(functionName, functionResult);
    }

    // 🟢 Normal conversation
    return message.content;
  } catch (error) {
    logger.error(`Chatbot processing error: ${error.message}`);

    switch (error.message) {
      case "AI_SERVICE_FAILURE":
        return "El servicio de inteligencia artificial no está disponible.";

      case "INVALID_FUNCTION_ARGUMENTS":
        return "Hubo un problema procesando la solicitud.";

      default:
        return "Ocurrió un error inesperado.";
    }
  }
};

function formatResult(type, data) {
  if (!data) return "No se encontraron resultados.";

  if (type === "getCaseByNumber") {
    return `
📌 Case: ${data.CaseNumber}
Status: ${data.Status}
Substatus: ${data.Substatus__c}
Type: ${data.Type}
Origin: ${data.Origin}
Segment: ${data.Supplier_Segment__c}
Owner: ${data.Owner?.Name}
Created: ${data.CreatedDate}
`;
  }

  if (data.records) {
    let output = `Total: ${data.total}\n\n`;

    data.records.slice(0, 20).forEach((c, i) => {
      output += `${i + 1}. ${c.CaseNumber} | ${c.Substatus__c} | ${c.Owner?.Name}\n`;
    });

    return output;
  }

  if (Array.isArray(data)) {
    let output = `Total: ${data.length}\n\n`;

    data.slice(0, 20).forEach((c, i) => {
      output += `${i + 1}. ${c.CaseNumber} | ${c.Substatus__c} | ${c.Owner?.Name}\n`;
    });

    return output;
  }

  if (data.summary) {
    return `
📊 Operational Summary

Total: ${data.summary.total}

By Status:
${JSON.stringify(data.summary.byStatus, null, 2)}

By Origin:
${JSON.stringify(data.summary.byOrigin, null, 2)}

By Segment:
${JSON.stringify(data.summary.bySegment, null, 2)}
`;
  }

  return "Operación completada.";
}
