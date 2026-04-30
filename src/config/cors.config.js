const cors = require("cors");

const allowedOrigins = [
  "http://localhost:5173",
  "https://dashboard-ti-three.vercel.app",
  "https://dashboard.img360.com",
];

const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const finalAllowedOrigins = new Set([...allowedOrigins, ...envOrigins]);

module.exports = cors({
  origin: (origin, callback) => {
    if (!origin || finalAllowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Access denied by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
