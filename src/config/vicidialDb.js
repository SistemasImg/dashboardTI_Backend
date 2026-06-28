require("dotenv").config();

function getNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const vicidialDbConfig = {
  host: process.env.VICIDIAL_DB_HOST,
  port: getNumber(process.env.VICIDIAL_DB_PORT, 3306),
  user: process.env.VICIDIAL_DB_USER,
  password: process.env.VICIDIAL_DB_PASSWORD,
  database: process.env.VICIDIAL_DB_NAME || "asterisk",
  timezone: process.env.VICIDIAL_DB_TIMEZONE || "America/Lima",
  connectionLimit: getNumber(process.env.VICIDIAL_DB_CONNECTION_LIMIT, 5),
};

vicidialDbConfig.enabled = Boolean(
  vicidialDbConfig.host &&
  vicidialDbConfig.user &&
  vicidialDbConfig.password &&
  vicidialDbConfig.database,
);

module.exports = vicidialDbConfig;
