let cachedToken = null;
let tokenExpiresAt = null;

function isTokenValid() {
  if (!cachedToken || !tokenExpiresAt) return false;
  return Date.now() < tokenExpiresAt;
}

function getCachedToken() {
  if (isTokenValid()) {
    return cachedToken;
  }
  return null;
}

function setCachedToken(token, expiresInSeconds) {
  cachedToken = token;
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000 - 60000;
  // -1 min de margen
}

module.exports = {
  getCachedToken,
  setCachedToken,
};
