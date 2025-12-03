const rateLimit = require("express-rate-limit");

exports.loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many login attempts. Try again later." },
});
