const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildJdcT3CaseQuery,
} = require("../../../services/salesforce/queries/jdcT3.query");
const logger = require("../../../utils/logger");

const JDC_T3_API_ENDPOINT =
  "https://smartreviews.lawruler.com/api-legalcrmapp.aspx";
const JDC_T3_STATIC_FIELDS = Object.freeze({
  CaseType: "CA JDC Abuse - Phillips Law",
  Key: "5575B1D4B6304000958184C071E4B7",
  LeadProvider: "IMG",
  Hear: "IMG",
  custom894: "CA JDC Abuse - Phillips Law",
  custom897: "Phillips Law",
});

const JDC_T3_FIELD_TO_SF = Object.freeze({
  Email1: "Email__c",
  CellPhone: "Phone_Numbercontact__c",
  FirstName: "FirstName__c",
  LastName: "Last_Name__c",
  Address1: "Address_Street__c",
  City: "City__c",
  State: "StateUS__c",
  Zip: "Area_Code__c",
  dob: "Date_of_Birth__c",
  custom1016: "Date_of_Abuse__c",
  custom699: "VictimLName__c",
  custom700: "VictimLName__c",
});

const JDC_T3_FIELD_ALIASES = Object.freeze({
  email: "Email1",
  email1: "Email1",
  cell_phone: "CellPhone",
  cellphone: "CellPhone",
  phone: "CellPhone",
  first_name: "FirstName",
  firstname: "FirstName",
  last_name: "LastName",
  lastname: "LastName",
  address: "Address1",
  address1: "Address1",
  city: "City",
  state: "State",
  zip: "Zip",
  zipcode: "Zip",
  dob: "dob",
  custom1016: "custom1016",
  date_of_abuse: "custom1016",
  custom699: "custom699",
  custom700: "custom700",
  victim_last_name: "custom699",
  victim_lname: "custom699",
});

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

function stripInitialDoubleZero(caseNumberInput) {
  const normalized = normalizeCaseNumber(caseNumberInput);
  return normalized.startsWith("00") ? normalized.slice(2) : normalized;
}

function formatDateToMMDDYYYY(dateInput) {
  if (!dateInput) return null;

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    const salesforceDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

    if (salesforceDateMatch) {
      const [, year, month, day] = salesforceDateMatch;
      return `${month}/${day}/${year}`;
    }

    // Salesforce puede devolver fechas como DD/MM/YYYY → convertir a MM/DD/YYYY
    const normalizedSlashDateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      trimmed,
    );
    if (normalizedSlashDateMatch) {
      const [, day, month, year] = normalizedSlashDateMatch;
      return `${month}/${day}/${year}`;
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

function orNA(value) {
  const str = String(value || "").trim();
  if (str === "") {
    return "NA";
  }
  return str;
}

function mapCaseToJdcT3Payload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  const payload = {
    Email1: lead.Email__c,
    CellPhone: lead.Phone_Numbercontact__c,
    FirstName: lead.FirstName__c,
    LastName: lead.Last_Name__c,
    Address1: lead.Address_Street__c,
    City: lead.City__c,
    State: lead.StateUS__c,
    Zip: lead.Area_Code__c,
    dob: formatDateToMMDDYYYY(lead.Date_of_Birth__c),
    custom697: stripInitialDoubleZero(lead.CaseNumber),
    custom1016: formatDateToMMDDYYYY(lead.Date_of_Abuse__c),
    custom699: orNA(lead.VictimLName__c),
    custom700: orNA(lead.VictimLName__c),
  };

  const requiredFields = [
    "Email1",
    "CellPhone",
    "FirstName",
    "LastName",
    "Address1",
    "City",
    "State",
    "Zip",
    "dob",
    "custom697",
    "custom1016",
  ];

  const missingFields = requiredFields.filter((key) => {
    const value = payload[key];
    return value === null || value === undefined || String(value).trim() === "";
  });

  if (missingFields.length > 0) {
    const err = new Error("JDC_T3_PAYLOAD_INCOMPLETE");
    err.missingFields = missingFields;
    logger.warn(
      `JDC T3 payload validation failed for case ${lead.CaseNumber}: missing fields [${missingFields.join(", ")}]`,
    );
    throw err;
  }

  return payload;
}

async function fetchCaseForJdcT3(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildJdcT3CaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
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

function normalizeJdcFieldName(fieldName) {
  const raw = String(fieldName || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (!raw) return null;
  return JDC_T3_FIELD_ALIASES[raw] || null;
}

function normalizeDateForSalesforce(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return raw;

  const mdy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (mdy) {
    const [, month, day, year] = mdy;
    return `${year}-${month}-${day}`;
  }

  return raw;
}

async function updateJdcT3CaseField({ caseId, fieldName, value }) {
  const sfField = JDC_T3_FIELD_TO_SF[fieldName];
  if (!sfField) {
    throw new Error("JDC_T3_FIELD_NOT_ALLOWED");
  }

  const payloadValue =
    sfField === "Date_of_Birth__c" || sfField === "Date_of_Abuse__c"
      ? normalizeDateForSalesforce(value)
      : String(value ?? "").trim();

  const sf = await authenticateSalesforce();
  const updateEndpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/Case/${caseId}`;

  const response = await fetch(updateEndpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${sf.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      [sfField]: payloadValue,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn(
      `JDC T3 Case update failed: caseId=${caseId}, field=${sfField}, status=${response.status}, body=${body}`,
    );
    throw new Error("JDC_T3_SF_UPDATE_FAILED");
  }

  return sfField;
}

async function postJdcT3Payload(payload, attachments, caseNumber) {
  const form = new FormData();
  const formFields = { ...JDC_T3_STATIC_FIELDS, ...payload };

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
    `JDC T3 client API request started for case ${caseNumber} with ${attachments.length} attachment(s)`,
  );

  const response = await fetch(JDC_T3_API_ENDPOINT, {
    method: "POST",
    body: form,
  });

  const responseText = await response.text();

  logger.info(
    `JDC T3 client API response for case ${caseNumber}: status=${response.status}`,
  );

  return {
    ok: response.ok,
    statusCode: response.status,
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
      `JDC T3 Salesforce update failed for caseId ${caseId}: status=${response.status}`,
    );
    return false;
  }

  logger.info(`JDC T3 Salesforce update completed for caseId ${caseId}`);
  return true;
}

exports.prepareJdcT3Payload = async ({ caseNumber }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);

  logger.info(`JDC T3 prepare started: case=${normalizedCaseNumber}`);

  if (!normalizedCaseNumber) {
    logger.warn("JDC T3 prepare failed: missing case number");
    throw new Error("JDC_T3_CASE_NUMBER_REQUIRED");
  }

  const caseRecord = await fetchCaseForJdcT3(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `JDC T3 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
    };
  }

  let payload;
  try {
    payload = mapCaseToJdcT3Payload(caseRecord);
  } catch (err) {
    if (err.message === "JDC_T3_PAYLOAD_INCOMPLETE") {
      return {
        found: true,
        ready: false,
        caseNumber: normalizedCaseNumber,
        caseId: caseRecord.Lead__r?.Id || null,
        missingFields: err.missingFields,
      };
    }
    throw err;
  }

  logger.info(
    `JDC T3 prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    payload,
  };
};

exports.sendJdcT3Payload = async ({ caseNumber, attachments = [] }) => {
  const cleanAttachments = sanitizeAttachments(attachments);

  logger.info(
    `JDC T3 send started: case=${String(caseNumber || "").trim()}, attachments=${cleanAttachments.length}`,
  );

  const prepared = await exports.prepareJdcT3Payload({ caseNumber });

  if (!prepared.found) {
    logger.warn(`JDC T3 send failed: case not found: ${prepared.caseNumber}`);
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    logger.warn(
      `JDC T3 send incomplete: case ${prepared.caseNumber} missing fields: ${prepared.missingFields.join(", ")}`,
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
      `JDC T3 send blocked for case ${prepared.caseNumber}: files are required for this tier`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      attachmentsRequired: true,
      caseNumber: prepared.caseNumber,
    };
  }

  try {
    const delivery = await postJdcT3Payload(
      prepared.payload,
      cleanAttachments,
      prepared.caseNumber,
    );

    const apiMessageForSalesforce = `HTTP ${delivery.statusCode}\n${delivery.body || ""}`;

    let savedToSalesforce = false;
    try {
      savedToSalesforce = await updateCaseApiMessageResult(
        prepared.caseId,
        apiMessageForSalesforce,
      );
    } catch (sfError) {
      logger.warn(
        `JDC T3 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
      );
      savedToSalesforce = false;
    }

    if (!delivery.ok) {
      return {
        sent: false,
        found: true,
        ready: true,
        caseNumber: prepared.caseNumber,
        attachmentsCount: cleanAttachments.length,
        statusCode: delivery.statusCode,
        clientResponse: delivery.body,
        salesforceUpdated: savedToSalesforce,
        error: `CLIENT_API_HTTP_${delivery.statusCode}`,
      };
    }

    return {
      sent: true,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      attachmentsCount: cleanAttachments.length,
      statusCode: delivery.statusCode,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
    };
  } catch (error) {
    logger.error(
      `JDC T3 send error for case ${prepared.caseNumber}: ${error.message}`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      attachmentsCount: cleanAttachments.length,
      salesforceUpdated: false,
      error: "CLIENT_API_REQUEST_FAILED",
    };
  }
};

exports.reviseJdcT3PayloadField = async ({
  caseNumber,
  attachments = [],
  field,
  value,
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedField = normalizeJdcFieldName(field);

  if (!normalizedCaseNumber) {
    throw new Error("JDC_T3_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedField) {
    return {
      updated: false,
      found: true,
      ready: false,
      caseNumber: normalizedCaseNumber,
      error: "JDC_T3_FIELD_NOT_ALLOWED",
      allowedFields: Object.keys(JDC_T3_FIELD_TO_SF),
    };
  }

  const caseRecord = await fetchCaseForJdcT3(normalizedCaseNumber);
  if (!caseRecord) {
    return {
      updated: false,
      found: false,
      caseNumber: normalizedCaseNumber,
    };
  }

  const caseId = caseRecord.Lead__r?.Id;
  if (!caseId) {
    return {
      updated: false,
      found: true,
      caseNumber: normalizedCaseNumber,
      error: "JDC_T3_CASE_NOT_FOUND",
    };
  }

  await updateJdcT3CaseField({
    caseId,
    fieldName: normalizedField,
    value,
  });

  const prepared = await exports.prepareJdcT3Payload({
    caseNumber: normalizedCaseNumber,
  });

  return {
    updated: true,
    found: prepared.found,
    ready: prepared.ready,
    caseNumber: prepared.caseNumber,
    field: normalizedField,
    value: String(value ?? "").trim(),
    payload: prepared.payload || null,
    missingFields: prepared.missingFields || [],
    attachmentsCount: sanitizeAttachments(attachments).length,
  };
};
