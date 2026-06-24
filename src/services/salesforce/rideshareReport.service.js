const logger = require("../../utils/logger");
const { verifyAccessToken } = require("../../utils/verifyAccessToken");
const { DateTime } = require("luxon");
const { User } = require("../../models");
const {
  updateActiveAssignmentAttempts,
} = require("../../services/caseAssignments.service");

const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const {
  runSoqlQuery,
  runSoqlQueryAll,
} = require("../../services/salesforce/client.service");

const {
  buildMonitoringCasesQuery,
  buildDailyInflowCasesQuery,
  buildDailyOutflowCasesQuery,
  buildLeadOpportunityCaseNumbersQuery,
} = require("../../services/salesforce/queries/case.query");
const {
  buildUsersQuery,
} = require("../../services/salesforce/queries/user.query");

const {
  mapMonitoringCase,
  mapOperationalFlowCase,
} = require("../../services/salesforce/mappers/case.mapper");
const {
  mapUsersName,
} = require("../../services/salesforce/mappers/users.mapper");

const {
  getAttemptsLastNDays,
  getTotalAttempts,
} = require("../../services/attemptsDaily.service");

const {
  ActiveAssignmentsDaily,
} = require("../../services/caseAssignments.service");

const DEFAULT_CASE_OWNER = "Marketing Digital";
const LEAD_OPPORTUNITY_CASE_NUMBER_BATCH_SIZE = 100;

function buildUsersMap(userRecords) {
  return new Map(
    userRecords
      .map(mapUsersName)
      .filter(Boolean)
      .map((user) => [user.id, user.name]),
  );
}

function normalizeDailyFlowParams({ date, type }) {
  const normalizedDate = String(date || "").trim();
  const normalizedType = String(type || "").trim();
  const resolvedDate = normalizedDate || getPeruDateKey(0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
    throw Object.assign(new Error("date is required in YYYY-MM-DD format"), {
      statusCode: 400,
    });
  }

  return {
    date: resolvedDate,
    type: normalizedType || null,
  };
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function getLeadOpportunityCaseNumberSet(sf, caseRecords, caseType) {
  const caseNumbers = caseRecords
    .map((record) => record.CaseNumber)
    .filter(Boolean);

  if (!caseNumbers.length) {
    return new Set();
  }

  const chunks = chunkItems(
    caseNumbers,
    LEAD_OPPORTUNITY_CASE_NUMBER_BATCH_SIZE,
  );
  const results = await Promise.all(
    chunks.map((chunk) =>
      runSoqlQueryAll(
        sf,
        buildLeadOpportunityCaseNumbersQuery(chunk, caseType),
      ),
    ),
  );

  return new Set(
    results
      .flat()
      .map((record) => record.Lead__r?.CaseNumber)
      .filter(Boolean),
  );
}

async function getDailyOperationalFlow({ date, type, flowType }) {
  const params = normalizeDailyFlowParams({ date, type });
  const isInflow = flowType === "inflow";

  logger.info(
    `RideshareReportService → getDailyOperationalFlow() | flowType=${flowType} date=${params.date} type=${params.type || "all"}`,
  );

  const sf = await authenticateSalesforce();
  const query = isInflow
    ? buildDailyInflowCasesQuery(params.date, params.type)
    : buildDailyOutflowCasesQuery(params.date, params.type);

  const [caseRecords, userRecords] = await Promise.all([
    runSoqlQueryAll(sf, query),
    runSoqlQuery(sf, buildUsersQuery()),
  ]);

  let eligibleCaseRecords = caseRecords;
  let leadOpportunityValidation = null;

  if (!isInflow) {
    const leadOpportunityCaseNumbers = await getLeadOpportunityCaseNumberSet(
      sf,
      caseRecords,
      params.type,
    );

    eligibleCaseRecords = caseRecords.filter((record) =>
      leadOpportunityCaseNumbers.has(record.CaseNumber),
    );

    leadOpportunityValidation = {
      required: true,
      source: "Lead_de_oportunidad__c",
      matched: eligibleCaseRecords.length,
      excludedWithoutLeadOpportunity:
        caseRecords.length - eligibleCaseRecords.length,
    };
  }

  const usersMap = buildUsersMap(userRecords);
  const data = eligibleCaseRecords.map((record) =>
    mapOperationalFlowCase(
      record,
      usersMap.get(record.OwnerId) ?? DEFAULT_CASE_OWNER,
    ),
  );

  logger.success(
    `RideshareReportService → getDailyOperationalFlow() success | flowType=${flowType} total=${data.length}`,
  );

  return {
    total: data.length,
    flowType,
    date: params.date,
    type: params.type || "all",
    basedOn: isInflow
      ? {
          rule: "Case created during the selected Salesforce day",
          dateField: "CreatedDate",
          filters: [
            "CreatedDate inside selected day",
            params.type ? "Type equals requested type" : "All case types",
          ],
        }
      : {
          rule: "Case sent during the selected Salesforce day",
          dateField: "Sent_Date2__c",
          filters: [
            "Sent_Date2__c inside selected day",
            params.type ? "Type equals requested type" : "All case types",
            "CaseNumber exists in Lead_de_oportunidad__c with Lead__r.Substatus__c = Signed",
          ],
        },
    leadOpportunityValidation,
    data,
  };
}

async function getDailyInflowReport(params) {
  return getDailyOperationalFlow({ ...params, flowType: "inflow" });
}

async function getDailyOutflowReport(params) {
  return getDailyOperationalFlow({ ...params, flowType: "outflow" });
}

function normalizeSFPhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

function getPeruDateKey(daysAgo = 0) {
  return DateTime.now()
    .setZone("America/Lima")
    .minus({ days: daysAgo })
    .toFormat("yyyy-LL-dd");
}

async function getRideshareReport(token) {
  try {
    let decoded = null;
    let userId = null;
    if (token) {
      decoded = verifyAccessToken(token);
      userId = decoded.id;
    }

    // 1️⃣ Auth Salesforce
    const sf = await authenticateSalesforce();

    const [monitoringRecords, usersRecords] = await Promise.all([
      runSoqlQuery(sf, buildMonitoringCasesQuery()),
      runSoqlQuery(sf, buildUsersQuery()),
    ]);

    // SQL Queries in Parallel
    const [attemptsByDate, attemptsTotal, activeAssignments] =
      await Promise.all([
        getAttemptsLastNDays(3),
        getTotalAttempts(),
        ActiveAssignmentsDaily(),
      ]);

    // 2️⃣ Table Case
    const allCases = monitoringRecords.map(mapMonitoringCase);

    // 3️⃣ Users → Supplier
    const usersData = usersRecords.map(mapUsersName);

    // 4️⃣ Agent Assignments
    const assignmentMap = new Map();
    activeAssignments.forEach(({ case_number, agent }) => {
      assignmentMap.set(case_number, {
        fullname: agent.fullname,
        call_center: agent.callCenter.name,
      });
    });

    // 5️⃣ Merge Cases with Users
    const usersMap = new Map(usersData.map((user) => [user.id, user.name]));

    const casesWithSupplier = allCases.map((item) => {
      const phone = normalizeSFPhone(item.phoneNumber);
      return {
        ...item,
        phone,
        ownerName: usersMap.get(item.ownerId) ?? null,
      };
    });

    // 6️⃣ Attempts Data Mapping
    const today = getPeruDateKey(0);
    const yesterday = getPeruDateKey(1);
    const twoDaysAgo = getPeruDateKey(2);
    const todayMap = new Map();
    const yesterdayMap = new Map();
    const twoDaysAgoMap = new Map();

    attemptsByDate.forEach(({ phone, call_date, attempts }) => {
      if (call_date === today) todayMap.set(phone, attempts);
      else if (call_date === yesterday) yesterdayMap.set(phone, attempts);
      else if (call_date === twoDaysAgo) twoDaysAgoMap.set(phone, attempts);
    });

    const totalMap = new Map(
      attemptsTotal.map((r) => [r.phone, Number(r.totalAttempts)]),
    );

    // 7️⃣ Final Data Assembly
    let finalCases = casesWithSupplier.map((item) => {
      const phone = normalizeSFPhone(item.phoneNumber);

      return {
        ...item,
        ownerName: item?.ownerName || "Marketing Digital",
        substatus: item?.substatus || "Pending",
        date1: today,
        attempts1: todayMap.get(phone) ?? 0,

        date2: yesterday,
        attempts2: yesterdayMap.get(phone) ?? 0,

        date3: twoDaysAgo,
        attempts3: twoDaysAgoMap.get(phone) ?? 0,

        totalAttempts: totalMap.get(phone) ?? 0,

        assignedAgent: assignmentMap.get(item.caseNumber) ?? null,
      };
    });

    // 🔥 Update assignment attempts

    logger.info(`Updating attempts`);
    const updates = finalCases
      .filter((item) => item.assignedAgent !== null)
      .map((item) => {
        return updateActiveAssignmentAttempts({
          case_number: item.caseNumber,
          attempts: item.attempts1,
        });
      });
    await Promise.allSettled(updates);

    //Intake User Role Filtering
    if (token) {
      if (decoded.role_id === 4 || decoded.role_id === 5) {
        const { dataValues } = await User.findByPk(userId);
        if (!dataValues) throw new Error("user not found");
        const agent = await User.findOne({
          where: { id: dataValues.id },
        });
        if (agent) {
          finalCases = finalCases.filter(
            (item) =>
              item.assignedAgent &&
              item.assignedAgent.fullname === agent.dataValues.fullname,
          );
        } else {
          finalCases = [];
        }
      }
    }

    // 7️⃣ Return final response
    return {
      total: finalCases.length,
      data: finalCases,
    };
  } catch (error) {
    logger.error("RideshareReportService → getRideshareReport() failed", {
      message: error.message,
      stack: error.stack,
      origin: "service",
    });

    throw error;
  }
}

module.exports = {
  getRideshareReport,
  getDailyInflowReport,
  getDailyOutflowReport,
};
