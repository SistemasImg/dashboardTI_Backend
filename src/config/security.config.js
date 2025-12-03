const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");

module.exports = function securityMiddleware(app) {
  app.use(helmet());
  app.use(mongoSanitize());
  app.use(xss());
};
