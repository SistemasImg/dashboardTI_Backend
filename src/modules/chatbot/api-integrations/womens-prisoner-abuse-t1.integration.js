const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildWomensPrisonerAbuseT1CaseQuery,
} = require("../../../services/salesforce/queries/womensPrisonerAbuseT1.query");
const logger = require("../../../utils/logger");

const WPA_T1_API_ENDPOINT =
  "https://pulaski.lawruler.com/lawruler-parsing.aspx";
const WPA_T1_STATIC_FIELDS = Object.freeze({
  Key: "BFD35CED574B457FBE7B5E8BE5BCD",
  LeadProvider: "IMG",
  Hear: "IMG",
  CaseType: "WDC - LPC Pulaski - IMG",
  Status: "Signed Contract Intake Complete",
  Custom4910: "Womens Detention Center",
});

const WPA_T1_FIELD_TO_SF = Object.freeze({
  Email1: "Email__c",
  CellPhone: "Phone_Numbercontact__c",
  FirstName: "FirstName__c",
  LastName: "Last_Name__c",
  Address1: "Address_Street__c",
  City: "City__c",
  State: "StateUS__c",
  Zip: "Area_Code__c",
  DOB: "Date_of_Birth__c",
  Custom4896: "Date_of_Death__c",
  SSN: "Signer_SSN__c",
  Custom4897: "Signer_Last_4_SSN__c",
  Custom4898: "VictimName__c",
  Custom4899: "VictimLName__c",
  Custom4900: "Victim_Mailing_Address__c",
  Custom4901: "Victim_City__c",
  Custom4902: "Victim_State__c",
  Custom4903: "Victim_Zipcode__c",
  Custom4904: "Relationship_to_the_victim__c",
  Custom4905: "Emergency_Contact_Name__c",
  Custom4906: "Relationship_to_Emergency_Contact__c",
  Custom4907: "Emergency_Mailing_Address__c",
  Custom4908: "Emergency_Contact_Phone_Number__c",
  Custom4909: "Emergency_Contact_Email__c",
  Custom4911: "Perpetrator_Name__c",
  Custom4912: "Perpetrator_Title__c",
  Custom4913: "Womens_Detention_Center_Name__c",
  Custom4914: "What_years_were_you_at_the_center__c",
  Custom4915: "Why_were_you_sent_to_the_center__c",
  Custom4916: "What_City_State_were_you_sent_from__c",
  Custom4917: "Date_of_Abuse__c",
  Custom4918: "How_did_you_first_meet_them__c",
  Custom4919: "Abuse_Details__c",
  Custom4920: "Location_1__c",
  Custom4923: "Number_of_times_you_were_abused__c",
  Custom4924: "Were_they_ever_physically_abused__c",
  Custom4925: "Physical_abuse_details__c",
  Custom4926: "Witnessed_or_heard_of_others_abused__c",
  Custom4927: "Was_the_abuse_reported__c",
  Custom4928: "Reported_to_any_of_the_following__c",
  Custom4929: "When_was_the_abuse_reported__c",
  Custom4930: "Outcome_after_reporting_the_abuse__c",
  Custom4931: "Issues_from_Abuse__c",
  Custom4932: "Treatment_details__c",
  Custom4933: "Additional_Notes__c",
  Custom4934: "Best_Contact_Method__c",
  Custom4942: "Prison_ID__c",
});

const WPA_T1_FIELD_ALIASES = Object.freeze({
  email: "Email1",
  email1: "Email1",
  phone: "CellPhone",
  cellphone: "CellPhone",
  cell_phone: "CellPhone",
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
  dob: "DOB",
  date_of_death: "Custom4896",
  ssn: "SSN",
  signer_last_4_ssn: "Custom4897",
  victim_name: "Custom4898",
  victim_last_name: "Custom4899",
  victim_lname: "Custom4899",
  victim_mailing_address: "Custom4900",
  victim_city: "Custom4901",
  victim_state: "Custom4902",
  victim_zipcode: "Custom4903",
  relationship_to_the_victim: "Custom4904",
  emergency_contact_name: "Custom4905",
  relationship_to_emergency_contact: "Custom4906",
  emergency_mailing_address: "Custom4907",
  emergency_contact_phone_number: "Custom4908",
  emergency_contact_email: "Custom4909",
  perpetrator_name: "Custom4911",
  perpetrator_title: "Custom4912",
  womens_detention_center_name: "Custom4913",
  what_years_were_you_at_the_center: "Custom4914",
  why_were_you_sent_to_the_center: "Custom4915",
  what_city_state_were_you_sent_from: "Custom4916",
  date_of_abuse: "Custom4917",
  how_did_you_first_meet_them: "Custom4918",
  abuse_details: "Custom4919",
  location_1: "Custom4920",
  number_of_times_you_were_abused: "Custom4923",
  were_they_ever_physically_abused: "Custom4924",
  physical_abuse_details: "Custom4925",
  witnessed_or_heard_of_others_abused: "Custom4926",
  was_the_abuse_reported: "Custom4927",
  reported_to_any_of_the_following: "Custom4928",
  when_was_the_abuse_reported: "Custom4929",
  outcome_after_reporting_the_abuse: "Custom4930",
  issues_from_abuse: "Custom4931",
  treatment_details: "Custom4932",
  additional_notes: "Custom4933",
  best_contact_method: "Custom4934",
  prison_id: "Custom4942",
  custom4896: "Custom4896",
  custom4897: "Custom4897",
  custom4898: "Custom4898",
  custom4899: "Custom4899",
  custom4900: "Custom4900",
  custom4901: "Custom4901",
  custom4902: "Custom4902",
  custom4903: "Custom4903",
  custom4904: "Custom4904",
  custom4905: "Custom4905",
  custom4906: "Custom4906",
  custom4907: "Custom4907",
  custom4908: "Custom4908",
  custom4909: "Custom4909",
  custom4911: "Custom4911",
  custom4912: "Custom4912",
  custom4913: "Custom4913",
  custom4914: "Custom4914",
  custom4915: "Custom4915",
  custom4916: "Custom4916",
  custom4917: "Custom4917",
  custom4918: "Custom4918",
  custom4919: "Custom4919",
  custom4920: "Custom4920",
  custom4923: "Custom4923",
  custom4924: "Custom4924",
  custom4925: "Custom4925",
  custom4926: "Custom4926",
  custom4927: "Custom4927",
  custom4928: "Custom4928",
  custom4929: "Custom4929",
  custom4930: "Custom4930",
  custom4931: "Custom4931",
  custom4932: "Custom4932",
  custom4933: "Custom4933",
  custom4934: "Custom4934",
  custom4942: "Custom4942",
});

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
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
  if (str === "") return "NA";
  return str;
}

function mapCaseToWpaT1Payload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  return {
    Email1: orNA(lead.Email__c),
    CellPhone: orNA(lead.Phone_Numbercontact__c),
    FirstName: orNA(lead.FirstName__c),
    LastName: orNA(lead.Last_Name__c),
    Address1: orNA(lead.Address_Street__c),
    City: orNA(lead.City__c),
    State: orNA(lead.StateUS__c),
    Zip: orNA(lead.Area_Code__c),
    DOB: orNA(formatDateToMMDDYYYY(lead.Date_of_Birth__c)),
    Custom4896: orNA(formatDateToMMDDYYYY(lead.Date_of_Death__c)),
    SSN: orNA(lead.Signer_SSN__c),
    Custom4897: orNA(lead.Signer_Last_4_SSN__c),
    Custom4898: orNA(lead.VictimName__c),
    Custom4899: orNA(lead.VictimLName__c),
    Custom4900: orNA(lead.Victim_Mailing_Address__c),
    Custom4901: orNA(lead.Victim_City__c),
    Custom4902: orNA(lead.Victim_State__c),
    Custom4903: orNA(lead.Victim_Zipcode__c),
    Custom4904: orNA(lead.Relationship_to_the_victim__c),
    Custom4911: orNA(lead.Perpetrator_Name__c),
    Custom4912: orNA(lead.Perpetrator_Title__c),
    Custom4913: orNA(lead.Womens_Detention_Center_Name__c),
    Custom4914: orNA(lead.What_years_were_you_at_the_center__c),
    Custom4915: orNA(lead.Why_were_you_sent_to_the_center__c),
    Custom4916: orNA(lead.What_City_State_were_you_sent_from__c),
    Custom4917: orNA(formatDateToMMDDYYYY(lead.Date_of_Abuse__c)),
    Custom4918: orNA(lead.How_did_you_first_meet_them__c),
    Custom4919: orNA(lead.Abuse_Details__c),
    Custom4920: orNA(lead.Location_1__c),
    Custom4923: orNA(lead.Number_of_times_you_were_abused__c),
    Custom4924: orNA(lead.Were_they_ever_physically_abused__c),
    Custom4925: orNA(lead.Physical_abuse_details__c),
    Custom4926: orNA(lead.Witnessed_or_heard_of_others_abused__c),
    Custom4927: orNA(lead.Was_the_abuse_reported__c),
    Custom4928: orNA(lead.Reported_to_any_of_the_following__c),
    Custom4929: orNA(lead.When_was_the_abuse_reported__c),
    Custom4930: orNA(lead.Outcome_after_reporting_the_abuse__c),
    Custom4931: orNA(lead.Issues_from_Abuse__c),
    Custom4932: orNA(lead.Treatment_details__c),
    Custom4933: orNA(lead.Additional_Notes__c),
    Custom4934: orNA(lead.Best_Contact_Method__c),
    Custom4905: orNA(lead.Emergency_Contact_Name__c),
    Custom4906: orNA(lead.Relationship_to_Emergency_Contact__c),
    Custom4907: orNA(lead.Emergency_Mailing_Address__c),
    Custom4908: orNA(lead.Emergency_Contact_Phone_Number__c),
    Custom4909: orNA(lead.Emergency_Contact_Email__c),
    Custom4942: orNA(lead.Prison_ID__c),
  };
}

async function fetchCaseForWpaT1(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildWomensPrisonerAbuseT1CaseQuery(caseNumber);
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
  if (attachment.fileBase64) {
    return Buffer.from(attachment.fileBase64, "base64");
  }
  return null;
}

function normalizeWpaT1FieldName(fieldName) {
  const raw = String(fieldName || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (!raw) return null;

  const directApiField = Object.keys(WPA_T1_FIELD_TO_SF).find(
    (key) =>
      key.toLowerCase() ===
      String(fieldName || "")
        .trim()
        .toLowerCase(),
  );
  if (directApiField) return directApiField;

  return WPA_T1_FIELD_ALIASES[raw] || null;
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

async function updateWpaT1CaseField({ caseId, fieldName, value }) {
  const sfField = WPA_T1_FIELD_TO_SF[fieldName];
  if (!sfField) {
    throw new Error("WPA_T1_FIELD_NOT_ALLOWED");
  }

  const payloadValue =
    sfField === "Date_of_Birth__c" ||
    sfField === "Date_of_Death__c" ||
    sfField === "Date_of_Abuse__c"
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
      `WPA T1 Case update failed: caseId=${caseId}, field=${sfField}, status=${response.status}, body=${body}`,
    );
    throw new Error("WPA_T1_SF_UPDATE_FAILED");
  }

  return sfField;
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

function extractSuccessValueFromClientResponse(responseText = "") {
  const successLeadMatch = /Success\s+Lead\s+#\d+/i.exec(responseText);
  if (successLeadMatch?.[0]) return successLeadMatch[0];

  const leadIdMatch = /Lead\s*ID\s*:\s*(?:<br\s*\/?\s*>\s*)*\d+/i.exec(
    responseText,
  );
  if (leadIdMatch?.[0]) {
    return leadIdMatch[0].replace(/<br\s*\/?\s*>/gi, " ").trim();
  }

  return null;
}

async function postWpaT1Payload(payload, attachments, caseNumber) {
  const form = new FormData();

  Object.entries(WPA_T1_STATIC_FIELDS).forEach(([key, value]) => {
    form.append(key, String(value));
  });

  attachments.forEach((attachment) => {
    const fileBuffer = getAttachmentBuffer(attachment);
    if (!fileBuffer) return;

    form.append(
      "File",
      new Blob([fileBuffer], { type: attachment.mimeType }),
      attachment.fileName,
    );
  });

  Object.entries(payload).forEach(([key, value]) => {
    form.append(key, String(value));
  });

  logger.info(
    `WPA T1 client API request started for case ${caseNumber} with ${attachments.length} attachment(s)`,
  );

  const response = await fetch(WPA_T1_API_ENDPOINT, {
    method: "POST",
    body: form,
  });

  const responseText = await response.text();
  const clientLeadId = extractLeadIdFromClientResponse(responseText);
  const successValue = extractSuccessValueFromClientResponse(responseText);
  const leadLogSuffix = clientLeadId ? `, clientLeadId=${clientLeadId}` : "";

  logger.info(
    `WPA T1 client API response for case ${caseNumber}: status=${response.status}${leadLogSuffix}`,
  );

  return {
    ok: response.ok,
    statusCode: response.status,
    clientLeadId,
    successValue,
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
      `WPA T1 Salesforce update failed for caseId ${caseId}: status=${response.status}`,
    );
    return false;
  }

  logger.info(`WPA T1 Salesforce update completed for caseId ${caseId}`);
  return true;
}

exports.prepareWomensPrisonerAbuseT1Payload = async ({ caseNumber }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);

  logger.info(`WPA T1 prepare started: case=${normalizedCaseNumber}`);

  if (!normalizedCaseNumber) {
    logger.warn("WPA T1 prepare failed: missing case number");
    throw new Error("WPA_T1_CASE_NUMBER_REQUIRED");
  }

  const caseRecord = await fetchCaseForWpaT1(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `WPA T1 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
    };
  }

  const payload = mapCaseToWpaT1Payload(caseRecord);

  logger.info(
    `WPA T1 prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    payload,
  };
};

exports.sendWomensPrisonerAbuseT1Payload = async ({
  caseNumber,
  attachments = [],
}) => {
  const cleanAttachments = sanitizeAttachments(attachments);

  logger.info(
    `WPA T1 send started: case=${String(caseNumber || "").trim()}, attachments=${cleanAttachments.length}`,
  );

  const prepared = await exports.prepareWomensPrisonerAbuseT1Payload({
    caseNumber,
  });

  if (!prepared.found) {
    logger.warn(`WPA T1 send failed: case not found: ${prepared.caseNumber}`);
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    return {
      sent: false,
      found: true,
      ready: false,
      caseNumber: prepared.caseNumber,
      missingFields: prepared.missingFields || [],
    };
  }

  if (cleanAttachments.length === 0) {
    logger.warn(
      `WPA T1 send blocked for case ${prepared.caseNumber}: files are required for this API`,
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
    const delivery = await postWpaT1Payload(
      prepared.payload,
      cleanAttachments,
      prepared.caseNumber,
    );

    const apiMessageForSalesforce =
      delivery.successValue || delivery.body || `HTTP ${delivery.statusCode}`;

    let savedToSalesforce = false;
    try {
      savedToSalesforce = await updateCaseApiMessageResult(
        prepared.caseId,
        apiMessageForSalesforce,
      );
    } catch (sfError) {
      logger.warn(
        `WPA T1 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
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
        clientLeadId: delivery.clientLeadId,
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
      clientLeadId: delivery.clientLeadId,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
    };
  } catch (error) {
    logger.error(
      `WPA T1 send error for case ${prepared.caseNumber}: ${error.message}`,
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

exports.reviseWomensPrisonerAbuseT1PayloadField = async ({
  caseNumber,
  attachments = [],
  field,
  value,
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedField = normalizeWpaT1FieldName(field);

  if (!normalizedCaseNumber) {
    throw new Error("WPA_T1_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedField) {
    return {
      updated: false,
      found: true,
      ready: false,
      caseNumber: normalizedCaseNumber,
      error: "WPA_T1_FIELD_NOT_ALLOWED",
      allowedFields: Object.keys(WPA_T1_FIELD_TO_SF),
    };
  }

  const caseRecord = await fetchCaseForWpaT1(normalizedCaseNumber);
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
      error: "WPA_T1_CASE_NOT_FOUND",
    };
  }

  await updateWpaT1CaseField({
    caseId,
    fieldName: normalizedField,
    value,
  });

  const prepared = await exports.prepareWomensPrisonerAbuseT1Payload({
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
