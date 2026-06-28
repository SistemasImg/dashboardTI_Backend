const axios = require("axios");
const logger = require("../../utils/logger");
const vicidialConfig = require("../../config/vicidial");
const {
  INCLUDED_VICIDIAL_USER_STATS_USERS,
} = require("../../config/vicidialUserStats");
const {
  parseVicidialUserStatsOutboundCalls,
} = require("../../utils/vicidialUserStatsParser");
const { normalizePhone } = require("../salesforce/phoneLookup.service");

const USER_STATS_URL = `${vicidialConfig.ADMIN_BASE_URL}/user_stats.php`;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_ZONE = "America/Lima";

function normalizeDateInput(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (typeof value.toISODate === "function") {
    return value.toISODate();
  }
  return null;
}

function getVicidialHeaders() {
  const username = process.env.VICIDIAL_USER;
  const password = process.env.VICIDIAL_PASS;

  if (!username || !password) {
    return null;
  }

  const token = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    Authorization: `Basic ${token}`,
    "User-Agent": "Mozilla/5.0",
    Referer: `${vicidialConfig.ADMIN_BASE_URL}/`,
    Origin: vicidialConfig.ORIGIN,
  };
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex;
      currentIndex += 1;
      results[itemIndex] = await iteratee(items[itemIndex], itemIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function fetchUserStatsHtml({ user, beginDate, endDate, timeoutMs }) {
  const headers = getVicidialHeaders();
  if (!headers) {
    return null;
  }

  const response = await axios.get(USER_STATS_URL, {
    headers,
    params: {
      DB: 0,
      NVAuser: "",
      did_id: "",
      did: "",
      pause_code_rpt: "",
      park_rpt: "",
      begin_date: beginDate,
      end_date: endDate,
      user,
      call_status: "",
      submit: "Submit",
    },
    timeout: timeoutMs,
  });

  return response.data;
}

function pushRecordToIndex(byPhone, record) {
  if (!byPhone.has(record.phoneNumber)) {
    byPhone.set(record.phoneNumber, []);
  }

  byPhone.get(record.phoneNumber).push(record);
}

async function buildVicidialOutboundIndexFromUserStats({
  startDate,
  endDate,
  phoneNumbers = [],
  users = INCLUDED_VICIDIAL_USER_STATS_USERS,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  zone = DEFAULT_ZONE,
}) {
  const beginDate = normalizeDateInput(startDate);
  const finishDate = normalizeDateInput(endDate);
  const headers = getVicidialHeaders();
  const targetPhones = new Set(
    phoneNumbers.map(normalizePhone).filter(Boolean),
  );
  const byPhone = new Map();
  const failures = [];
  let processedUsers = 0;
  let totalRecords = 0;

  if (!headers || !beginDate || !finishDate || !users.length) {
    return {
      enabled: false,
      byPhone,
      usersRequested: users.length,
      usersProcessed: 0,
      usersFailed: 0,
      totalRecords: 0,
    };
  }

  await mapWithConcurrency(users, concurrency, async (user) => {
    try {
      const html = await fetchUserStatsHtml({
        user,
        beginDate,
        endDate: finishDate,
        timeoutMs,
      });
      const parsedRows = parseVicidialUserStatsOutboundCalls(html, {
        reportUser: user,
        zone,
      });

      processedUsers += 1;

      parsedRows.forEach((record) => {
        if (targetPhones.size && !targetPhones.has(record.phoneNumber)) {
          return;
        }

        totalRecords += 1;
        pushRecordToIndex(byPhone, record);
      });
    } catch (error) {
      failures.push({
        user,
        message: error.message,
      });
      logger.warn("Vicidial user_stats lookup skipped for user", {
        user,
        message: error.message,
      });
    }
  });

  byPhone.forEach((records) => {
    records.sort(
      (left, right) => left.dateTime.toMillis() - right.dateTime.toMillis(),
    );
  });

  logger.info("Vicidial user_stats outbound index built", {
    beginDate,
    finishDate,
    usersRequested: users.length,
    usersProcessed: processedUsers,
    usersFailed: failures.length,
    totalRecords,
    filteredPhones: targetPhones.size || "all",
  });

  return {
    enabled: true,
    byPhone,
    usersRequested: users.length,
    usersProcessed: processedUsers,
    usersFailed: failures.length,
    failures,
    totalRecords,
  };
}

module.exports = {
  buildVicidialOutboundIndexFromUserStats,
};
