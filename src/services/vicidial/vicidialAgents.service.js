const axios = require("axios");
const config = require("../../config/vicidial");
const logger = require("../../utils/logger");
const { getRealtimeFromVicidial } = require("./vicidialRealtime.service");

const {
  parseLoggedAgents,
  parseAgentStatus,
} = require("../../utils/vicidialParser");

const durationToSeconds = (duration) => {
  if (!duration || typeof duration !== "string") return null;

  const parts = duration.trim().split(":").map(Number);

  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
};

const normalizeName = (value) =>
  String(value || "")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toUpperCase();

// Base API call
const callVicidialApi = async (params) => {
  try {
    const response = await axios.get(`${config.BASE_URL}/non_agent_api.php`, {
      params: {
        source: config.SOURCE,
        user: config.USER,
        pass: config.PASS,
        stage: "pipe",
        header: "NO",
        ...params,
      },
    });

    return response.data;
  } catch (error) {
    logger.error(`Vicidial API error: ${error.message}`);
    throw error;
  }
};

// Get all logged agents
const getLoggedAgents = async () => {
  const rawData = await callVicidialApi({
    function: "logged_in_agents",
  });

  const agents = parseLoggedAgents(rawData);

  logger.success(`Fetched ${agents.length} logged agents`);

  return agents;
};

// Get detail for a single agent
const getAgentDetail = async (agentUser) => {
  const rawData = await callVicidialApi({
    function: "agent_status",
    agent_user: agentUser,
  });

  return parseAgentStatus(rawData);
};

// Main realtime function
const getAgentsRealtime = async () => {
  const agents = await getLoggedAgents();
  let realtimeBySessionId = new Map();
  let realtimeByName = new Map();

  try {
    const realtimeAgents = await getRealtimeFromVicidial();

    // Use first occurrence to avoid overwriting when duplicated sessions appear.
    for (const row of realtimeAgents) {
      if (row.session_id && !realtimeBySessionId.has(row.session_id)) {
        realtimeBySessionId.set(row.session_id, row);
      }

      const key = normalizeName(row.name);
      if (key && !realtimeByName.has(key)) {
        realtimeByName.set(key, row);
      }
    }
  } catch (error) {
    logger.warn(
      `Realtime duration unavailable for /vicidial/agents: ${error.message}`,
    );
  }

  const results = await Promise.all(
    agents.map(async (agent) => {
      const detail = await getAgentDetail(agent.user);
      const realtime =
        realtimeByName.get(normalizeName(agent.full_name)) ||
        realtimeBySessionId.get(agent.session_id);
      const timeInStatus = realtime?.duration || null;

      return {
        user: agent.user,
        name: agent.full_name,
        status: detail?.status || agent.status,
        campaign: detail?.campaign || agent.campaign,
        calls_today: agent.calls_today,
        sub_status: detail?.sub_status || null,
        phone: detail?.phone || null,
        pause_code: realtime?.pause || detail?.pause_code || null,
        time_in_status: timeInStatus,
        time_in_status_seconds: timeInStatus
          ? durationToSeconds(timeInStatus)
          : null,
      };
    }),
  );

  logger.success("Realtime agents data assembled successfully");

  return results;
};

module.exports = {
  getAgentsRealtime,
};
