const axios = require("axios");
const https = require("https");
const logger = require("../../../utils/logger");
const salesforceConfig = require("../../../config/salesforce");
const { authenticateSalesforce } = require("../../salesforce/auth.service");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const findContactByEmail = async (email) => {
  logger.info(`Searching contact in Salesforce by email: ${email}`);

  const sf = await authenticateSalesforce();

  const response = await axios.get(
    `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/query`,
    {
      httpsAgent,
      headers: { Authorization: `Bearer ${sf.accessToken}` },
      params: {
        q: `SELECT Id, Substatus__c FROM Case WHERE Email__c = '${email}'`,
      },
    },
  );

  logger.success(`Salesforce query executed successfully`);

  return {
    records: response.data.records,
    totalSize: response.data.totalSize,
    sf,
  };
};

function mapGhlStageToSalesforceSubstatus(stageName) {
  const map = {
    "VM / No Answer": "VM",
    "TCPA OK": "TCPA OK",
    CALLBACK: "CALLBACK",
  };

  return map[stageName] || stageName;
}

const updateContact = async (sf, contactId, contact) => {
  try {
    logger.info(`Updating Salesforce contact with ID`);

    const salesforceSubstatus = mapGhlStageToSalesforceSubstatus(
      contact.pipleline_stage,
    );

    await axios.patch(
      `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/Case/${contactId}`,
      {
        Substatus__c: salesforceSubstatus,
      },
      {
        httpsAgent,
        headers: { Authorization: `Bearer ${sf.accessToken}` },
      },
    );

    logger.success(`Contact updated successfully in Salesforce`);
  } catch (error) {
    logger.error(`Error updating Salesforce contact`);

    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      logger.error(`No response received: ${error.request}`);
    } else {
      logger.error(`Message: ${error.message}`);
    }

    throw error;
  }
};

module.exports = {
  findContactByEmail,
  updateContact,
};
