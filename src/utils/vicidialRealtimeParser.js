const cheerio = require("cheerio");
const logger = require("./logger");

const extractUserFromName = (name) => {
  if (!name) return null;

  const match = name.trim().match(/^(\w+)/);

  return match ? match[1] : null;
};

const normalizeSpaces = (value) =>
  value.replaceAll("\u00a0", " ").replaceAll(/\s+/g, " ").trim();

const STATION_REGEX = /^(SIP|PJSIP|IAX|IAX2|DAHDI|LOCAL)\//i;
const TIME_REGEX = /^\d{1,2}:\d{2}(?::\d{2})?$/;

const parseStatusAndPause = (tokens) => {
  if (!tokens.length) {
    return { status: null, pause: "" };
  }

  let status = tokens[0];
  let pause = tokens.slice(1).join(" ");

  if (!pause) {
    const compact = status.match(/^(INCALL|DIAL)([A-Z])$/i);
    if (compact) {
      status = compact[1].toUpperCase();
      pause = compact[2].toUpperCase();
    }
  }

  return {
    status: status.toUpperCase(),
    pause,
  };
};

const parseAgentLine = (line) => {
  const normalizedLine = normalizeSpaces(line);

  if (!STATION_REGEX.test(normalizedLine)) return null;

  const lineMatch = normalizedLine.match(
    /^(?<station>\S+)\s+(?<name>.+?)\s+\+\s+(?<session_id>\d+)\s+(?<rest>.+)$/,
  );

  if (!lineMatch?.groups) return null;

  const { station, name, session_id, rest } = lineMatch.groups;
  const restTokens = rest.split(" ").filter(Boolean);
  const timeIndex = restTokens.findIndex((token) => TIME_REGEX.test(token));

  if (timeIndex < 1) return null;

  const { status, pause } = parseStatusAndPause(restTokens.slice(0, timeIndex));
  const duration = restTokens[timeIndex] || "";
  const campaign = restTokens[timeIndex + 1] || "";
  const calls = restTokens[timeIndex + 2] || "";

  let hold = "";
  let in_group = "";
  const afterCalls = restTokens.slice(timeIndex + 3);
  if (afterCalls.length && /^\d+$/.test(afterCalls[0])) {
    hold = afterCalls[0];
    in_group = afterCalls.slice(1).join(" ");
  } else {
    in_group = afterCalls.join(" ");
  }

  return {
    station,
    name,
    session_id,
    status,
    pause,
    duration,
    campaign,
    calls,
    hold,
    in_group,
    user: extractUserFromName(name),
  };
};

// Parse HTML from AST_timeonVDADall.php
const parseRealtimeTable = (html) => {
  const $ = cheerio.load(String(html || ""));
  const sourceText = $("body").text() || String(html || "");

  const agents = sourceText
    .split(/\r?\n/)
    .map((line) => parseAgentLine(line))
    .filter(Boolean);

  logger.success(`Parsed ${agents.length} realtime agents`);

  return agents;
};

module.exports = {
  parseRealtimeTable,
};
