const {
  authenticateSalesforce,
} = require("../../../services/salesforce/auth.service");
const {
  runSoqlQueryFull,
} = require("../../../services/salesforce/client.service");
const salesforceConfig = require("../../../config/salesforce");
const {
  buildDepoProveraT8CaseQuery,
} = require("../../../services/salesforce/queries/depoProveraT8.query");
const logger = require("../../../utils/logger");

const DEPO_PROVERA_T8_API_ENDPOINT = "https://api.leadprosper.io/direct_post";
const DEPO_PROVERA_T8_STATIC_FIELDS = Object.freeze({
  lp_campaign_id: "32464",
  lp_supplier_id: "110026",
  lp_key: "o731izvveazlwm",
});

const DEPO_T8_FIELD_TO_SF = Object.freeze({
  Email: "Email__c",
  CellPhone: "Phone_Numbercontact__c",
  FirstName: "FirstName__c",
  LastName: "Last_Name__c",
  have_attorney: "Do_you_have_an_attorney__c",
  use_depo: "Used_Depo_Provera_for_at_least_1_year__c",
  tumor: "Diagnosed_with_Meningioma__c",
});

const DEPO_T8_FIELD_ALIASES = Object.freeze({
  email: "Email",
  cellphone: "CellPhone",
  phone: "CellPhone",
  first_name: "FirstName",
  firstname: "FirstName",
  last_name: "LastName",
  lastname: "LastName",
  have_attorney: "have_attorney",
  use_depo: "use_depo",
  tumor: "tumor",
});

function normalizeTierInput(tierInput) {
  const raw = String(tierInput || "")
    .trim()
    .toLowerCase();

  if (!raw) return null;
  if (raw === "t8" || raw === "tier8" || raw === "tier 8" || raw === "8") {
    return "8";
  }

  const numericMatch = /\d+/.exec(raw);
  return numericMatch ? numericMatch[0] : null;
}

function normalizeCaseNumber(caseNumberInput) {
  const trimmed = String(caseNumberInput || "").trim();
  const numericOnly = trimmed.replaceAll(/\D/g, "");
  return numericOnly.padStart(8, "0");
}

function normalizeDepoT8FieldName(fieldName) {
  const raw = String(fieldName || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (!raw) return null;
  return DEPO_T8_FIELD_ALIASES[raw] || null;
}

function mapCaseToDepoProveraT8Payload(junctionRecord) {
  const lead = junctionRecord.Lead__r || {};

  const payload = {
    Email: lead.Email__c,
    CellPhone: lead.Phone_Numbercontact__c,
    FirstName: lead.FirstName__c,
    LastName: lead.Last_Name__c,
    have_attorney: lead.Do_you_have_an_attorney__c,
    use_depo: lead.Used_Depo_Provera_for_at_least_1_year__c,
    tumor: lead.Diagnosed_with_Meningioma__c,
  };

  const missingFields = Object.entries(payload)
    .filter(
      ([, value]) =>
        value === null || value === undefined || String(value).trim() === "",
    )
    .map(([key]) => key);

  if (missingFields.length > 0) {
    const err = new Error("DEPO_PROVERA_T8_PAYLOAD_INCOMPLETE");
    err.missingFields = missingFields;
    logger.warn(
      `Depo Provera T8 payload validation failed for case ${lead.CaseNumber}: missing fields [${missingFields.join(", ")}]`,
    );
    throw err;
  }

  return payload;
}

async function fetchCaseForDepoProveraT8(caseNumber) {
  const sf = await authenticateSalesforce();
  const soql = buildDepoProveraT8CaseQuery(caseNumber);
  const result = await runSoqlQueryFull(sf, soql);
  return result.records?.[0] || null;
}

async function postDepoProveraT8Payload(payload, caseNumber) {
  const requestBody = {
    ...DEPO_PROVERA_T8_STATIC_FIELDS,
    ...payload,
  };

  logger.info(
    `Depo Provera T8 client API request started for case ${caseNumber}`,
  );

  const response = await fetch(DEPO_PROVERA_T8_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  logger.info(
    `Depo Provera T8 client API response for case ${caseNumber}: status=${response.status}`,
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
      `Depo Provera T8 Salesforce update failed for caseId ${caseId}: status=${response.status}`,
    );
    return false;
  }

  logger.info(
    `Depo Provera T8 Salesforce update completed for caseId ${caseId}`,
  );

  return true;
}

async function updateDepoT8CaseField({ caseId, fieldName, value }) {
  const sfField = DEPO_T8_FIELD_TO_SF[fieldName];
  if (!sfField) {
    throw new Error("DEPO_PROVERA_T8_FIELD_NOT_ALLOWED");
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
      `Depo Provera T8 Case update failed: caseId=${caseId}, field=${sfField}, status=${response.status}, body=${body}`,
    );
    throw new Error("DEPO_PROVERA_T8_SF_UPDATE_FAILED");
  }

  return sfField;
}

exports.prepareDepoProveraT8Payload = async ({ caseNumber, tort, tier }) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedTort = String(tort || "").trim() || "Depo Provera";
  const normalizedTier = normalizeTierInput(tier) || "8";

  logger.info(
    `Depo Provera T8 prepare started: case=${normalizedCaseNumber}, tort=${normalizedTort}, tier=${normalizedTier}`,
  );

  if (!normalizedCaseNumber) {
    logger.warn("Depo Provera T8 prepare failed: missing case number");
    throw new Error("DEPO_PROVERA_T8_CASE_NUMBER_REQUIRED");
  }

  const caseRecord = await fetchCaseForDepoProveraT8(normalizedCaseNumber);
  if (!caseRecord) {
    logger.warn(
      `Depo Provera T8 prepare failed: case not found in Salesforce: ${normalizedCaseNumber}`,
    );
    return {
      found: false,
      caseNumber: normalizedCaseNumber,
      tort: normalizedTort,
      tier: normalizedTier,
    };
  }

  let payload;
  try {
    payload = mapCaseToDepoProveraT8Payload(caseRecord);
  } catch (err) {
    if (err.message === "DEPO_PROVERA_T8_PAYLOAD_INCOMPLETE") {
      return {
        found: true,
        ready: false,
        caseId: caseRecord.Lead__r?.Id || null,
        caseNumber: normalizedCaseNumber,
        tort: normalizedTort,
        tier: normalizedTier,
        missingFields: err.missingFields,
      };
    }
    throw err;
  }

  logger.info(
    `Depo Provera T8 prepare completed successfully for case ${normalizedCaseNumber}`,
  );

  return {
    found: true,
    ready: true,
    caseId: caseRecord.Lead__r?.Id || null,
    caseNumber: normalizedCaseNumber,
    tort: normalizedTort,
    tier: normalizedTier,
    payload,
  };
};

exports.sendDepoProveraT8Payload = async ({ caseNumber, tort, tier }) => {
  logger.info(
    `Depo Provera T8 send started: case=${String(caseNumber || "").trim()}, tort=${tort}, tier=${tier}`,
  );

  const prepared = await exports.prepareDepoProveraT8Payload({
    caseNumber,
    tort,
    tier,
  });

  if (!prepared.found) {
    logger.warn(
      `Depo Provera T8 send failed: case not found: ${prepared.caseNumber}`,
    );
    return {
      sent: false,
      found: false,
      caseNumber: prepared.caseNumber,
    };
  }

  if (!prepared.ready) {
    logger.warn(
      `Depo Provera T8 send incomplete: case ${prepared.caseNumber} missing fields: ${prepared.missingFields.join(", ")}`,
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
    const delivery = await postDepoProveraT8Payload(
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
        `Depo Provera T8 Salesforce update threw an exception for case ${prepared.caseNumber}: ${sfError.message}`,
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
      `Depo Provera T8 send error for case ${prepared.caseNumber}: ${error.message}`,
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

exports.reviseDepoProveraT8PayloadField = async ({
  caseNumber,
  field,
  value,
  tort,
  tier,
}) => {
  const normalizedCaseNumber = normalizeCaseNumber(caseNumber);
  const normalizedField = normalizeDepoT8FieldName(field);
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedCaseNumber) {
    throw new Error("DEPO_PROVERA_T8_CASE_NUMBER_REQUIRED");
  }

  if (!normalizedField) {
    return {
      updated: false,
      found: true,
      ready: false,
      caseNumber: normalizedCaseNumber,
      error: "DEPO_PROVERA_T8_FIELD_NOT_ALLOWED",
      allowedFields: Object.keys(DEPO_T8_FIELD_TO_SF),
    };
  }

  const caseRecord = await fetchCaseForDepoProveraT8(normalizedCaseNumber);
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
      error: "DEPO_PROVERA_T8_CASE_NOT_FOUND",
    };
  }

  await updateDepoT8CaseField({
    caseId,
    fieldName: normalizedField,
    value: normalizedValue,
  });

  const prepared = await exports.prepareDepoProveraT8Payload({
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
