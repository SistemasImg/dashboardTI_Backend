const logger = require("../utils/logger");
const { getAttemptsByDate } = require("../services/sqlserver/attempts.service");
const { AttemptsDaily } = require("../models");

function normalizePhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  return null;
}

async function syncAttemptsDaily() {
  logger.info("🔄 Starting syncAttemptsDaily job");

  const result = await getAttemptsByDate();
  const rows = result.recordset;

  logger.info(`📥 SQL Server rows: ${rows.length}`);

  const grouped = new Map();

  for (const row of rows) {
    const phone = normalizePhone(row.ANI);
    if (!phone) continue;

    const date = row.CallDate.toISOString().split("T")[0];
    const key = `${phone}_${date}`;

    grouped.set(key, {
      phone,
      call_date: date,
      attempts: row.AttemptsSQL || 0,
    });
  }

  logger.info(`📦 Records to upsert: ${grouped.size}`);

  // UPSERT en MySQL
  for (const record of grouped.values()) {
    await AttemptsDaily.upsert(record);
  }

  logger.info("✅ syncAttemptsDaily completed");
}

module.exports = {
  syncAttemptsDaily,
};
