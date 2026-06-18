const SYNC_KEYS = {
  FULL: "fullVendorSync",
  SALESFORCE_TO_MYSQL: "salesforceVendorsToMysql",
  CLASSIFICATION: "vendorClassification",
};

function createInitialStatus() {
  return {
    status: "idle",
    source: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastResult: null,
  };
}

const syncState = {
  [SYNC_KEYS.FULL]: createInitialStatus(),
  [SYNC_KEYS.SALESFORCE_TO_MYSQL]: createInitialStatus(),
  [SYNC_KEYS.CLASSIFICATION]: createInitialStatus(),
};

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cloneStatus(status) {
  return {
    ...status,
    lastStartedAt: toIso(status.lastStartedAt),
    lastFinishedAt: toIso(status.lastFinishedAt),
    lastSuccessAt: toIso(status.lastSuccessAt),
    lastErrorAt: toIso(status.lastErrorAt),
  };
}

function getVendorSyncStatus() {
  return {
    full: cloneStatus(syncState[SYNC_KEYS.FULL]),
    salesforceToMysql: cloneStatus(syncState[SYNC_KEYS.SALESFORCE_TO_MYSQL]),
    classification: cloneStatus(syncState[SYNC_KEYS.CLASSIFICATION]),
  };
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return result ?? null;

  const summary = {};
  if (result.summary) summary.summary = result.summary;
  if (result.synced !== undefined) summary.synced = result.synced;
  if (result.deactivated !== undefined)
    summary.deactivated = result.deactivated;
  if (result.rules) summary.rules = result.rules;
  if (result.salesforceMetadata) {
    summary.salesforceMetadata = result.salesforceMetadata;
  }
  if (result.caseSnapshots) summary.caseSnapshots = result.caseSnapshots;

  return Object.keys(summary).length ? summary : null;
}

function markSyncStarted(key, source) {
  const status = syncState[key];
  if (!status) return;

  status.status = "running";
  status.source = source || null;
  status.lastStartedAt = new Date();
  status.lastFinishedAt = null;
  status.lastError = null;
}

function markSyncSuccess(key, result) {
  const status = syncState[key];
  if (!status) return;

  const now = new Date();
  status.status = "success";
  status.lastFinishedAt = now;
  status.lastSuccessAt = now;
  status.lastError = null;
  status.lastResult = summarizeResult(result);
}

function markSyncFailure(key, error) {
  const status = syncState[key];
  if (!status) return;

  const now = new Date();
  status.status = "failed";
  status.lastFinishedAt = now;
  status.lastErrorAt = now;
  status.lastError = error?.message || String(error || "Unknown error");
}

async function trackVendorSync(key, source, task) {
  markSyncStarted(key, source);

  try {
    const result = await task();
    markSyncSuccess(key, result);
    return result;
  } catch (error) {
    markSyncFailure(key, error);
    throw error;
  }
}

module.exports = {
  SYNC_KEYS,
  getVendorSyncStatus,
  trackVendorSync,
};
