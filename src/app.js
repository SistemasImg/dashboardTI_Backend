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
// 4. JSON PARSER
// ------------------------------
app.use(express.json({ limit: "200kb" }));

// specific route with larger limit
// const controller = require("./controllers/uat.controller").handleUAT;
// app.post(
//   "/api/uat",
//   express.json({ limit: "300kb" }),
//   controller
// );

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
app.use("/agents", require("./routes/agents.routes"));
app.use("/assign", require("./routes/caseAssignments.routes"));
app.use("/state", require("./routes/state.routes"));
app.use("/api", require("./routes/apiSend.routes"));
app.use("/owner", require("./routes/owner.routes"));
app.use("/infobit", require("./routes/infobit.routes"));

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
