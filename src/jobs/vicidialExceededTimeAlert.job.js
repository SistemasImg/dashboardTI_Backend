const logger = require("../utils/logger");
const {
  getAgentsRealtime,
} = require("../services/vicidial/vicidialAgents.service");
const { sendVicidialExceededTimeEmail } = require("../services/email.service");

const RULES = {
  MEAL_CZX: { label: "Meal", maxSeconds: 30 * 60 },
  MEAL_DEFAULT: { label: "Meal", maxSeconds: 60 * 60 },
  MANDIAL: { label: "ManDial", maxSeconds: 5 * 60 },
  BACKOFF: { label: "BackOff", maxSeconds: 5 * 60 },
  BATHBREAK: { label: "BathBreak", maxSeconds: 10 * 60 },
  DISPO: { label: "Dispo", maxSeconds: 2 * 60 },
};

const sentAlerts = new Set();

const normalizeCode = (value) =>
  String(value || "")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "");

const secondsToClock = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;

  if (hh > 0)
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
};

const resolveRule = (agent) => {
  const statusCode = normalizeCode(agent.status);
  const pauseCode = normalizeCode(agent.pause_code);
  const campaignCode = normalizeCode(agent.campaign);

  if (statusCode === "DISPO") return RULES.DISPO;

  if (pauseCode === "MEAL") {
    return campaignCode === "CZXIN" ? RULES.MEAL_CZX : RULES.MEAL_DEFAULT;
  }
  if (pauseCode === "MANDIAL" || pauseCode === "MANDIA") return RULES.MANDIAL;
  if (pauseCode === "BACKOFF" || pauseCode === "BACKOF") return RULES.BACKOFF;
  if (pauseCode === "BATHBREAK" || pauseCode === "BATHBR")
    return RULES.BATHBREAK;
  if (pauseCode === "DISPO") return RULES.DISPO;

  return null;
};

const buildAlertKey = (agent, rule) =>
  `${agent.user || agent.name}-${rule.label}`.toUpperCase();

async function runVicidialExceededTimeAlertJob() {
  logger.info("Starting runVicidialExceededTimeAlertJob");

  try {
    const agents = await getAgentsRealtime();
    const nextSentAlerts = new Set();
    const alertsToSend = [];

    for (const agent of agents) {
      const rule = resolveRule(agent);
      if (!rule) continue;

      const seconds = Number(agent.time_in_status_seconds);
      if (!Number.isFinite(seconds)) continue;

      if (seconds <= rule.maxSeconds) continue;

      const key = buildAlertKey(agent, rule);
      nextSentAlerts.add(key);

      if (sentAlerts.has(key)) continue;

      const exceeded = seconds - rule.maxSeconds;

      alertsToSend.push({
        user: agent.user,
        name: agent.name,
        campaign: agent.campaign,
        status: agent.status,
        pause_code: agent.pause_code,
        rule_label: `${rule.label} (> ${secondsToClock(rule.maxSeconds)})`,
        time_in_status: agent.time_in_status || secondsToClock(seconds),
        max_allowed: secondsToClock(rule.maxSeconds),
        exceeded_by: secondsToClock(exceeded),
      });
    }

    sentAlerts.clear();
    for (const key of nextSentAlerts) sentAlerts.add(key);

    if (alertsToSend.length > 0) {
      await sendVicidialExceededTimeEmail({
        alerts: alertsToSend,
        generatedAt: new Date().toISOString(),
      });

      logger.info(
        `Vicidial exceeded-time alerts sent for ${alertsToSend.length} agent(s)`,
      );
    } else {
      logger.info("No Vicidial exceeded-time alerts detected");
    }
  } catch (error) {
    logger.error("runVicidialExceededTimeAlertJob failed", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  runVicidialExceededTimeAlertJob,
};
