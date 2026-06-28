const mysql = require("mysql2/promise");
const { DateTime } = require("luxon");
const vicidialDbConfig = require("../../config/vicidialDb");
const logger = require("../../utils/logger");

let pool = null;

function getPool() {
  if (!vicidialDbConfig.enabled) return null;

  if (!pool) {
    pool = mysql.createPool({
      host: vicidialDbConfig.host,
      port: vicidialDbConfig.port,
      user: vicidialDbConfig.user,
      password: vicidialDbConfig.password,
      database: vicidialDbConfig.database,
      dateStrings: true,
      waitForConnections: true,
      connectionLimit: vicidialDbConfig.connectionLimit,
      queueLimit: 0,
    });
  }

  return pool;
}

function normalizePhoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length >= 10) {
    return digits.slice(-10);
  }

  return digits || null;
}

function buildPhoneCandidates(phone) {
  const normalized = normalizePhoneDigits(phone);
  if (!normalized) return [];

  return [...new Set([normalized, `1${normalized}`])];
}

function formatForVicidialDb(dateTime) {
  if (!dateTime?.isValid) return null;

  return dateTime
    .setZone(vicidialDbConfig.timezone, { keepLocalTime: false })
    .toFormat("yyyy-LL-dd HH:mm:ss");
}

function parseCallDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: vicidialDbConfig.timezone });
  }

  return DateTime.fromFormat(String(value), "yyyy-LL-dd HH:mm:ss", {
    zone: vicidialDbConfig.timezone,
  });
}

async function searchVicidialOutboundCallsByPhone({
  phoneNumber,
  startAt,
  endAt,
  limit = 10,
}) {
  const dbPool = getPool();
  const phoneCandidates = buildPhoneCandidates(phoneNumber);
  const startDate = formatForVicidialDb(startAt);
  const endDate = formatForVicidialDb(endAt || DateTime.now());

  if (!dbPool || !phoneCandidates.length || !startDate || !endDate) {
    return {
      enabled: Boolean(dbPool),
      records: [],
    };
  }

  const [rows] = await dbPool.execute(
    `
      SELECT
        call_date,
        user,
        status,
        phone_number,
        lead_id,
        campaign_id,
        length_in_sec,
        uniqueid
      FROM vicidial_log
      WHERE call_date >= ?
        AND call_date <= ?
        AND phone_number IN (${phoneCandidates.map(() => "?").join(", ")})
      ORDER BY call_date ASC
      LIMIT ?
    `,
    [startDate, endDate, ...phoneCandidates, Number(limit)],
  );

  return {
    enabled: true,
    records: rows
      .map((row) => ({
        dateTime: parseCallDate(row.call_date),
        agentName: row.user || null,
        status: row.status || null,
        phoneNumber: row.phone_number || null,
        leadId: row.lead_id || null,
        campaignId: row.campaign_id || null,
        lengthInSeconds: row.length_in_sec ?? null,
        uniqueId: row.uniqueid || null,
        source: "vicidial_log",
      }))
      .filter((row) => row.dateTime?.isValid),
  };
}

async function canUseVicidialOutboundLog() {
  return vicidialDbConfig.enabled;
}

module.exports = {
  canUseVicidialOutboundLog,
  searchVicidialOutboundCallsByPhone,
};
