process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require("dotenv").config();

const app = require("./app");
const sequelize = require("./config/db");

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected successfully");
    require("./jobs");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("❌ Application failed to start:", err);
    process.exit(1);
  }
})();
