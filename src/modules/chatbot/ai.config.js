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
          description: "Get cases filtered by status",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string" },
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
          description: "Get cases filtered by Origin",
          parameters: {
            type: "object",
            properties: {
              origin: { type: "string" },
            },
            required: ["origin"],
          },
        },
        {
          name: "getCasesBySupplierSegment",
          description: "Get cases filtered by Supplier Segment",
          parameters: {
            type: "object",
            properties: {
              segment: { type: "string" },
            },
            required: ["segment"],
          },
        },
        {
          name: "getCasesBySubstatus",
          description: "Get cases filtered by Substatus",
          parameters: {
            type: "object",
            properties: {
              substatus: { type: "string" },
            },
            required: ["substatus"],
          },
        },
        {
          name: "getCasesByType",
          description: "Get cases filtered by Type",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string" },
            },
            required: ["type"],
          },
        },
        {
          name: "getCasesGroupedByField",
          description:
            "Group cases by a specific field like Status, Origin, Type or Supplier_Segment__c",
          parameters: {
            type: "object",
            properties: {
              field: { type: "string" },
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
            "Get cases using combined filters such as status, origin, segment, type, substatus and date",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string" },
              origin: { type: "string" },
              segment: { type: "string" },
              type: { type: "string" },
              substatus: { type: "string" },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
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
          description: "Get total attempts of a specific agent",
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string" },
            },
            required: ["agentName"],
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
