const logger = require("../../utils/logger");
const { authenticateSalesforce } = require("./auth.service");
const { runSoqlQuery } = require("./client.service");
const { buildCasesByPhonesQuery } = require("./queries/phoneCase.query");

const SOQL_PHONE_CHUNK_SIZE = 150;

function normalizePhone(phone) {
  if (!phone) return null;

  const digits = String(phone).replaceAll(/\D/g, "");

  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);

  return null;
}

function buildPhoneVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  return [normalized, `+1${normalized}`];
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function getSupplierTypeByPhones(phoneNumbers = []) {
  const normalizedTargets = [
    ...new Set((phoneNumbers || []).map(normalizePhone).filter(Boolean)),
  ];

  if (!normalizedTargets.length) {
    return new Map();
  }

  const soqlPhoneValues = [
    ...new Set(normalizedTargets.flatMap((phone) => buildPhoneVariants(phone))),
  ];

  const sf = await authenticateSalesforce();
  const chunks = chunkArray(soqlPhoneValues, SOQL_PHONE_CHUNK_SIZE);
  const resultByPhone = new Map();

  for (const chunk of chunks) {
    const soql = buildCasesByPhonesQuery(chunk);
    if (!soql) continue;

    const records = await runSoqlQuery(sf, soql);

    records.forEach((record) => {
      const normalizedPhone = normalizePhone(record.Phone_Numbercontact__c);
      if (!normalizedPhone) return;

      const createdAt = Date.parse(record.CreatedDate || "") || 0;
      const previous = resultByPhone.get(normalizedPhone);

      if (!previous || createdAt > previous.createdAt) {
        resultByPhone.set(normalizedPhone, {
          caseNumber: record.CaseNumber || null,
          supplier: record.Owner?.Name || null,
          type: record.Type || null,
          status: record.Status || null,
          substatus: record.Substatus__c || null,
          createdAt,
        });
      }
    });
  }

  const cleanedMap = new Map();
  normalizedTargets.forEach((phone) => {
    const found = resultByPhone.get(phone);
    cleanedMap.set(phone, {
      caseNumber: found?.caseNumber || null,
      supplier: found?.supplier || null,
      type: found?.type || null,
      status: found?.status || null,
      substatus: found?.substatus || null,
    });
  });

  logger.info(
    `Salesforce phone lookup completed. Matched ${[...cleanedMap.values()].filter((x) => x.supplier || x.type).length}/${normalizedTargets.length} phones`,
  );

  return cleanedMap;
}

module.exports = {
  getSupplierTypeByPhones,
  normalizePhone,
};
