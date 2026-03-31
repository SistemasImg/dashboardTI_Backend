const express = require("express");
const app = express();

app.set("trust proxy", 1);

// ------------------------------
// 1. SECURITY MIDDLEWARES
// ------------------------------
require("./config/security.config")(app); // Helmet + sanitizers

// ------------------------------
// 2. CORS CONFIG
// ------------------------------
const corsConfig = require("./config/cors.config");
app.use(corsConfig);

// ------------------------------
// 3. RATE LIMIT (login)
// ------------------------------
const { loginLimiter } = require("./config/rateLimiter.config");
app.use("/auth/login", loginLimiter);

// ------------------------------
// 4. BODY PARSER
// ------------------------------
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true }));

// ------------------------------
// 5. ROUTES
// ------------------------------
app.use("/auth", require("./routes/auth.routes"));
app.use("/users", require("./routes/users.routes"));
app.use("/roles", require("./routes/roles.routes"));
app.use("/domains", require("./routes/domain.routes"));
app.use("/products", require("./routes/product.routes"));
app.use("/uat", require("./routes/uat.routes"));
app.use("/salesforce", require("./routes/salesforce.routes"));
app.use("/assign", require("./routes/caseAssignments.routes"));
app.use("/state", require("./routes/state.routes"));
app.use("/api", require("./routes/apiSend.routes"));
app.use("/owner", require("./routes/owner.routes"));
app.use("/infobit", require("./routes/infobit.routes"));
app.use("/mediaFiles", require("./routes/mediaFile.routes"));
app.use("/summary", require("./routes/summary.routes"));
app.use("/gravity-to-ghl", require("./routes/ghl/gravityForms.routes"));
app.use("/ghl-to-salesforce", require("./routes/ghl/ghlSubStatus.routes"));
app.use("/salesforce-to-ghl", require("./routes/ghl/subStatus.routes"));
app.use("/chatbot", require("./modules/chatbot/chatbot.routes"));
app.use("/callcenter", require("./routes/callCenter.routes"));
app.use("/vicidial", require("./routes/vicidial.routes"));
app.use("/sqlserver", require("./routes/sqlserver/insertApi.routes"));

// ------------------------------
// HEALTH CHECK (Render / Monitoring)
// ------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ------------------------------
// 6. GLOBAL ERROR HANDLER
// ------------------------------
app.use((err, req, res, next) => {
  console.error("🔥 Internal Error:", err.message);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

module.exports = app;
