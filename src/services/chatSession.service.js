const ChatSession = require("../models/chatSession.model");
const logger = require("../utils/logger");

// Maximum messages retained per user to stay within the AI model's context window
const MAX_HISTORY_MESSAGES = 40;

/**
 * Loads (or creates) a chat session for the given user.
 * Returns { messages, last_filters, last_results }
 */
async function getOrCreateSession(userId) {
  try {
    const [session] = await ChatSession.findOrCreate({
      where: { user_id: userId },
      defaults: {
        user_id: userId,
        messages: [],
        last_filters: null,
        last_results: null,
      },
    });

    return {
      messages: session.messages || [],
      last_filters: session.last_filters || null,
      last_results: session.last_results || null,
    };
  } catch (err) {
    logger.error(
      `[ChatSession] Failed to load session for user ${userId}: ${err.message}`,
    );
    // Fallback to empty in-memory session if DB is unavailable
    return {
      messages: [],
      last_filters: null,
      last_results: null,
    };
  }
}

/**
 * Appends new messages to the user's history and updates last filters/results.
 * @param {number} userId - Authenticated user ID
 * @param {{ role: string, content: string }[]} newMessages - Messages to append (user + assistant)
 * @param {object|null} lastFilters - Last filters applied
 * @param {object|null} lastResults - Summary of last results
 */
async function appendMessages(
  userId,
  newMessages,
  lastFilters = null,
  lastResults = null,
) {
  try {
    const session = await ChatSession.findOne({ where: { user_id: userId } });
    if (!session) return;

    const existing = session.messages || [];
    const withTimestamp = newMessages.map((m) => ({
      ...m,
      timestamp: new Date().toISOString(),
    }));

    // Merge and trim to MAX_HISTORY_MESSAGES to stay within AI context limits
    const updated = [...existing, ...withTimestamp].slice(
      -MAX_HISTORY_MESSAGES,
    );

    await session.update({
      messages: updated,
      last_filters: lastFilters ?? session.last_filters,
      last_results:
        lastResults === null
          ? session.last_results
          : summarizeResults(lastResults),
    });
  } catch (err) {
    logger.error(
      `[ChatSession] Failed to save messages for user ${userId}: ${err.message}`,
    );
  }
}

/**
 * Returns stored messages formatted for the AI model (role + content only, no timestamps).
 */
function buildMessagesForAI(storedMessages) {
  return storedMessages.map(({ role, content }) => ({ role, content }));
}

/**
 * Returns the full visible history for a user (includes timestamps for the UI).
 */
async function getSessionHistory(userId) {
  try {
    const session = await ChatSession.findOne({ where: { user_id: userId } });
    return session ? session.messages : [];
  } catch (err) {
    logger.error(
      `[ChatSession] Failed to fetch history for user ${userId}: ${err.message}`,
    );
    return [];
  }
}

/**
 * Resets the conversation history for a user (keeps the row, clears messages).
 */
async function clearSession(userId) {
  try {
    await ChatSession.update(
      { messages: [], last_filters: null, last_results: null },
      { where: { user_id: userId } },
    );
  } catch (err) {
    logger.error(
      `[ChatSession] Failed to clear session for user ${userId}: ${err.message}`,
    );
  }
}

/**
 * Generates a compact summary of results to avoid storing large payloads in the DB.
 * Only persists metadata (totals, type, date) — not the full records array.
 */
function summarizeResults(results) {
  if (!results) return null;
  if (typeof results !== "object") return null;

  return {
    totalSize: results.totalSize ?? results.total ?? null,
    type: results._type ?? null,
    date: results.dateScope ?? results.date ?? null,
    field: results.field ?? null,
    status: results.status ?? null,
    origin: results.origin ?? null,
  };
}

module.exports = {
  getOrCreateSession,
  appendMessages,
  buildMessagesForAI,
  getSessionHistory,
  clearSession,
};
