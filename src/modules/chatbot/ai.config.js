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
            "Get detailed case records using one or more concrete filters. Use this for compound queries like status+type, type+tier, type+origin, segment+substatus, any filter+date, filter+agent, and also when the user specifies a concrete field value such as Origin=Campaign_p, Type=Rideshare, Status=Open. Supports: status, origin, segment (Supplier_Segment__c), type, tier (Tier__c), substatus, agentName, dateKeyword, period=last_month, date (YYYY-MM-DD), startDate+endDate. If no date scope is provided, defaults to today.",
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
              tier: {
                type: "string",
                description:
                  "Tier version from Salesforce Tier__c, e.g. 9, 10, Tier9, Tier 10",
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
              period: {
                type: "string",
                enum: ["last_month"],
                description: "Relative period filter for last 30 days",
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
          name: "getVendorsWithLeads",
          description:
            "Get all vendors (Owner) that sent leads, optionally filtered by date scope (today, yesterday, last month, specific date, or date range)",
          parameters: {
            type: "object",
            properties: {
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              period: {
                type: "string",
                enum: ["last_month"],
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
          name: "getTopVendors",
          description:
            "Get top vendors (Owner) ranked by number of leads, optionally filtered by date scope. Supports highest or lowest ranking.",
          parameters: {
            type: "object",
            properties: {
              limit: {
                type: "integer",
                description: "Top N vendors, default 10",
              },
              sort: {
                type: "string",
                enum: ["highest", "lowest"],
                description:
                  "Use highest for most leads, lowest for least leads",
              },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              period: {
                type: "string",
                enum: ["last_month"],
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
          name: "getTopVendorsWithCaseDetails",
          description:
            "Get top vendors (Owner) with detailed lead list including CaseNumber and phone, optionally filtered by date scope",
          parameters: {
            type: "object",
            properties: {
              limit: {
                type: "integer",
                description: "Top N vendors, default 5",
              },
              sort: {
                type: "string",
                enum: ["highest", "lowest"],
                description:
                  "Use highest for most leads, lowest for least leads",
              },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              period: {
                type: "string",
                enum: ["last_month"],
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
          name: "getVendorsBySupplierSegment",
          description:
            "Get vendors (Owner) that belong to a specific supplier segment (High Quality, Medium, Low Quality), optionally filtered by date scope",
          parameters: {
            type: "object",
            properties: {
              segment: {
                type: "string",
                description:
                  "Supplier segment filter: High Quality, Medium, Low Quality",
              },
              dateKeyword: {
                type: "string",
                enum: ["today", "yesterday"],
              },
              period: {
                type: "string",
                enum: ["last_month"],
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
            required: ["segment"],
          },
        },
        {
          name: "getVendorLeadAttempts",
          description:
            "Get attempts by lead for a specific vendor (Owner). Returns case number, phone, attempts per lead, and hourly detail when the user asks for today, yesterday, or a specific date. Supports date filters.",
          parameters: {
            type: "object",
            properties: {
              vendorName: {
                type: "string",
                description: "Vendor owner name",
              },
              includeAgentDetails: {
                type: "boolean",
                description:
                  "Set to true only if the user explicitly asks to see the agent name and call center for each attempt record",
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
            required: ["vendorName"],
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
            "Get call attempts for a phone number. Default behavior is full history unless a date or range is requested",
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
            "Get call attempts for a case number. Supports date filters (today, yesterday, exact date, or last N days). Default is full history when no date filter is provided",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
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
        {
          name: "getCaseDisqualificationReason",
          description:
            "Get the disqualification reason for a case. Use when the user asks why a case was disqualified or rejected. Returns Reason_for_DQ__c, Reason_for_Doesn_t_meet_criteria__c, BPO__c (call center), and BPO_Intaker__c (intaker). No date restriction.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: {
                type: "string",
                description: "The CaseNumber to look up",
              },
            },
            required: ["caseNumber"],
          },
        },
        {
          name: "getAssignedAgentByCaseNumber",
          description:
            "Get the agent currently assigned to a case in the dashboard (MySQL). Use when the user asks which agent has a case assigned, who is handling a case, or who has a case in the dashboard. Requires a case number.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: {
                type: "string",
                description:
                  "The case number to look up the assigned agent for",
              },
            },
            required: ["caseNumber"],
          },
        },
        {
          name: "prepareT9RidesharePayload",
          description:
            "Prepare the JSON payload for T9 Rideshare (Phillips Law Group) using a Salesforce case number, tort, tier, and optional attachments.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
              tort: {
                type: "string",
                description: "Tort/campaign name, e.g. Rideshare",
              },
              tier: {
                type: "string",
                description: "Tier value (T9, Tier 9, or 9)",
              },
              attachments: {
                type: "array",
                description:
                  "Optional attachment list. Use only when user provides files.",
                items: {
                  type: "object",
                  properties: {
                    fileName: { type: "string" },
                    mimeType: { type: "string" },
                    fileBase64: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["fileName", "fileBase64"],
                },
              },
            },
            required: ["caseNumber", "tort", "tier"],
          },
        },
        {
          name: "sendT9RidesharePayload",
          description:
            "Send T9 Rideshare payload to the configured client API endpoint. Requires case number, tort, tier, and uploaded files for this tier.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
              tort: {
                type: "string",
                description: "Tort/campaign name, e.g. Rideshare",
              },
              tier: {
                type: "string",
                description: "Tier value (T9, Tier 9, or 9)",
              },
              attachments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    fileName: { type: "string" },
                    mimeType: { type: "string" },
                    fileBase64: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["fileName", "fileBase64"],
                },
              },
            },
            required: ["caseNumber", "tort", "tier"],
          },
        },
        {
          name: "prepareBardPortT2Payload",
          description:
            "Prepare the JSON payload for Wilens Law - Bard Port T2 using a Salesforce case number, tort, and tier. This tier does not require files.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
              tort: {
                type: "string",
                description: "Tort/campaign name, e.g. Bard Port",
              },
              tier: {
                type: "string",
                description: "Tier value (T2, Tier 2, or 2)",
              },
            },
            required: ["caseNumber", "tort", "tier"],
          },
        },
        {
          name: "sendBardPortT2Payload",
          description:
            "Send Bard Port T2 payload to Wilens Law LeadProsper API endpoint. Use for requests like send API/PI for Bard/Bart Port T2 with a case number. No files required for this tier.",
          parameters: {
            type: "object",
            properties: {
              caseNumber: { type: "string" },
              tort: {
                type: "string",
                description: "Tort/campaign name, e.g. Bard Port",
              },
              tier: {
                type: "string",
                description: "Tier value (T2, Tier 2, or 2)",
              },
            },
            required: ["caseNumber", "tort", "tier"],
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
