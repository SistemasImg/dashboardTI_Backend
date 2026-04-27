const logger = require("../../utils/logger");
const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const { runSoqlQuery } = require("../../services/salesforce/client.service");
const {
  buildAudiencePendingCasesQuery,
  buildAudienceNonResponsiveQuery,
  buildAudienceUsersQuery,
} = require("../../services/salesforce/queries/audience.query");
const {
  dispatchAudienceToMailchimp,
} = require("../../services/mailchimp/mailchimp.service");
const {
  dispatchAudienceToInfobip,
} = require("../../services/infobit/audience.service");

function toUpperSafe(value) {
  return value ? String(value).toUpperCase() : "";
}

function normalizePhoneWithCountryCode(value) {
  const digits = String(value || "").replaceAll(/\D/g, "");
  if (!digits) return "";

  // Keep the same behavior as the Python script: prefix with "1".
  return digits.startsWith("1") ? digits : `1${digits}`;
}

function normalizeCaseRecord(record) {
  return {
    firstName: toUpperSafe(record.FirstName__c),
    lastName: toUpperSafe(record.Last_Name__c),
    phoneNumber: normalizePhoneWithCountryCode(record.Phone_Numbercontact__c),
    email: record.Email__c || "",
    type: record.Type || "",
    ownerId: record.OwnerId || null,
  };
}

function normalizeSupplier(name) {
  if (!name) return null;
  return name === "International Media Group" ? "Marketing Digital" : name;
}

function attachSupplier(records, usersMap) {
  return records.map((item) => ({
    firstName: item.firstName,
    lastName: item.lastName,
    phoneNumber: item.phoneNumber,
    email: item.email,
    type: item.type,
    supplier: normalizeSupplier(usersMap.get(item.ownerId)) || null,
  }));
}

function buildGroupSummary(groupData) {
  if (!groupData) return null;

  return {
    total: groupData.total,
    sent: groupData.sent,
    failed: groupData.failed,
    types: groupData.types,
    trackingLabel: groupData.trackingLabel,
  };
}

function populateSmsGroupSummary(summary, infobipResponse) {
  if (infobipResponse?.status !== "processed") return;
  if (!infobipResponse?.pending || !infobipResponse?.unresponsive) return;

  summary.sms.pending = buildGroupSummary(infobipResponse.pending);
  summary.sms.unresponsive = buildGroupSummary(infobipResponse.unresponsive);
}

function populateEmailGroupSummary(summary, mailchimpResponse) {
  if (mailchimpResponse?.status !== "processed") return;
  if (!mailchimpResponse?.pending || !mailchimpResponse?.unresponsive) return;

  summary.email.pending = {
    ...buildGroupSummary(mailchimpResponse.pending),
    segmentId: mailchimpResponse.pending.segmentId,
    campaignId: mailchimpResponse.pending.campaignId,
  };
  summary.email.unresponsive = {
    ...buildGroupSummary(mailchimpResponse.unresponsive),
    segmentId: mailchimpResponse.unresponsive.segmentId,
    campaignId: mailchimpResponse.unresponsive.campaignId,
  };
}

function validateParams(normalizedTypes, sms, mail, pending, unresponsive) {
  if (!normalizedTypes.length) {
    const error = new Error("Debe enviar al menos un type");
    error.status = 400;
    throw error;
  }

  if (!sms && !mail) {
    const error = new Error("Debe enviar sms o mail en true");
    error.status = 400;
    throw error;
  }

  if (!pending && !unresponsive) {
    const error = new Error("Debe enviar pending o unresponsive en true");
    error.status = 400;
    throw error;
  }
}

async function fetchSalesforceRecords(
  sf,
  normalizedTypes,
  pending,
  unresponsive,
) {
  const [pendingRaw, nonResponsiveRaw, usersRaw] = await Promise.all([
    pending
      ? runSoqlQuery(sf, buildAudiencePendingCasesQuery(normalizedTypes))
      : Promise.resolve([]),
    unresponsive
      ? runSoqlQuery(sf, buildAudienceNonResponsiveQuery(normalizedTypes))
      : Promise.resolve([]),
    runSoqlQuery(sf, buildAudienceUsersQuery()),
  ]);

  return { pendingRaw, nonResponsiveRaw, usersRaw };
}

async function dispatchChannels(
  result,
  { pendingRecords, unresponsiveRecords, normalizedTypes, sms, mail },
) {
  result.integrations = {};

  if (sms) {
    result.integrations.infobip = await dispatchAudienceToInfobip({
      pendingContacts: pendingRecords,
      unresponsiveContacts: unresponsiveRecords,
      types: normalizedTypes,
    });
    populateSmsGroupSummary(result.summary, result.integrations.infobip);
  }

  if (mail) {
    result.integrations.mailchimp = await dispatchAudienceToMailchimp({
      pendingContacts: pendingRecords,
      unresponsiveContacts: unresponsiveRecords,
      types: normalizedTypes,
    });
    populateEmailGroupSummary(result.summary, result.integrations.mailchimp);
  }
}

async function getSalesforceAudienceExport({
  types,
  sms = true,
  mail = true,
  pending = true,
  unresponsive = true,
}) {
  logger.info(
    "SalesforceAudienceExport → getSalesforceAudienceExport() started",
  );

  try {
    const normalizedTypes = [
      ...new Set((types || []).map((item) => item.trim())),
    ];
    validateParams(normalizedTypes, sms, mail, pending, unresponsive);

    const sf = await authenticateSalesforce();
    const { pendingRaw, nonResponsiveRaw, usersRaw } =
      await fetchSalesforceRecords(sf, normalizedTypes, pending, unresponsive);

    const usersMap = new Map(usersRaw.map((user) => [user.Id, user.Name]));
    const pendingRecords = attachSupplier(
      pendingRaw.map(normalizeCaseRecord),
      usersMap,
    );
    const unresponsiveRecords = attachSupplier(
      nonResponsiveRaw.map(normalizeCaseRecord),
      usersMap,
    );

    const result = {
      generatedAt: new Date().toISOString(),
      requestedTypes: normalizedTypes,
      channels: { sms, mail },
      groups: { pending, unresponsive },
      summary: {
        sms: sms
          ? {
              pending: pending ? {} : null,
              unresponsive: unresponsive ? {} : null,
            }
          : null,
        email: mail
          ? {
              pending: pending ? {} : null,
              unresponsive: unresponsive ? {} : null,
            }
          : null,
      },
    };

    await dispatchChannels(result, {
      pendingRecords,
      unresponsiveRecords,
      normalizedTypes,
      sms,
      mail,
    });

    if (sms) {
      result.sms = pendingRecords.map(
        ({ firstName, lastName, phoneNumber }) => ({
          firstName,
          lastName,
          phoneNumber,
        }),
      );
    }

    if (mail) {
      result.email = unresponsiveRecords.map(
        ({ firstName, lastName, email }) => ({ firstName, lastName, email }),
      );
    }

    logger.success(
      "SalesforceAudienceExport → getSalesforceAudienceExport() SUCCESS",
      { sms: result.summary.sms, email: result.summary.email },
    );

    return result;
  } catch (error) {
    logger.error(
      "SalesforceAudienceExport → getSalesforceAudienceExport() failed",
      {
        message: error.message,
        stack: error.stack,
      },
    );
    throw error;
  }
}

module.exports = {
  getSalesforceAudienceExport,
};
