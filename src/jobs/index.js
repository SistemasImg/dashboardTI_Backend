const cron = require("node-cron");
const logger = require("../utils/logger");
const { syncAttemptsDaily } = require("./syncAttempts.job");
const { syncInfobitStatusesJob } = require("./syncInfobitStatus.job");
const { syncInfobitInboundJob } = require("./syncInfobitInbound.job");
const {
  runVicidialExceededTimeAlertJob,
} = require("./vicidialExceededTimeAlert.job");
const {
  runTranscriptionStatusPollJob,
} = require("./transcriptionStatusPoll.job");
const { runVendorSyncJob } = require("./vendorSync.job");
const { runTimeToLeadSyncJob } = require("./timeToLeadSync.job");
const { runAttemptsAnalysisSyncJob } = require("./attemptsAnalysisSync.job");
const isProduction = process.env.NODE_ENV === "production";
const vendorSyncCronExpression =
  process.env.VENDOR_SYNC_CRON_EXPRESSION || "0 * * * *";
const timeToLeadCronExpression =
  process.env.TIME_TO_LEAD_SYNC_CRON_EXPRESSION || "*/15 * * * *";
const attemptsAnalysisCronExpression =
  process.env.ATTEMPTS_ANALYSIS_SYNC_CRON_EXPRESSION || "*/15 * * * *";

function buildTranscriptionCronExpression() {
  const rawValue = Number(
    process.env.TRANSCRIPTION_POLL_INTERVAL_SECONDS || 30,
  );

  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return "*/30 * * * * *";
  }

  const seconds = Math.floor(rawValue);

  if (seconds < 60 && 60 % seconds === 0) {
    return `*/${seconds} * * * * *`;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `*/${minutes} * * * *`;
}

function hasTranscriptionConfig() {
  const hasSpeech =
    !!process.env.AZURE_SPEECH_KEY &&
    (!!process.env.AZURE_SPEECH_ENDPOINT || !!process.env.AZURE_SPEECH_REGION);
  const hasStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

  return hasSpeech && hasStorage;
}

// Configure cron to run every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  logger.info("⏰ Cron triggered: syncAttemptsDaily");

  try {
    await syncAttemptsDaily();
    logger.info("✅ Cron syncAttemptsDaily completed");
  } catch (error) {
    logger.error("❌ Cron syncAttemptsDaily failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});

// Configure cron to run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  logger.info("⏰ Cron triggered: syncInfobitStatusesJob");

  try {
    await syncInfobitStatusesJob();
    logger.info("✅ Cron syncInfobitStatusesJob completed");
  } catch (error) {
    logger.error("❌ Cron syncInfobitStatusesJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});

// Configure cron to run every 2 minutes
cron.schedule("*/2 * * * *", async () => {
  logger.info("Cron triggered: syncInfobitInboundJob");

  try {
    await syncInfobitInboundJob();
    logger.info("Cron syncInfobitInboundJob completed");
  } catch (error) {
    logger.error("Cron syncInfobitInboundJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});

// Configure cron for vendor sync and category monitoring
cron.schedule(vendorSyncCronExpression, async () => {
  logger.info("Cron triggered: runVendorSyncJob");

  try {
    await runVendorSyncJob();
    logger.info("Cron runVendorSyncJob completed");
  } catch (error) {
    logger.error("Cron runVendorSyncJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});
logger.info(
  `Vendor monitoring job enabled with cron: ${vendorSyncCronExpression}`,
);

cron.schedule(timeToLeadCronExpression, async () => {
  logger.info("Cron triggered: runTimeToLeadSyncJob");

  try {
    await runTimeToLeadSyncJob();
    logger.info("Cron runTimeToLeadSyncJob completed");
  } catch (error) {
    logger.error("Cron runTimeToLeadSyncJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});
logger.info(
  `Time To Lead sync job enabled with cron: ${timeToLeadCronExpression}`,
);

cron.schedule(attemptsAnalysisCronExpression, async () => {
  logger.info("Cron triggered: runAttemptsAnalysisSyncJob");

  try {
    await runAttemptsAnalysisSyncJob();
    logger.info("Cron runAttemptsAnalysisSyncJob completed");
  } catch (error) {
    logger.error("Cron runAttemptsAnalysisSyncJob failed", {
      message: error.message,
      stack: error.stack,
    });
  }
});
logger.info(
  `Attempts analysis sync job enabled with cron: ${attemptsAnalysisCronExpression}`,
);

if (isProduction) {
  // Configure cron to run every minute
  cron.schedule("* * * * *", async () => {
    logger.info("Cron triggered: runVicidialExceededTimeAlertJob");

    try {
      await runVicidialExceededTimeAlertJob();
      logger.info("Cron runVicidialExceededTimeAlertJob completed");
    } catch (error) {
      logger.error("Cron runVicidialExceededTimeAlertJob failed", {
        message: error.message,
        stack: error.stack,
      });
    }
  });
} else {
  logger.info("Vicidial exceeded-time job disabled outside production");
}

if (hasTranscriptionConfig()) {
  const expression = buildTranscriptionCronExpression();

  cron.schedule(expression, async () => {
    logger.info("Cron triggered: runTranscriptionStatusPollJob");
    await runTranscriptionStatusPollJob();
  });

  logger.info(`Transcription poll job enabled with cron: ${expression}`);
} else {
  logger.info(
    "Transcription poll job disabled (missing Azure Speech/Storage env vars)",
  );
}

(async () => {
  logger.info("🚀 Initial syncAttemptsDaily on server start");

  try {
    await syncAttemptsDaily();
    logger.info("✅ Initial sync completed");
  } catch (error) {
    logger.error("❌ Initial sync failed", error);
  }
})();

(async () => {
  logger.info("🚀 Initial syncInfobitStatusesJob on server start");

  try {
    await syncInfobitStatusesJob();
    logger.info("✅ Initial Infobit sync completed");
  } catch (error) {
    logger.error("❌ Initial Infobit sync failed", error);
  }
})();

(async () => {
  logger.info("Initial syncInfobitInboundJob on server start");

  try {
    await syncInfobitInboundJob();
    logger.info("Initial Infobit inbound sync completed");
  } catch (error) {
    logger.error("Initial Infobit inbound sync failed", error);
  }
})();

(async () => {
  logger.info("Initial runVendorSyncJob on server start");

  try {
    await runVendorSyncJob();
    logger.info("Initial vendor sync completed");
  } catch (error) {
    logger.error("Initial vendor sync failed", error);
  }
})();

(async () => {
  logger.info("Initial runTimeToLeadSyncJob on server start");

  try {
    await runTimeToLeadSyncJob({ source: "startup" });
    logger.info("Initial Time To Lead sync completed");
  } catch (error) {
    logger.error("Initial Time To Lead sync failed", error);
  }
})();

(async () => {
  logger.info("Initial runAttemptsAnalysisSyncJob on server start");

  try {
    await runAttemptsAnalysisSyncJob({ source: "startup" });
    logger.info("Initial Attempts Analysis sync completed");
  } catch (error) {
    logger.error("Initial Attempts Analysis sync failed", error);
  }
})();

if (isProduction) {
  (async () => {
    logger.info("Initial runVicidialExceededTimeAlertJob on server start");

    try {
      await runVicidialExceededTimeAlertJob();
      logger.info("Initial Vicidial exceeded-time check completed");
    } catch (error) {
      logger.error("Initial Vicidial exceeded-time check failed", error);
    }
  })();
}

if (hasTranscriptionConfig()) {
  (async () => {
    logger.info("Initial runTranscriptionStatusPollJob on server start");

    try {
      await runTranscriptionStatusPollJob();
      logger.info("Initial transcription polling completed");
    } catch (error) {
      logger.error("Initial transcription polling failed", error);
    }
  })();
}
