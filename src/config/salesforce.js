module.exports = {
  loginUrl: "https://login.salesforce.com/services/oauth2/token",
  apiVersion: "v59.0",

  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  username: process.env.SF_USERNAME,
  password: process.env.SF_PASSWORD,
};
