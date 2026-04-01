process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require("dotenv").config();

const app = require("./app");
const sequelize = require("./config/db");

const PORT = process.env.PORT || 4000;

sequelize
  .authenticate()
  .then(() => {
    console.log("Connection to the established database");
    require("./jobs");
  })
  .catch((err) => {
    console.error("Error connecting to database: ", err);
  });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
