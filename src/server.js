const app = require("./app");
const sequelize = require("./config/db");
require("dotenv").config();

const PORT = process.env.PORT || 4000;

sequelize
  .authenticate()
  .then(() => {
    console.log("Connection to the established database");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.error("Error connecting to database: ", err));
