const logger = require("../../../utils/logger");
const https = require("node:https");
const axios = require("axios");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

exports.processCaseUpdate = async (caseData) => {
  try {
    logger.info("========== START Salesforce → GHL Sync ==========");

    const { substatus, phone } = caseData;

    if (!phone) {
      logger.warn("Skipping sync: phone is missing in Salesforce payload.");
      return {
        status: "skipped",
        reason: "phone_missing",
        message: "Phone is required to find contact in GHL",
      };
    }

    const formattedPhone = phone.startsWith("+") ? phone : `+1${phone}`;

    // 1️⃣ Search for contact in GHL by phone
    const contactResponse = await axios.post(
      "https://services.leadconnectorhq.com/contacts/search",
      {
        locationId: process.env.GHL_LOCATION_ID,
        query: formattedPhone,
        page: 1,
        pageLimit: 10,
      },
      {
        httpsAgent,
        headers: {
          Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      },
    );

    const contact = contactResponse.data.contacts?.[0];

    if (!contact) {
      logger.warn(
        `Skipping sync: contact not found in GHL for phone ${formattedPhone}`,
      );
      return {
        status: "skipped",
        reason: "contact_not_found",
        message: "Contact not found in GHL",
      };
    }

    // 2️⃣ get opportunity from contact in GHL
    const opportunity = contact.opportunities?.[0];

    if (!opportunity) {
      logger.warn(
        `Skipping sync: no opportunity found for contact ${contact.id || "unknown"}`,
      );
      return {
        status: "skipped",
        reason: "opportunity_not_found",
        message: "Opportunity not found for this contact",
      };
    }

    // 3️⃣ Get pipeline stages from GHL and find matching stage for substatus
    const pipelinesResponse = await axios.get(
      "https://services.leadconnectorhq.com/opportunities/pipelines",
      {
        httpsAgent,
        headers: {
          Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
          Version: "2021-07-28",
        },
        params: {
          locationId: process.env.GHL_LOCATION_ID,
        },
      },
    );

    const pipelines = pipelinesResponse.data.pipelines;

    const currentPipeline = pipelines.find(
      (p) => p.id === opportunity.pipelineId,
    );

    if (!currentPipeline) {
      logger.warn(
        `Skipping sync: pipeline ${opportunity.pipelineId} not found in GHL.`,
      );
      return {
        status: "skipped",
        reason: "pipeline_not_found",
        message: "Pipeline not found",
      };
    }

    const stages = currentPipeline.stages;

    const normalizedSubstatus = substatus.trim().toLowerCase();

    const matchedStage = stages.find((stage) => {
      const normalizedStageName = stage.name.trim().toLowerCase();

      return (
        normalizedStageName === normalizedSubstatus ||
        normalizedStageName.includes(normalizedSubstatus) ||
        normalizedSubstatus.includes(normalizedStageName)
      );
    });

    if (!matchedStage) {
      logger.warn(
        `Skipping sync: no matching stage found for substatus '${substatus}'.`,
      );
      return {
        status: "skipped",
        reason: "stage_not_found",
        message: `No matching stage found for substatus: ${substatus}`,
      };
    }

    const stageId = matchedStage.id;

    // 4️⃣ update opportunity in GHL with new stage
    await axios.put(
      `https://services.leadconnectorhq.com/opportunities/${opportunity.id}`,
      {
        pipelineStageId: stageId,
      },
      {
        httpsAgent,
        headers: {
          Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
          Version: "2021-07-28",
        },
      },
    );

    logger.success("Opportunity updated in GHL successfully.");
    logger.info("========== END Salesforce → GHL Sync ==========");

    return {
      status: "updated",
      message: "Opportunity updated in GHL successfully",
    };
  } catch (error) {
    logger.error("========== ERROR Salesforce → GHL Sync ==========");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    } else {
      console.error("Error:", error.message);
    }

    throw error;
  }
};
