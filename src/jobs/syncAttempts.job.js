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

  try {
    const result = await getAttemptsByDate();
    const rows = result?.recordset || [];

    logger.info(`📥 SQL Server rows: ${rows.length}`);

    if (!rows.length) {
      logger.warn("⚠️ No rows returned from SQL Server");
      return;
    }

    const grouped = new Map();

    for (const row of rows) {
      const phone = normalizePhone(row.ANI);
      if (!phone || !row.CallDate) continue;

      const callDateObj = new Date(row.CallDate);

      if (isNaN(callDateObj.getTime())) {
        logger.warn("⚠️ Invalid CallDate detected", {
          rawValue: row.CallDate,
        });
        continue;
      }

      const date = callDateObj.toISOString().split("T")[0];

      grouped.set(`${phone}_${date}`, {
        phone,
        call_date: date,
        attempts: row.AttemptsSQL || 0,
      });
    }

    logger.info(`📦 Records to upsert: ${grouped.size}`);

    for (const record of grouped.values()) {
      await AttemptsDaily.upsert(record);
    }

    logger.info("✅ syncAttemptsDaily completed");
  } catch (error) {
    console.error("❌ FULL ERROR OBJECT:");
    console.dir(error, { depth: null });

    logger.error("❌ syncAttemptsDaily failed", error);
  }
}

module.exports = {
  syncAttemptsDaily,
};
