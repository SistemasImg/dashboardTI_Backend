const logger = require("../../../utils/logger");
const {
  findContactByEmail,
  updateContact,
} = require("../../../services/ghl/salesforce");

const handleGhlWebhook = async (req, res) => {
  try {
    const contact = req.body;
    logger.info(`Incoming GHL webhook received`);
    logger.info(`Processing contact: ${contact?.email}`);

    if (!contact?.email) {
      logger.warn("Email is missing in webhook payload");
      return res.status(400).json({ message: "Email is required" });
    }

    const { records, totalSize, sf } = await findContactByEmail(contact.email);
    if (totalSize > 0) {
      const sfId = records[0].Id;
      logger.info(`Existing contact found in Salesforce`);
      await updateContact(sf, sfId, contact);

      logger.success(`Webhook processed successfully`);
      return res.sendStatus(200);
    } else {
      logger.warn(`Contact not found in Salesforce`);
      return res.status(404).json({
        message: "Contact not found in Salesforce. No action taken.",
      });
    }
  } catch (error) {
    logger.error(
      `Error sending data to Salesforce: ${
        error.response?.data || error.message
      }`,
    );

    res.sendStatus(500);
  }
};

module.exports = {
  handleGhlWebhook,
};
