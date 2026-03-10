const logger = require("../../utils/logger");
const jwt = require("jsonwebtoken");
const { User, Agents } = require("../../models");

const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const { runSoqlQuery } = require("../../services/salesforce/client.service");

const {
  buildMonitoringCasesQuery,
} = require("../../services/salesforce/queries/case.query");
const {
  buildUsersQuery,
} = require("../../services/salesforce/queries/user.query");

const {
  mapMonitoringCase,
} = require("../../services/salesforce/mappers/case.mapper");
const {
  mapUsersName,
} = require("../../services/salesforce/mappers/users.mapper");

const {
  getAttemptsLastNDays,
  getTotalAttempts,
} = require("../../services/attemptsDaily.service");

const {
  getActiveAssignments,
} = require("../../services/caseAssignments.service");

function normalizeSFPhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

async function getRideshareReport(token) {
  try {
    let decoded = null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;
      logger.info(
        `Usuario ejecutando reporte: ${userId}, Role: ${decoded.role_id}`,
      );
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
        getActiveAssignments(),
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
        call_center: agent.call_center,
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
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .split("T")[0];
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000)
      .toISOString()
      .split("T")[0];
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

    //Intake User Role Filtering
    if (decoded) {
      if (decoded.role_id === 4 || decoded.role_id === 5) {
        const { dataValues } = await User.findByPk(userId);
        if (!dataValues) throw new Error("user not found");
        const agent = await Agents.findOne({
          where: { fullname: dataValues.fullname },
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
};
