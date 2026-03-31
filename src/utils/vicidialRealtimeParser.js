const cheerio = require("cheerio");
const logger = require("./logger");

// Parse HTML from AST_timeonVDADall.php
const parseRealtimeTable = (html) => {
  const $ = cheerio.load(html);

  const agents = [];

  // Find the table rows
  $("table tr").each((i, row) => {
    const cols = $(row).find("td");

    if (cols.length < 8) return;

    const agent = {
      station: $(cols[0]).text().trim(),
      name: $(cols[1]).text().trim(),
      session_id: $(cols[2]).text().trim(),
      status: $(cols[3]).text().trim(),
      pause: $(cols[4]).text().trim(),
      duration: $(cols[5]).text().trim(),
      campaign: $(cols[6]).text().trim(),
      calls: $(cols[7]).text().trim(),
    };

    // Avoid empty rows
    if (agent.name && agent.status) {
      agents.push(agent);
    }
  });

  logger.success(`Parsed ${agents.length} realtime agents`);

  return agents;
};

module.exports = {
  parseRealtimeTable,
};
