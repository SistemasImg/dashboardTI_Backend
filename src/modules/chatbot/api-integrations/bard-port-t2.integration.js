const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildBardPortT2CaseQuery,
} = require("../../../services/salesforce/queries/bardPortT2.query");
const logger = require("../../../utils/logger");

const BARD_PORT_T2_API_ENDPOINT = "https://api.leadprosper.io/direct_post";
const BARD_PORT_T2_STATIC_FIELDS = Object.freeze({
  lp_campaign_id: "33926",
  lp_supplier_id: "110027",
  lp_key: "dyrvskn3xijz7y",
});

const BARD_T2_FIELD_TO_SF = Object.freeze({
  Email: "Email__c",
  CellPhone: "Phone_Numbercontact__c",
  FirstName: "FirstName__c",
  LastName: "Last_Name__c",
  have_attorney: "Do_you_have_an_attorney__c",
  received_port: "Receive_an_Implanted_Port_Catheter__c",
  catheter_issues: "Implanted_Port_Catheter_infection__c",
});

const BARD_T2_FIELD_ALIASES = Object.freeze({
  email: "Email",
  cellphone: "CellPhone",
  phone: "CellPhone",
  first_name: "FirstName",
  firstname: "FirstName",
  last_name: "LastName",
  lastname: "LastName",
  have_attorney: "have_attorney",
  received_port: "received_port",
  catheter_issues: "catheter_issues",
});

function normalizeTierInput(tierInput) {
  const raw = String(tierInput || "")
    .trim()
    .toLowerCase();

  if (!raw) return null;
  if (raw === "t2" || raw === "tier2" || raw === "tier 2" || raw === "2") {
    return "2";
  }

  const numericMatch = /\d+/.exec(raw);
  return numericMatch ? numericMatch[0] : null;
}

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

function mapCaseToBardPortT2Payload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  const fieldMap = {
    Email: lead.Email__c,
    CellPhone: lead.Phone_Numbercontact__c,
    FirstName: lead.FirstName__c,
    LastName: lead.Last_Name__c,
    have_attorney: lead.Do_you_have_an_attorney__c,
    received_port: lead.Receive_an_Implanted_Port_Catheter__c,
    catheter_issues: lead.Implanted_Port_Catheter_infection__c,
  };

  const missingFields = Object.entries(fieldMap)
    .filter(
      ([, value]) =>
        value === null || value === undefined || String(value).trim() === "",
    )
    .map(([key]) => key);

  if (missingFields.length > 0) {
    const err = new Error("BARD_PORT_T2_PAYLOAD_INCOMPLETE");
    err.missingFields = missingFields;
    logger.warn(
      `Bard Port T2 payload validation failed for case ${lead.CaseNumber}: missing fields [${missingFields.join(", ")}]`,
    );
    throw err;
  }

  return fieldMap;
}

async function fetchCaseForBardPortT2(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildBardPortT2CaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
}

async function postBardPortT2Payload(payload, caseNumber) {
  const requestBody = {
    ...BARD_PORT_T2_STATIC_FIELDS,
    ...payload,
  };

  logger.info(`Bard Port T2 client API request started for case ${caseNumber}`);

  const response = await fetch(BARD_PORT_T2_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  logger.info(
    `Bard Port T2 client API response for case ${caseNumber}: status=${response.status}`,
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
      `Bard Port T2 Salesforce update failed for caseId ${caseId}: status=${response.status}`,
    );
    return false;
  }

  logger.info(`Bard Port T2 Salesforce update completed for caseId ${caseId}`);

  return true;
}

function normalizeBardT2FieldName(fieldName) {
  const raw = String(fieldName || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (!raw) return null;
  return BARD_T2_FIELD_ALIASES[raw] || null;
}

async function updateBardT2CaseField({ caseId, fieldName, value }) {
  const sfField = BARD_T2_FIELD_TO_SF[fieldName];
  if (!sfField) {
    throw new Error("BARD_PORT_T2_FIELD_NOT_ALLOWED");
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
      [sfField]: String(value ?? "").trim(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn(
      `Bard Port T2 Case update failed: caseId=${caseId}, field=${sfField}, status=${response.status}, body=${body}`,
    );
    throw new Error("BARD_PORT_T2_SF_UPDATE_FAILED");
  }

  return sfField;
}

exports.prepareBardPortT2Payload = async ({ caseNumber, tort, tier }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedTort = String(tort || "").trim();
  const normalizedTier = normalizeTierInput(tier);

  logger.info(
    `Bard Port T2 prepare started: case=${normalizedCaseNumber}, tort=${normalizedTort}, tier=${normalizedTier}`,
  );

  if (!normalizedCaseNumber) {
    logger.warn("Bard Port T2 prepare failed: missing case number");
    throw new Error("BARD_PORT_T2_CASE_NUMBER_REQUIRED");
  }

  const caseRecord = await fetchCaseForBardPortT2(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `Bard Port T2 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
      tort: normalizedTort || null,
      tier: normalizedTier || null,
    };
  }

  let payload;
  try {
    payload = mapCaseToBardPortT2Payload(caseRecord);
  } catch (err) {
    if (err.message === "BARD_PORT_T2_PAYLOAD_INCOMPLETE") {
      return {
        found: true,
        ready: false,
        caseNumber: normalizedCaseNumber,
        tort: normalizedTort || null,
        tier: normalizedTier || null,
        missingFields: err.missingFields,
      };
    }
    throw err;
  }

  logger.info(
    `Bard Port T2 prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    tort: normalizedTort || null,
    tier: normalizedTier || null,
    payload,
  };
};

exports.sendBardPortT2Payload = async ({ caseNumber, tort, tier }) => {
  logger.info(
    `Bard Port T2 send started: case=${String(caseNumber || "").trim()}, tort=${tort}, tier=${tier}`,
  );

  const prepared = await exports.prepareBardPortT2Payload({
    caseNumber,
    tort,
    tier,
  });

  if (!prepared.found) {
    logger.warn(
      `Bard Port T2 send failed: case not found: ${prepared.caseNumber}`,
    );
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    logger.warn(
      `Bard Port T2 send incomplete: case ${prepared.caseNumber} missing fields: ${prepared.missingFields.join(", ")}`,
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
    const delivery = await postBardPortT2Payload(
      prepared.payload,
      prepared.caseNumber,
    );

    let savedToSalesforce = false;
    try {
      savedToSalesforce = await updateCaseApiMessageResult(
        prepared.caseId,
        delivery.body,
      );
    } catch (sfError) {
      logger.warn(
        `Bard Port T2 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
      );
      savedToSalesforce = false;
    }

    if (!delivery.ok) {
      return {
        sent: false,
        found: true,
        ready: true,
        caseNumber: prepared.caseNumber,
        tort: prepared.tort,
        tier: prepared.tier,
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
      tort: prepared.tort,
      tier: prepared.tier,
      statusCode: delivery.statusCode,
      clientResponse: delivery.body,
      salesforceUpdated: savedToSalesforce,
    };
  } catch (error) {
    logger.error(
      `Bard Port T2 send error for case ${prepared.caseNumber}: ${error.message}`,
    );
    return {
      sent: false,
      found: true,
      ready: true,
      caseNumber: prepared.caseNumber,
      tort: prepared.tort,
      tier: prepared.tier,
      salesforceUpdated: false,
      error: "CLIENT_API_REQUEST_FAILED",
    };
  }
};

exports.reviseBardPortT2PayloadField = async ({
  caseNumber,
  field,
  value,
  tort,
  tier,
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedField = normalizeBardT2FieldName(field);
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedCaseNumber) {
    throw new Error("BARD_PORT_T2_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedField) {
    return {
      updated: false,
      found: true,
      ready: false,
      caseNumber: normalizedCaseNumber,
      error: "BARD_PORT_T2_FIELD_NOT_ALLOWED",
      allowedFields: Object.keys(BARD_T2_FIELD_TO_SF),
    };
  }

  const caseRecord = await fetchCaseForBardPortT2(normalizedCaseNumber);
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
      error: "BARD_PORT_T2_CASE_NOT_FOUND",
    };
  }

  await updateBardT2CaseField({
    caseId,
    fieldName: normalizedField,
    value: normalizedValue,
  });

  const prepared = await exports.prepareBardPortT2Payload({
    caseNumber: normalizedCaseNumber,
    tort,
    tier,
  });

  return {
    updated: true,
    found: prepared.found,
    ready: prepared.ready,
    caseNumber: prepared.caseNumber,
    tort: prepared.tort,
    tier: prepared.tier,
    field: normalizedField,
    value: normalizedValue,
    payload: prepared.payload || null,
    missingFields: prepared.missingFields || [],
  };
};
