const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildA4DRideshareT11CaseQuery,
} = require("../../../services/salesforce/queries/a4dRideshareT11.query");
const logger = require("../../../utils/logger");

const A4D_T11_API_ENDPOINT = "https://leads.iscale.com/api/v1/leads/submit";
const A4D_T11_BEARER_TOKEN =
  "pk_c66da00d5729d4758f687f93f949c91f76f5c12b4706ba166227b27841857e9b";

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

/**
 * Returns the value if non-empty, otherwise "NA".
 * Used for optional fields like ipAddress and receipt.
 */
function orNA(value) {
  const str = String(value || "").trim();
  if (str === "") {
    return "NA";
  }
  return str;
}

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function normalizeA4DYear(value) {
  const raw = toTrimmedString(value);
  if (raw === "") return "";

  const yearMatch = /(19|20)\d{2}/.exec(raw);
  if (!yearMatch) return "";

  const year = Number(yearMatch[0]);
  if (Number.isNaN(year)) return "";
  return String(year);
}

function normalizeA4DReported(value) {
  const raw = toTrimmedString(value);
  if (raw === "") return "NA";

  const normalized = raw.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");

  const map = {
    rideshare_company: "rideshare_company",
    therapist: "therapist",
    physician: "physician",
    police_dept: "police_dept",
    police_department: "police_dept",
    friend_or_family_member: "friend_or_family_member",
    friend_or_family: "friend_or_family_member",
    didnt_report: "didnt_report",
    did_not_report: "didnt_report",
    no: "didnt_report",
  };

  return map[normalized] || "NA";
}

function normalizeA4DYesNo(value, useNAForEmpty = false) {
  const raw = toTrimmedString(value);
  if (raw === "") {
    return useNAForEmpty ? "NA" : "";
  }

  const normalized = raw.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");

  const yesValues = new Set(["yes", "y", "true", "si", "s", "1"]);

  const noValues = new Set(["no", "n", "false", "0"]);

  if (yesValues.has(normalized)) return "yes";
  if (noValues.has(normalized)) return "no";

  return raw.toLowerCase();
}

function mapCaseToA4DT11Payload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  // Required fields — any missing triggers an incomplete error
  const required = {
    firstName: toTrimmedString(lead.FirstName__c),
    lastName: toTrimmedString(lead.Last_Name__c),
    phone: toTrimmedString(lead.Phone_Numbercontact__c),
    zipCode: toTrimmedString(lead.Area_Code__c),
    email: toTrimmedString(lead.Email__c),
    abuse_type: toTrimmedString(lead.What_describes_the_misconduct__c),
    year: normalizeA4DYear(lead.Incident_Date__c),
    suffer_abuse: normalizeA4DYesNo(
      lead.Were_you_abused_in_an_Uber_or_Lyft_ride__c,
    ),
    reported: normalizeA4DReported(lead.Reported_to_any_of_the_following__c),
    description: toTrimmedString(lead.Abuse_Details__c),
    lpUrl: toTrimmedString(lead.Landing_Page_URL__c),
    trustedFormCertUrl: toTrimmedString(lead.Trusted_Form__c),
  };

  const missingFields = Object.entries(required)
    .filter(
      ([, value]) =>
        value === null || value === undefined || String(value).trim() === "",
    )
    .map(([key]) => key);

  if (missingFields.length > 0) {
    const err = new Error("A4D_T11_PAYLOAD_INCOMPLETE");
    err.missingFields = missingFields;
    logger.warn(
      `A4D T11 payload validation failed for case ${lead.CaseNumber}: missing fields [${missingFields.join(", ")}]`,
    );
    throw err;
  }

  return {
    ...required,
    // Optional fields — use "NA" when empty
    ipAddress: orNA(lead.ip_address__c),
    receipt: normalizeA4DYesNo(lead.Have_a_Receipt__c, true),
  };
}

async function fetchCaseForA4DT11(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildA4DRideshareT11CaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
}

async function postA4DT11Payload(payload, caseNumber) {
  logger.info(`A4D T11 client API request started for case ${caseNumber}`);

  const body = {
    campaignId: "1351",
    tcpaConsent: true,
    ...payload,
  };

  const response = await fetch(A4D_T11_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${A4D_T11_BEARER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  logger.info(
    `A4D T11 client API response for case ${caseNumber}: status=${response.status}`,
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

    if (response.ok) return { ok: true };

    const responseBody = await response.text();
    return {
      ok: false,
      status: response.status,
      body: responseBody,
    };
  };

  const firstTry = await attemptUpdate(apiMessageResult);
  if (firstTry.ok) {
    logger.info(`A4D T11 Salesforce update completed for caseId ${caseId}`);
    return true;
  }

  logger.warn(
    `A4D T11 Salesforce update failed for caseId ${caseId}: status=${firstTry.status}, body=${firstTry.body || "N/A"}`,
  );

  const fallbackValue = String(apiMessageResult).slice(0, 255);
  const secondTry = await attemptUpdate(fallbackValue);
  if (!secondTry.ok) {
    logger.warn(
      `A4D T11 Salesforce retry update failed for caseId ${caseId}: status=${secondTry.status}, body=${secondTry.body || "N/A"}`,
    );
    return false;
  }

  logger.info(
    `A4D T11 Salesforce update completed with truncated content for caseId ${caseId}`,
  );
  return true;
}

exports.prepareA4DRideshareT11Payload = async ({ caseNumber }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);

  logger.info(`A4D T11 prepare started: case=${normalizedCaseNumber}`);

  if (!normalizedCaseNumber) {
    logger.warn("A4D T11 prepare failed: missing case number");
    throw new Error("A4D_T11_CASE_NUMBER_REQUIRED");
  }

  const caseRecord = await fetchCaseForA4DT11(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `A4D T11 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
    };
  }

  let payload;
  try {
    payload = mapCaseToA4DT11Payload(caseRecord);
  } catch (err) {
    if (err.message === "A4D_T11_PAYLOAD_INCOMPLETE") {
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
    `A4D T11 prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    payload,
  };
};

exports.sendA4DRideshareT11Payload = async ({ caseNumber }) => {
  logger.info(`A4D T11 send started: case=${String(caseNumber || "").trim()}`);

  const prepared = await exports.prepareA4DRideshareT11Payload({ caseNumber });

  if (!prepared.found) {
    logger.warn(`A4D T11 send failed: case not found: ${prepared.caseNumber}`);
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    logger.warn(
      `A4D T11 send incomplete: case ${prepared.caseNumber} missing fields: ${prepared.missingFields.join(", ")}`,
    );
    return {
      sent: false,
      found: true,
      ready: false,
      caseNumber: prepared.caseNumber,
      missingFields: prepared.missingFields,
    };
  }

  try {
    const delivery = await postA4DT11Payload(
      prepared.payload,
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
        `A4D T11 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
      );
      savedToSalesforce = false;
    }

    if (!delivery.ok) {
      return {
        sent: false,
        found: true,
        ready: true,
        caseNumber: prepared.caseNumber,
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
      statusCode: delivery.statusCode,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
    };
  } catch (error) {
    logger.error(
      `A4D T11 send error for case ${prepared.caseNumber}: ${error.message}`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      salesforceUpdated: false,
      error: "CLIENT_API_REQUEST_FAILED",
    };
  }
};
