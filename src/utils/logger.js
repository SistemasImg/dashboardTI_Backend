const logger = {
  info: (msg) => console.log(`📘 INFO: ${msg}`),
  success: (msg) => console.log(`✅ SUCCESS: ${msg}`),
  warn: (msg) => console.log(`⚠️ WARNING: ${msg}`),
  error: (msg) => console.error(`❌ ERROR: ${msg}`),
};

module.exports = logger;
