const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildT9RideshareCaseQuery,
} = require("../../../services/salesforce/queries/t9Rideshare.query");
const logger = require("../../../utils/logger");

const T9_API_ENDPOINT =
  "https://smartreviews.lawruler.com/api-legalcrmapp.aspx";
const T9_STATIC_FIELDS = Object.freeze({
  CaseType: "Rideshare - Phillips Law",
  Key: "5575B1D4B6304000958184C071E4B7",
  dupcheck: "0",
  LeadProvider: "IMG",
  Hear: "IMG",
  custom894: "Rideshare - Phillips Law",
});

function normalizeTierInput(tierInput) {
  const raw = String(tierInput || "")
    .trim()
    .toLowerCase();

  if (!raw) return null;
  if (raw === "t9" || raw === "tier9" || raw === "tier 9" || raw === "9") {
    return "9";
  }

  const numericMatch = /\d+/.exec(raw);
  return numericMatch ? numericMatch[0] : null;
}

function normalizeCaseNumber(caseNumberInput) {
  // Converts 123998 to 00123998 (8 digits with left-zero padding)
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

function normalizeCaseNumberForClient(caseNumberInput) {
  // Client expects case number without left-zero padding in custom697
  const numericOnly = String(caseNumberInput || "").replaceAll(/\D/g, "");
  const withoutLeadingZeros = numericOnly.replace(/^0+/, "");
  return withoutLeadingZeros || numericOnly || "";
}

function formatDateToMMDDYYYY(dateInput) {
  // Converts Salesforce date values to MM/DD/YYYY without timezone shifts
  if (!dateInput) return null;

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    const salesforceDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

    if (salesforceDateMatch) {
      const [, year, month, day] = salesforceDateMatch;
      return `${month}/${day}/${year}`;
    }

    const normalizedSlashDateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      trimmed,
    );
    if (normalizedSlashDateMatch) {
      return trimmed;
    }

    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  }

  const date = dateInput;
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

function mapCaseToT9Payload(junctionRecord) {
  const lead = junctionRecord["Lead__r"] || {};

  const fieldMap = {
    CellPhone: lead.Phone_Numbercontact__c,
    Email1: lead.Email__c,
    FirstName: lead.FirstName__c,
    LastName: lead.Last_Name__c,
    Address1: lead.Address_Street__c,
    City: lead.City__c,
    State: lead.StateUS__c,
    Zip: lead.Area_Code__c,
    dob: formatDateToMMDDYYYY(lead.Date_of_Birth__c),
    custom697: normalizeCaseNumberForClient(lead.CaseNumber),
    custom1016: formatDateToMMDDYYYY(lead.Incident_Date__c),
  };

  const missingFields = Object.entries(fieldMap)
    .filter(
      ([, value]) =>
        value === null || value === undefined || String(value).trim() === "",
    )
    .map(([key]) => key);

  if (missingFields.length > 0) {
    const err = new Error("T9_PAYLOAD_INCOMPLETE");
    err.missingFields = missingFields;
    logger.warn(
      `T9 payload validation failed for case ${lead.CaseNumber}: missing fields [${missingFields.join(", ")}]`,
    );
    throw err;
  }

  const payload = {
    ...fieldMap,
    custom896: "No",
  };

  logger.info(`T9 payload built successfully for case ${lead.CaseNumber}`);
  return payload;
}

function sanitizeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      fileName: String(item.fileName || item.originalname || "").trim(),
      mimeType: String(
        item.mimeType || item.mimetype || "application/octet-stream",
      ),
      fileBase64: item.fileBase64 ? String(item.fileBase64) : null,
      buffer: Buffer.isBuffer(item.buffer) ? item.buffer : null,
    }))
    .filter((item) => item.fileName && (item.buffer || item.fileBase64));
}

function getAttachmentBuffer(attachment) {
  if (attachment.buffer) return attachment.buffer;
  if (attachment.fileBase64)
    return Buffer.from(attachment.fileBase64, "base64");
  return null;
}

function extractLeadIdFromClientResponse(responseText = "") {
  const successLeadMatch = /Success\s+Lead\s+#(\d+)/i.exec(responseText);
  if (successLeadMatch?.[1]) return successLeadMatch[1];

  const leadIdMatch = /Lead\s*ID\s*:\s*(?:<br\s*\/?\s*>\s*)*(\d+)/i.exec(
    responseText,
  );
  if (leadIdMatch?.[1]) return leadIdMatch[1];

  return null;
}

async function postT9Payload(payload, attachments, caseNumber) {
  const form = new FormData();
  const formFields = { ...T9_STATIC_FIELDS, ...payload };

  Object.entries(formFields).forEach(([key, value]) => {
    form.append(key, String(value));
  });

  attachments.forEach((attachment) => {
    const fileBuffer = getAttachmentBuffer(attachment);
    if (!fileBuffer) return;

    form.append(
      "file",
      new Blob([fileBuffer], { type: attachment.mimeType }),
      attachment.fileName,
    );
  });

  logger.info(
    `T9 client API request started for case ${caseNumber} with ${attachments.length} attachment(s)`,
  );

  const response = await fetch(T9_API_ENDPOINT, {
    method: "POST",
    body: form,
  });
  const responseText = await response.text();
  const clientLeadId = extractLeadIdFromClientResponse(responseText);
  const leadLogSuffix = clientLeadId ? `, clientLeadId=${clientLeadId}` : "";

  logger.info(
    `T9 client API response for case ${caseNumber}: status=${response.status}${leadLogSuffix}`,
  );

  return {
    ok: response.ok,
    statusCode: response.status,
    clientLeadId,
    body: responseText,
  };
}

async function updateCaseApiMessageResult(caseId, apiMessageResult) {
  if (!caseId || !apiMessageResult) {
    return false;
  }

  const sf = await authenticateSalesforce();
  const updateEndpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/Case/${caseId}`;

  const response = await fetch(updateEndpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${sf.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      API_Message_Result__c: apiMessageResult,
    }),
  });

  if (!response.ok) {
    logger.warn(
      `T9 Salesforce update failed for caseId ${caseId}: status=${response.status}`,
    );
    return false;
  }

  logger.info(`T9 Salesforce update completed for caseId ${caseId}`);

  return true;
}

async function fetchCaseForT9(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildT9RideshareCaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
}

exports.prepareT9RidesharePayload = async ({
  caseNumber,
  tort,
  tier,
  attachments = [],
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedTort = String(tort || "").trim();
  const normalizedTier = normalizeTierInput(tier);
  const cleanAttachments = sanitizeAttachments(attachments);

  logger.info(
    `T9 prepare started: case=${normalizedCaseNumber}, tort=${normalizedTort}, tier=${normalizedTier}`,
  );

  if (!normalizedCaseNumber) {
    logger.warn("T9 prepare failed: missing case number");
    throw new Error("T9_CASE_NUMBER_REQUIRED");
  }
  if (!normalizedTort) {
    logger.warn("T9 prepare failed: missing tort");
    throw new Error("T9_TORT_REQUIRED");
  }
  if (!normalizedTier) {
    logger.warn("T9 prepare failed: missing or invalid tier");
    throw new Error("T9_TIER_REQUIRED");
  }

  const caseRecord = await fetchCaseForT9(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `T9 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
    };
  }

  let payload;
  try {
    payload = mapCaseToT9Payload(caseRecord);
  } catch (err) {
    if (err.message === "T9_PAYLOAD_INCOMPLETE") {
      logger.warn(
        `T9 prepare incomplete: case ${normalizedCaseNumber} missing fields: ${err.missingFields.join(", ")}`,
      );
      return {
        found: true,
        ready: false,
        caseNumber: normalizedCaseNumber,
        missingFields: err.missingFields,
      };
    }
    throw err;
  }

  logger.info(
    `T9 prepare completed successfully for case ${normalizedCaseNumber}`,
  );
  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    tort: normalizedTort,
    tier: normalizedTier,
    attachmentsCount: cleanAttachments.length,
    payload,
  };
};

exports.sendT9RidesharePayload = async ({
  caseNumber,
  tort,
  tier,
  attachments = [],
}) => {
  const cleanAttachments = sanitizeAttachments(attachments);
  logger.info(
    `T9 send started: case=${String(caseNumber || "").trim()}, tort=${tort}, tier=${tier}, attachments=${cleanAttachments.length}`,
  );

  const prepared = await exports.prepareT9RidesharePayload({
    caseNumber,
    tort,
    tier,
    attachments: cleanAttachments,
  });

  if (!prepared.found) {
    logger.warn(`T9 send failed: case not found: ${prepared.caseNumber}`);
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    logger.warn(
      `T9 send incomplete: case ${prepared.caseNumber} missing fields: ${prepared.missingFields.join(", ")}`,
    );
    return {
      sent: false,
      found: true,
      ready: false,
      caseNumber: prepared.caseNumber,
      missingFields: prepared.missingFields,
    };
  }

  if (cleanAttachments.length === 0) {
    logger.warn(
      `T9 send blocked for case ${prepared.caseNumber}: files are required for this tier`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      attachmentsRequired: true,
      caseNumber: prepared.caseNumber,
      tort: prepared.tort,
      tier: prepared.tier,
    };
  }

  try {
    const delivery = await postT9Payload(
      prepared.payload,
      cleanAttachments,
      prepared.caseNumber,
    );

    if (!delivery.ok) {
      return {
        sent: false,
        found: true,
        ready: true,
        caseNumber: prepared.caseNumber,
        tort: prepared.tort,
        tier: prepared.tier,
        attachmentsCount: cleanAttachments.length,
        statusCode: delivery.statusCode,
        error: `CLIENT_API_HTTP_${delivery.statusCode}`,
      };
    }

    let savedToSalesforce = false;
    try {
      savedToSalesforce = await updateCaseApiMessageResult(
        prepared.caseId,
        delivery.body,
      );
    } catch (sfError) {
      logger.warn(
        `T9 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
      );
      savedToSalesforce = false;
    }

    return {
      sent: true,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      tort: prepared.tort,
      tier: prepared.tier,
      attachmentsCount: cleanAttachments.length,
      statusCode: delivery.statusCode,
      clientLeadId: delivery.clientLeadId,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
    };
  } catch (error) {
    logger.error(
      `T9 send error for case ${prepared.caseNumber}: ${error.message}`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      tort: prepared.tort,
      tier: prepared.tier,
      attachmentsCount: cleanAttachments.length,
      error: "CLIENT_API_REQUEST_FAILED",
    };
  }
};
