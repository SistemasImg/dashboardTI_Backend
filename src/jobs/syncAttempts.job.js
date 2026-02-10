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
    const rows = result.recordset || [];

    logger.info(`📥 SQL Server rows: ${rows.length}`);

    if (!rows.length) {
      logger.warn("⚠️ No rows returned from SQL Server");
      return;
    }

    const grouped = new Map();

    for (const row of rows) {
      const phone = normalizePhone(row.ANI);
      if (!phone || !row.CallDate) continue;

      const date = row.CallDate.toISOString().split("T")[0];

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
    logger.error("❌ syncAttemptsDaily failed", {
      message: error.message,
      stack: error.stack,
    });
  }
}

module.exports = {
  syncAttemptsDaily,
};
