function logWithMeta(prefix, msg, meta, method = "log") {
  const message = typeof msg === "string" ? msg : JSON.stringify(msg);

  if (meta === undefined) {
    console[method](`${prefix} ${message}`);
    return;
  }

  console[method](`${prefix} ${message}`, meta);
}

const logger = {
  info: (msg, meta) => logWithMeta("📘 INFO:", msg, meta),
  success: (msg, meta) => logWithMeta("✅ SUCCESS:", msg, meta),
  warn: (msg, meta) => logWithMeta("⚠️ WARNING:", msg, meta),
  error: (msg, meta) => logWithMeta("❌ ERROR:", msg, meta, "error"),
};

module.exports = logger;
