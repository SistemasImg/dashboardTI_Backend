const { AzureOpenAI } = require("openai");
const logger = require("../../utils/logger");
const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, ""),
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  httpsAgent,
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
