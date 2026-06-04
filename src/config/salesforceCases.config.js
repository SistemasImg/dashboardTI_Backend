module.exports = {
  url: "https://api.imediagroup360.com/wp-json/wpSfApi/v1/load",

  // Backward compatible env vars: prefer explicit names and fallback to legacy.
  username: process.env.API_USER,
  password: process.env.API_PASSWORD,
};
