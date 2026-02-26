const logger = require("../../../utils/logger");
const https = require("https");
const axios = require("axios");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

exports.processCaseUpdate = async (caseData) => {
  try {
    logger.info("========== START Salesforce → GHL Sync ==========");

    const { substatus, phone } = caseData;

    if (!phone) {
      throw new Error("Phone is required to find contact in GHL");
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
      throw new Error("Contact not found in GHL");
    }

    // 2️⃣ get opportunity from contact in GHL
    const opportunity = contact.opportunities?.[0];

    if (!opportunity) {
      throw new Error("Opportunity not found for this contact");
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
      throw new Error("Pipeline not found");
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
      throw new Error(`No matching stage found for substatus: ${substatus}`);
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
