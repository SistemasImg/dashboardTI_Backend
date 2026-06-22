let tokenCache = null;
let csrfCache = null;

function getCachedOAuthToken() {
  if (!tokenCache) return null;
  if (Date.now() >= tokenCache.expiresAt) {
    tokenCache = null;
    return null;
  }
  return tokenCache.accessToken;
}

function setCachedOAuthToken(accessToken, expiresInSeconds) {
  const ttlMs = Math.max(Number(expiresInSeconds || 300) - 60, 60) * 1000;
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + ttlMs,
  };
}

function getCachedCsrfToken(cacheKey) {
  if (!csrfCache || csrfCache.cacheKey !== cacheKey) return null;
  if (Date.now() >= csrfCache.expiresAt) {
    csrfCache = null;
    return null;
  }
  return csrfCache;
}

function setCachedCsrfToken(cacheKey, token, cookie) {
  csrfCache = {
    cacheKey,
    token,
    cookie,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
}

function clearCachedCsrfToken() {
  csrfCache = null;
}

module.exports = {
  getCachedOAuthToken,
  setCachedOAuthToken,
  getCachedCsrfToken,
  setCachedCsrfToken,
  clearCachedCsrfToken,
};
