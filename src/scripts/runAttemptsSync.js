require("dotenv").config();
const { syncAttemptsDaily } = require("../jobs/syncAttempts.job");

syncAttemptsDaily()
  .then(() => {
    console.log("✔ Sync finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Sync failed", err);
    process.exit(1);
  });
