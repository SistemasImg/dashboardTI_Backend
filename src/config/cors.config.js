const cors = require("cors");

const allowedOrigins = [
  "http://localhost:5173",
  "https://dashboardtifronted.vercel.app",
  "https://dashboard.img360.com",
];

module.exports = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Access denied by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
