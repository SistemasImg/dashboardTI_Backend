const logger = require("./logger");

// Generic parser for pipe-separated Vicidial responses
const parsePipeResponse = (data) => {
  if (!data) {
    logger.warn("Empty response received from Vicidial");
    return [];
  }

  return data
    .trim()
    .split("\n")
    .filter((line) => line && !line.includes("ERROR"))
    .map((line) => line.split("|"));
};

// Parse logged_in_agents response
const parseLoggedAgents = (data) => {
  const rows = parsePipeResponse(data);

  return rows.map((r) => ({
    user: r[0],
    campaign: r[1],
    session_id: r[2],
    status: r[3],
    calls_today: r[6],
    full_name: r[7],
  }));
};

// Parse agent_status response
const parseAgentStatus = (data) => {
  if (!data || data.includes("ERROR")) {
    logger.warn("Invalid agent_status response");
    return null;
  }

  const row = data.trim().split("\n")[0].split("|");

  return {
    status: row[0],
    campaign: row[3],
    sub_status: row[9],
    phone: row[10],
  };
};

module.exports = {
  parseLoggedAgents,
  parseAgentStatus,
};
