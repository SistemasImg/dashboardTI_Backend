const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildAdReachRideshareCaseQuery,
} = require("../../../services/salesforce/queries/adReachRideshare.query");
const logger = require("../../../utils/logger");

const ADREACH_RIDESHARE_API_ENDPOINT =
  "https://adreachiq.leadportal.com/apiJSON.php";
const ADREACH_ALLOWED_TIERS = Object.freeze(["12", "13", "14"]);
const ADREACH_STATIC_REQUEST_FIELDS = Object.freeze({
  Key: "1eae58a15d2cb9944611aa1c4bbedea5129e2cff1ebef5a2beefb93c1f6d154b",
  API_Action: "pingPostLead",
  Mode: "full",
  SRC: "IMG360",
  TYPE: "35",
});

const ADREACH_FIELD_TO_SF = Object.freeze({
  Email: "Email__c",
  Primary_Phone: "Phone_Numbercontact__c",
  First_Name: "FirstName__c",
  Last_Name: "Last_Name__c",
  Address: "Address_Street__c",
  City: "City__c",
  State: "StateUS__c",
  Zip: "Area_Code__c",
  DOB: "Date_of_Birth__c",
  Have_Attorney: "Do_you_have_an_attorney__c",
  Rideshare_Assault: "Were_you_abused_in_an_Uber_or_Lyft_ride__c",
  Injured_Party: "Passenger_or_Driver__c",
  Assault_Details: "What_type_of_abuse_did_you_experience__c",
  Incident_Date: "Incident_Date__c",
  Digital_Receipt: "Have_a_Receipt__c",
  Police_Report: "Is_there_a_police_report__c",
  Reported: "Reported_to_any_of_the_following__c",
  Date_Reported: "When_was_the_abuse_reported__c",
  Incident_Details: "Abuse_Details__c",
  Trusted_Form_URL: "Trusted_Form__c",
  Landing_Page: "Landing_Page_URL__c",
  IP_Address: "ip_address__c",
  Rideshare_Company: "Uber_or_Lyft__c",
  Gender: "Gender__c",
  State_Of_Incident: "State_of_Incident__c",
  Comments: "Additional_Notes__c",
  Reported_To_Name: "What_is_this_person_s_full_name__c",
  Reported_To_Relationship: "What_s_your_relationship_to_this_person__c",
  Reported_To_Address: "What_is_this_person_s_address__c",
  Reported_To_Phone: "What_s_this_person_s_phone_number__c",
  Reported_To_Date: "When_did_you_tell_them__c",
  Permission_To_Contact: "May_the_attorneys_contact_this_person__c",
  How_Shared: "How_did_you_share_the_information__c",
});

const ADREACH_FIELD_ALIASES = Object.freeze({
  email: "Email",
  primary_phone: "Primary_Phone",
  phone: "Primary_Phone",
  first_name: "First_Name",
  firstname: "First_Name",
  last_name: "Last_Name",
  lastname: "Last_Name",
  address: "Address",
  city: "City",
  state: "State",
  zip: "Zip",
  zipcode: "Zip",
  dob: "DOB",
  have_attorney: "Have_Attorney",
  rideshare_assault: "Rideshare_Assault",
  injured_party: "Injured_Party",
  assault_details: "Assault_Details",
  incident_date: "Incident_Date",
  digital_receipt: "Digital_Receipt",
  police_report: "Police_Report",
  reported: "Reported",
  date_reported: "Date_Reported",
  incident_details: "Incident_Details",
  trusted_form_url: "Trusted_Form_URL",
  trustedformurl: "Trusted_Form_URL",
  landing_page: "Landing_Page",
  landingpage: "Landing_Page",
  ip_address: "IP_Address",
  ipaddress: "IP_Address",
  rideshare_company: "Rideshare_Company",
  gender: "Gender",
  state_of_incident: "State_Of_Incident",
  comments: "Comments",
  reported_to_name: "Reported_To_Name",
  reported_to_relationship: "Reported_To_Relationship",
  reported_to_address: "Reported_To_Address",
  reported_to_phone: "Reported_To_Phone",
  reported_to_date: "Reported_To_Date",
  permission_to_contact: "Permission_To_Contact",
  how_shared: "How_Shared",
});

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

function normalizeTierInput(tierInput) {
  const raw = String(tierInput || "")
    .trim()
    .toLowerCase();

  if (!raw) return null;
  const tierMatch = /(?:tier\s*|t\s*)?(12|13|14)\b/.exec(raw);
  if (!tierMatch?.[1]) {
    return null;
  }

  return ADREACH_ALLOWED_TIERS.includes(tierMatch[1]) ? tierMatch[1] : null;
}

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function orNA(value) {
  const raw = toTrimmedString(value);
  return raw === "" ? "NA" : raw;
}

function parseSupportedDate(value) {
  const raw = toTrimmedString(value);
  if (!raw || /^na$/i.test(raw)) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(raw);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
  }

  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (usMatch) {
    return {
      year: Number(usMatch[3]),
      month: Number(usMatch[1]),
      day: Number(usMatch[2]),
    };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function formatDateForPayload(value) {
  const parsed = parseSupportedDate(value);
  if (!parsed) {
    return "NA";
  }

  return `${String(parsed.month).padStart(2, "0")}/${String(parsed.day).padStart(2, "0")}/${String(parsed.year).padStart(4, "0")}`;
}

function normalizeDateForSalesforce(value) {
  const parsed = parseSupportedDate(value);
  if (!parsed) {
    return toTrimmedString(value);
  }

  return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
}

function toUtcTimestamp(dateParts) {
  if (!dateParts) {
    return null;
  }

  return Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
}

function classifyWhenReported(reportedDateValue, incidentDateValue) {
  const reportedDate = parseSupportedDate(reportedDateValue);
  const incidentDate = parseSupportedDate(incidentDateValue);
  if (!reportedDate || !incidentDate) {
    return "NA";
  }

  const daysDifference = Math.round(
    (toUtcTimestamp(reportedDate) - toUtcTimestamp(incidentDate)) / 86400000,
  );

  if (Number.isNaN(daysDifference) || daysDifference < 0) {
    return "NA";
  }

  if (daysDifference === 0) {
    return "Same day of Incident";
  }
  if (daysDifference <= 7) {
    return "Within week of Incident";
  }
  return "Other/Several weeks after incident";
}

function toTitleCaseOrNA(value) {
  const raw = toTrimmedString(value);
  if (!raw) {
    return "NA";
  }

  return raw
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function normalizeDigitalReceipt(value) {
  const raw = toTrimmedString(value);
  if (!raw) {
    return "NA";
  }
  if (raw.toLowerCase() === "yes") {
    return "Yes - has receipt and can provide copy";
  }
  return raw;
}

function normalizeRideshareCompany(value) {
  const raw = toTrimmedString(value);
  if (!raw) {
    return "NA";
  }
  if (/\s+rideshare$/i.test(raw)) {
    return raw;
  }
  return `${raw} Rideshare`;
}

function mapCaseToAdReachRidesharePayload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  return {
    Email: orNA(lead.Email__c),
    Primary_Phone: orNA(lead.Phone_Numbercontact__c),
    First_Name: orNA(lead.FirstName__c),
    Last_Name: orNA(lead.Last_Name__c),
    Address: orNA(lead.Address_Street__c),
    City: orNA(lead.City__c),
    State: orNA(lead.StateUS__c),
    Zip: orNA(lead.Area_Code__c),
    DOB: formatDateForPayload(lead.Date_of_Birth__c),
    Have_Attorney: orNA(lead.Do_you_have_an_attorney__c),
    Rideshare_Assault: orNA(lead.Were_you_abused_in_an_Uber_or_Lyft_ride__c),
    Injured_Party: orNA(lead.Passenger_or_Driver__c),
    Assault_Details: toTitleCaseOrNA(
      lead.What_type_of_abuse_did_you_experience__c,
    ),
    Incident_Date: formatDateForPayload(lead.Incident_Date__c),
    Digital_Receipt: normalizeDigitalReceipt(lead.Have_a_Receipt__c),
    Police_Report: orNA(lead.Is_there_a_police_report__c),
    Reported: orNA(lead.Reported_to_any_of_the_following__c),
    Date_Reported: formatDateForPayload(lead.When_was_the_abuse_reported__c),
    When_Reported: classifyWhenReported(
      lead.When_was_the_abuse_reported__c,
      lead.Incident_Date__c,
    ),
    Incident_Details: orNA(lead.Abuse_Details__c),
    Trusted_Form_URL: orNA(lead.Trusted_Form__c),
    Landing_Page: orNA(lead.Landing_Page_URL__c),
    IP_Address: orNA(lead.ip_address__c),
    Rideshare_Company: normalizeRideshareCompany(lead.Uber_or_Lyft__c),
    Gender: orNA(lead.Gender__c),
    State_Of_Incident: orNA(lead.State_of_Incident__c),
    Comments: orNA(lead.Additional_Notes__c),
    Lead_ID: orNA(lead.CaseNumber),
    Reported_To_Name: toTitleCaseOrNA(lead.What_is_this_person_s_full_name__c),
    Reported_To_Relationship: toTitleCaseOrNA(
      lead.What_s_your_relationship_to_this_person__c,
    ),
    Reported_To_Address: orNA(lead.What_is_this_person_s_address__c),
    Reported_To_Phone: orNA(lead.What_s_this_person_s_phone_number__c),
    Reported_To_Date: formatDateForPayload(lead.When_did_you_tell_them__c),
    Permission_To_Contact: orNA(lead.May_the_attorneys_contact_this_person__c),
    How_Shared: orNA(lead.How_did_you_share_the_information__c),
  };
}

async function fetchCaseForAdReachRideshare(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildAdReachRideshareCaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
}

async function postAdReachRidesharePayload(payload, caseNumber) {
  logger.info(
    `AdReach Rideshare client API request started for case ${caseNumber}`,
  );

  const response = await fetch(ADREACH_RIDESHARE_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Request: {
        ...ADREACH_STATIC_REQUEST_FIELDS,
        ...payload,
      },
    }),
  });

  const responseText = await response.text();

  logger.info(
    `AdReach Rideshare client API response for case ${caseNumber}: status=${response.status}`,
  );

  return {
    ok: response.ok,
    statusCode: response.status,
    body: responseText,
  };
}

function extractValueByKeys(source, keys) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const [key, value] of Object.entries(source)) {
    if (keys.has(key) && value !== null && value !== undefined) {
      const normalizedValue = toTrimmedString(value);
      if (normalizedValue) {
        return normalizedValue;
      }
    }

    if (value && typeof value === "object") {
      const nestedValue = extractValueByKeys(value, keys);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return null;
}

function extractAdReachResponseCode(responseText) {
  const raw = toTrimmedString(responseText);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const extracted = extractValueByKeys(
      parsed,
      new Set([
        "Code",
        "code",
        "LeadID",
        "leadId",
        "lead_id",
        "Id",
        "id",
        "Result",
        "result",
      ]),
    );
    if (extracted) {
      return extracted;
    }
  } catch {
    // Fall through to regex/text fallback.
  }

  const inlineMatch =
    /(?:code|lead\s*id|lead_id|id)\s*[:=#-]?\s*([\w-]+)/i.exec(raw);
  if (inlineMatch?.[1]) {
    return inlineMatch[1];
  }

  return raw;
}

async function updateCaseApiMessageResult(caseId, apiMessageResult) {
  if (!caseId || !apiMessageResult) {
    return false;
  }

  const sf = await authenticateSalesforce();
  const updateEndpoint = `${sf.instanceUrl}/services/data/${salesforceConfig.apiVersion}/sobjects/Case/${caseId}`;

  const attemptUpdate = async (value) => {
    const response = await fetch(updateEndpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${sf.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        API_Message_Result__c: value,
      }),
    });

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      status: response.status,
      body: await response.text(),
    };
  };

  const firstTry = await attemptUpdate(apiMessageResult);
  if (firstTry.ok) {
    logger.info(
      `AdReach Rideshare Salesforce update completed for caseId ${caseId}`,
    );
    return true;
  }

  logger.warn(
    `AdReach Rideshare Salesforce update failed for caseId ${caseId}: status=${firstTry.status}, body=${firstTry.body || "N/A"}`,
  );

  const fallbackValue = String(apiMessageResult).slice(0, 255);
  const secondTry = await attemptUpdate(fallbackValue);
  if (!secondTry.ok) {
    logger.warn(
      `AdReach Rideshare Salesforce retry update failed for caseId ${caseId}: status=${secondTry.status}, body=${secondTry.body || "N/A"}`,
    );
    return false;
  }

  logger.info(
    `AdReach Rideshare Salesforce update completed with truncated content for caseId ${caseId}`,
  );
  return true;
}

function normalizeAdReachFieldName(fieldName) {
  const raw = String(fieldName || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (!raw) return null;
  return ADREACH_FIELD_ALIASES[raw] || null;
}

function normalizeAdReachValueForSalesforce(fieldName, value) {
  const raw = toTrimmedString(value);

  if (
    fieldName === "DOB" ||
    fieldName === "Incident_Date" ||
    fieldName === "Date_Reported" ||
    fieldName === "Reported_To_Date"
  ) {
    return normalizeDateForSalesforce(raw);
  }

  if (fieldName === "Digital_Receipt") {
    if (/^yes\b/i.test(raw)) {
      return "Yes";
    }
    return raw;
  }

  if (fieldName === "Rideshare_Company") {
    return raw.replace(/\s+rideshare$/i, "").trim();
  }

  return raw;
}

async function updateAdReachRideshareCaseField({ caseId, fieldName, value }) {
  const sfField = ADREACH_FIELD_TO_SF[fieldName];
  if (!sfField) {
    throw new Error("ADREACH_RIDESHARE_FIELD_NOT_ALLOWED");
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
      [sfField]: normalizeAdReachValueForSalesforce(fieldName, value),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn(
      `AdReach Rideshare Case update failed: caseId=${caseId}, field=${sfField}, status=${response.status}, body=${body}`,
    );
    throw new Error("ADREACH_RIDESHARE_SF_UPDATE_FAILED");
  }

  return sfField;
}

exports.prepareAdReachRidesharePayload = async ({ caseNumber, tier }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedTier = normalizeTierInput(tier);

  logger.info(
    `AdReach Rideshare prepare started: case=${normalizedCaseNumber}, tier=${normalizedTier}`,
  );

  if (!normalizedCaseNumber) {
    logger.warn("AdReach Rideshare prepare failed: missing case number");
    throw new Error("ADREACH_RIDESHARE_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedTier) {
    return {
      found: true,
      ready: false,
      invalidTier: true,
      caseNumber: normalizedCaseNumber,
      allowedTiers: ADREACH_ALLOWED_TIERS,
    };
  }

  const caseRecord = await fetchCaseForAdReachRideshare(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `AdReach Rideshare prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
      tier: normalizedTier,
    };
  }

  const payload = mapCaseToAdReachRidesharePayload(caseRecord);
  logger.info(
    `AdReach Rideshare prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    tier: normalizedTier,
    tort: "Rideshare",
    payload,
  };
};

exports.sendAdReachRidesharePayload = async ({ caseNumber, tier }) => {
  logger.info(
    `AdReach Rideshare send started: case=${String(caseNumber || "").trim()}, tier=${tier}`,
  );

  const prepared = await exports.prepareAdReachRidesharePayload({
    caseNumber,
    tier,
  });

  if (prepared.invalidTier) {
    return {
      sent: false,
      found: true,
      ready: false,
      invalidTier: true,
      caseNumber: prepared.caseNumber,
      allowedTiers: prepared.allowedTiers,
    };
  }

  if (!prepared.found) {
    logger.warn(
      `AdReach Rideshare send failed: case not found: ${prepared.caseNumber}`,
    );
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
      tier: prepared.tier || normalizeTierInput(tier),
    };
  }

  try {
    const delivery = await postAdReachRidesharePayload(
      prepared.payload,
      prepared.caseNumber,
    );
    const apiMessageForSalesforce =
      extractAdReachResponseCode(delivery.body) ||
      `HTTP ${delivery.statusCode}`;

    let savedToSalesforce = false;
    try {
      savedToSalesforce = await updateCaseApiMessageResult(
        prepared.caseId,
        apiMessageForSalesforce,
      );
    } catch (sfError) {
      logger.warn(
        `AdReach Rideshare Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
      );
      savedToSalesforce = false;
    }

    if (!delivery.ok) {
      return {
        sent: false,
        found: true,
        ready: true,
        caseNumber: prepared.caseNumber,
        tier: prepared.tier,
        tort: prepared.tort,
        statusCode: delivery.statusCode,
        clientResponse: delivery.body,
        salesforceUpdated: savedToSalesforce,
        apiMessageResult: apiMessageForSalesforce,
        error: `CLIENT_API_HTTP_${delivery.statusCode}`,
      };
    }

    return {
      sent: true,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      tier: prepared.tier,
      tort: prepared.tort,
      statusCode: delivery.statusCode,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
      apiMessageResult: apiMessageForSalesforce,
    };
  } catch (error) {
    logger.error(
      `AdReach Rideshare send error for case ${prepared.caseNumber}: ${error.message}`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      tier: prepared.tier,
      tort: prepared.tort,
      salesforceUpdated: false,
      error: "CLIENT_API_REQUEST_FAILED",
    };
  }
};

exports.reviseAdReachRidesharePayloadField = async ({
  caseNumber,
  tier,
  field,
  value,
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedTier = normalizeTierInput(tier);
  const normalizedField = normalizeAdReachFieldName(field);
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedCaseNumber) {
    throw new Error("ADREACH_RIDESHARE_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedTier) {
    return {
      updated: false,
      found: true,
      ready: false,
      invalidTier: true,
      caseNumber: normalizedCaseNumber,
      allowedTiers: ADREACH_ALLOWED_TIERS,
    };
  }

  if (!normalizedField) {
    return {
      updated: false,
      found: true,
      ready: false,
      caseNumber: normalizedCaseNumber,
      tier: normalizedTier,
      error: "ADREACH_RIDESHARE_FIELD_NOT_ALLOWED",
      allowedFields: Object.keys(ADREACH_FIELD_TO_SF),
    };
  }

  const caseRecord = await fetchCaseForAdReachRideshare(normalizedCaseNumber);
  if (!caseRecord) {
    return {
      updated: false,
      found: false,
      caseNumber: normalizedCaseNumber,
      tier: normalizedTier,
    };
  }

  const caseId = caseRecord.Lead__r?.Id;
  if (!caseId) {
    return {
      updated: false,
      found: true,
      caseNumber: normalizedCaseNumber,
      tier: normalizedTier,
      error: "ADREACH_RIDESHARE_CASE_NOT_FOUND",
    };
  }

  await updateAdReachRideshareCaseField({
    caseId,
    fieldName: normalizedField,
    value: normalizedValue,
  });

  const prepared = await exports.prepareAdReachRidesharePayload({
    caseNumber: normalizedCaseNumber,
    tier: normalizedTier,
  });

  return {
    updated: true,
    found: prepared.found,
    ready: prepared.ready,
    caseNumber: prepared.caseNumber,
    tier: prepared.tier,
    tort: prepared.tort,
    field: normalizedField,
    value: normalizedValue,
    payload: prepared.payload || null,
    missingFields: prepared.missingFields || [],
  };
};
