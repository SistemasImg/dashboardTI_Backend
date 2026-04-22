const { AzureOpenAI } = require("openai");
const logger = require("../../utils/logger");

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, ""),
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

exports.askModel = async (messages) => {
  try {
    logger.info("Calling Azure OpenAI...");

    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      messages,
      temperature: 0.4,
      max_tokens: 600,
      functions: [
        {
          name: "getCaseByDate",
          description: "Get number of cases by subscription date",
          parameters: {
            type: "object",
            properties: {
              dateFilter: {
                type: "string",
                enum: ["today", "yesterday"],
              },
            },
            required: ["dateFilter"],
          },
        },
        {
          name: "getCaseByNumber",
          description: "Get Salesforce case details by case number",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
            },
            required: ["caseNumber"],
          },
        },
        {
          name: "getCaseByPhone",
          description: "Get case details by phone number",
          parameters: {
            type: "object",
            properties: {
              phone: { type: "string" },
            },
            required: ["phone"],
          },
        },
        {
          name: "getCasesByStatus",
          description:
            "Get cases filtered by status, optionally scoped to a date",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["status"],
          },
        },
        {
          name: "getCasesByDateRange",
          description: "Get cases between two dates",
          parameters: {
            type: "object",
            properties: {
              startDate: { type: "string" },
              endDate: { type: "string" },
            },
            required: ["startDate", "endDate"],
          },
        },
        {
          name: "getCaseByEmail",
          description: "Get case by email",
          parameters: {
            type: "object",
            properties: {
              email: { type: "string" },
            },
            required: ["email"],
          },
        },
        {
          name: "getCasesByOrigin",
          description:
            "Get cases filtered by Origin, optionally scoped to a date",
          parameters: {
            type: "object",
            properties: {
              origin: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["origin"],
          },
        },
        {
          name: "getCasesBySupplierSegment",
          description:
            "Get cases filtered by Supplier Segment, optionally scoped to a date",
          parameters: {
            type: "object",
            properties: {
              segment: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["segment"],
          },
        },
        {
          name: "getCasesBySubstatus",
          description:
            "Get cases filtered by Substatus, optionally scoped to a date",
          parameters: {
            type: "object",
            properties: {
              substatus: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["substatus"],
          },
        },
        {
          name: "getCasesByType",
          description:
            "Get cases filtered by Type, optionally scoped to a date. If user says 'tort', use type='Tort'",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["type"],
          },
        },
        {
          name: "getCasesGroupedByField",
          description:
            "Group and count cases by a single field for a summary across all values. Use ONLY when the user wants a distribution/resumen general, not when they specify a concrete value like Origin=Campaign_p or Type=Rideshare. Valid fields: Status, Origin, Type, Supplier_Segment__c (segment), Substatus__c (substatus). Optionally filter by date.",
          parameters: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: [
                  "Status",
                  "Origin",
                  "Type",
                  "Supplier_Segment__c",
                  "Substatus__c",
                ],
              },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
            },
            required: ["field"],
          },
        },
        {
          name: "getCasesByFilters",
          description:
            "Get detailed case records using one or more concrete filters. Use this for compound queries like status+type, type+origin, segment+substatus, any filter+date, filter+agent, and also when the user specifies a concrete field value such as Origin=Campaign_p, Type=Rideshare, Status=Open. Supports: status, origin, segment (Supplier_Segment__c), type, substatus, agentName, dateKeyword, date (YYYY-MM-DD), startDate+endDate.",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string" },
              origin: { type: "string" },
              segment: {
                type: "string",
                description: "Supplier Segment: Low Quality, Medium, High",
              },
              type: {
                type: "string",
                description: "Case type. If user says 'tort' use 'Tort'",
              },
              substatus: { type: "string" },
              agentName: {
                type: "string",
                description: "Owner/agent name to filter by",
              },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
              startDate: {
                type: "string",
                description: "Start date for a range (YYYY-MM-DD)",
              },
              endDate: {
                type: "string",
                description: "End date for a range (YYYY-MM-DD)",
              },
            },
          },
        },
        {
          name: "getOperationalSummary",
          description:
            "Get operational summary of cases for today or yesterday",
          parameters: {
            type: "object",
            properties: {
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
            },
            required: ["dateKeyword"],
          },
        },
        {
          name: "getCasesByAgent",
          description: "Get cases assigned to a specific agent",
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string" },
            },
            required: ["agentName"],
          },
        },
        {
          name: "getCasesByCallCenter",
          description: "Get cases assigned to a specific call center",
          parameters: {
            type: "object",
            properties: {
              callCenter: { type: "string" },
            },
            required: ["callCenter"],
          },
        },
        {
          name: "getTotalAttemptsByAgent",
          description:
            "Get total attempts of a specific agent from SQL Server, optionally scoped to a date",
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["agentName"],
          },
        },
        {
          name: "getAgentAttemptsByPhonePerHour",
          description:
            "Get attempts per hour for a specific agent and phone number from SQL Server, optionally for a specific date",
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string" },
              phone: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
            required: ["agentName", "phone"],
          },
        },
        {
          name: "getVicidialAgentsStatus",
          description:
            "Get Vicidial realtime agents status, including time in current status. Optional filter by agent name.",
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string" },
            },
          },
        },
        {
          name: "getAttemptsByPhone",
          description:
            "Get call attempts for a phone number. Default to today unless a date or range is requested",
          parameters: {
            type: "object",
            properties: {
              phone: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
              lastDays: {
                type: "integer",
                description:
                  "Use only when user asks for last N days, e.g. 2 or 3",
              },
            },
            required: ["phone"],
          },
        },
        {
          name: "getAttemptsByCaseNumber",
          description:
            "Get attempts history and total attempts for a case number",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
            },
            required: ["caseNumber"],
          },
        },
        {
          name: "getCaseAttemptsByDate",
          description:
            "Get attempts list for cases created on a specific date (today, yesterday or exact date)",
          parameters: {
            type: "object",
            properties: {
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              date: {
                type: "string",
                description: "Specific date in YYYY-MM-DD format",
              },
            },
          },
        },
        {
          name: "getCasesByTypeFromReport",
          description: "Get cases filtered by type from rideshare report",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string" },
            },
            required: ["type"],
          },
        },
      ],
      function_call: "auto",
    });

    return response;
  } catch (error) {
    logger.error("Azure OpenAI error:");
    console.error(error);
    throw new Error("AI_SERVICE_FAILURE");
  }
};
