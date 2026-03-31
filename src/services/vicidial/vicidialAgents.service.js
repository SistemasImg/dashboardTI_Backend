const axios = require("axios");
const config = require("../../config/vicidial");
const logger = require("../../utils/logger");

const {
  parseLoggedAgents,
  parseAgentStatus,
} = require("../../utils/vicidialParser");

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

  const results = await Promise.all(
    agents.map(async (agent) => {
      const detail = await getAgentDetail(agent.user);

      return {
        user: agent.user,
        name: agent.full_name,
        status: detail?.status || agent.status,
        campaign: detail?.campaign || agent.campaign,
        calls_today: agent.calls_today,
        sub_status: detail?.sub_status || null,
        phone: detail?.phone || null,
      };
    }),
  );

  logger.success("Realtime agents data assembled successfully");

  return results;
};

module.exports = {
  getAgentsRealtime,
};
