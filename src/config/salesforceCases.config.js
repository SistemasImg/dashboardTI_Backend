module.exports = {
  url: "https://api.imediagroup360.com/wp-json/wpSfApi/v1/load",
  fallbackUrl: process.env.SALESFORCE_CASES_FALLBACK_URL,
  userAgent:
    process.env.SALESFORCE_CASES_USER_AGENT ||
    "dashboardti-backend-salesforce-cases/1.0",
  internalKey: process.env.SALESFORCE_CASES_INTERNAL_KEY,

  // Backward compatible env vars: prefer explicit names and fallback to legacy.
  username: process.env.API_USER,
  password: process.env.API_PASSWORD,
};
