const axios = require("axios");
const { Op } = require("sequelize");
const {
  BlobServiceClient,
  BlobSASPermissions,
  ContainerSASPermissions,
} = require("@azure/storage-blob");
const sequelize = require("../../config/db");
const logger = require("../../utils/logger");
const {
  fetchRecordingStream,
} = require("../vicidial/vicidialRecordingsDownload.service");
const {
  hasOpenAiConfig,
  generateTranscriptionInsights,
} = require("./transcriptionInsights.service");
const TranscriptionJob = require("../../models/transcriptionJob");
const TranscriptionSegment = require("../../models/transcriptionSegment");

const DEFAULT_LOCALE = process.env.TRANSCRIPTION_LOCALE || "en-US";
const BLOB_SAS_TTL_HOURS = 24;
const MAX_POLL_BATCH = 10;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function buildPersistedEnrichmentPayload(enrichedResult, aiInsights = null) {
  return {
    transcript_text: enrichedResult.transcriptText || null,
    conversation: enrichedResult.conversation || null,
    speaker_map: enrichedResult.speakerMap || null,
    speaker_summary: enrichedResult.speakerSummary || null,
    call_metrics: enrichedResult.callMetrics || null,
    call_outcome_code: enrichedResult.callOutcome?.code || null,
    call_outcome_label: enrichedResult.callOutcome?.label || null,
    next_action_code: enrichedResult.nextAction?.code || null,
    next_action_label: enrichedResult.nextAction?.label || null,
    ai_insights: aiInsights,
  };
}

function normalizeUrlString(value) {
  return String(value || "")
    .trim()
    .replace(/^"(.+)"$/, "$1")
    .replace(/^'(.+)'$/, "$1");
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw Object.assign(new Error(`${name} is required`), { statusCode: 400 });
  }
  return value;
}

function getSpeechBaseUrl() {
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT;
  const region = process.env.AZURE_SPEECH_REGION;

  if (endpoint) {
    const normalizedEndpoint = normalizeUrlString(endpoint).replace(/\/$/, "");

    try {
      const parsed = new URL(normalizedEndpoint);

      if (parsed.protocol !== "https:") {
        throw Object.assign(new Error("AZURE_SPEECH_ENDPOINT must use https"), {
          statusCode: 400,
        });
      }

      return parsed.toString().replace(/\/$/, "");
    } catch {
      throw Object.assign(
        new Error("AZURE_SPEECH_ENDPOINT is not a valid absolute URL"),
        {
          statusCode: 400,
        },
      );
    }
  }

  if (region) {
    return `https://${region}.api.cognitive.microsoft.com`;
  }

  throw Object.assign(
    new Error("AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION is required"),
    { statusCode: 400 },
  );
}

function getSpeechHeaders() {
  return {
    "Ocp-Apim-Subscription-Key": getRequiredEnv("AZURE_SPEECH_KEY"),
    "Content-Type": "application/json",
  };
}

function getBlobClients() {
  const connectionString = normalizeUrlString(
    getRequiredEnv("AZURE_STORAGE_CONNECTION_STRING"),
  );

  const hasAccountName = /(?:^|;)AccountName=/i.test(connectionString);
  const hasAccountKey = /(?:^|;)AccountKey=/i.test(connectionString);
  const hasBlobEndpoint = /(?:^|;)BlobEndpoint=/i.test(connectionString);

  if ((!hasAccountName || !hasAccountKey) && !hasBlobEndpoint) {
    throw Object.assign(
      new Error(
        "AZURE_STORAGE_CONNECTION_STRING must be a full Azure Storage connection string (not only the account key)",
      ),
      { statusCode: 400 },
    );
  }

  const inputContainerName =
    process.env.AZURE_STORAGE_CONTAINER_INPUT || "recordings-input";
  const outputContainerName =
    process.env.AZURE_STORAGE_CONTAINER_OUTPUT || "transcriptions-output";

  let blobServiceClient;

  try {
    blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
  } catch {
    throw Object.assign(
      new Error(
        "AZURE_STORAGE_CONNECTION_STRING is invalid. Copy it from Storage Account > Access keys > Connection string",
      ),
      { statusCode: 400 },
    );
  }

  return {
    inputContainerClient:
      blobServiceClient.getContainerClient(inputContainerName),
    outputContainerClient:
      blobServiceClient.getContainerClient(outputContainerName),
  };
}

function extractProviderJobId(providerSelfUrl) {
  if (!providerSelfUrl) return null;
  const clean = String(providerSelfUrl).replace(/\/$/, "");
  const chunks = clean.split("/");
  return chunks.at(-1) || null;
}

function assertAllowedRecordingUrl(url) {
  let parsed;
  const normalizedUrl = normalizeUrlString(url);

  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw Object.assign(new Error("recordingUrl is not a valid URL"), {
      statusCode: 400,
    });
  }

  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("recordingUrl must use https"), {
      statusCode: 400,
    });
  }

  if (parsed.hostname !== "img.integradial.us") {
    throw Object.assign(
      new Error("recordingUrl host is not allowed for transcription"),
      {
        statusCode: 400,
      },
    );
  }

  return parsed.toString();
}

function ticksToMilliseconds(ticks) {
  const value = Number(ticks);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value / 10000);
}

function parseAzureTranscriptionSegments(content) {
  let containers = [];

  if (Array.isArray(content)) {
    containers = content;
  } else if (content && typeof content === "object") {
    containers = [content];
  }

  const segments = [];

  containers.forEach((item) => {
    const phrases = Array.isArray(item?.recognizedPhrases)
      ? item.recognizedPhrases
      : [];

    phrases.forEach((phrase) => {
      const best =
        Array.isArray(phrase?.nBest) && phrase.nBest.length
          ? phrase.nBest[0]
          : null;
      const text =
        best?.display ||
        best?.displayWords?.join(" ") ||
        phrase?.display ||
        null;

      if (!text) return;

      const startMs = ticksToMilliseconds(phrase?.offsetInTicks || 0);
      const durationMs = ticksToMilliseconds(phrase?.durationInTicks || 0);
      const endMs = startMs + durationMs;
      const speakerValue =
        phrase?.speaker !== undefined && phrase?.speaker !== null
          ? `speaker_${phrase.speaker}`
          : "speaker_unknown";

      segments.push({
        speaker: speakerValue,
        start_ms: startMs,
        end_ms: endMs,
        text,
        confidence:
          typeof best?.confidence === "number" ? best.confidence : null,
        raw: phrase,
      });
    });

    if (!phrases.length && Array.isArray(item?.combinedRecognizedPhrases)) {
      item.combinedRecognizedPhrases.forEach((phrase, index) => {
        const text = phrase?.display || phrase?.lexical || null;
        if (!text) return;

        segments.push({
          speaker: "speaker_unknown",
          start_ms: index * 1000,
          end_ms: (index + 1) * 1000,
          text,
          confidence: null,
          raw: phrase,
        });
      });
    }
  });

  return segments.sort((a, b) => a.start_ms - b.start_ms);
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return {
    phone: metadata.phone || metadata.phoneNumber || null,
    leadId: metadata.leadId || null,
    agent: metadata.agent || metadata.agentName || null,
    agentSpeaker: metadata.agentSpeaker || null,
    clientSpeaker: metadata.clientSpeaker || null,
    callDateTime: metadata.callDateTime || metadata.recordingDate || null,
    recordingFileName: metadata.recordingFileName || metadata.fileName || null,
    source: metadata.source || null,
    raw: metadata,
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countKeywordMatches(text, keywords) {
  const normalizedText = String(text || "").toLowerCase();
  return keywords.reduce(
    (total, keyword) => total + (normalizedText.includes(keyword) ? 1 : 0),
    0,
  );
}

function inferSpeakerRoles(segments, metadata) {
  const speakers = Array.from(
    new Set(segments.map((segment) => segment.speaker).filter(Boolean)),
  );

  if (!speakers.length) {
    return {
      speakerMap: {},
      detectedAgentSpeaker: null,
      detectedClientSpeaker: null,
      confidence: "low",
      reason: "No speaker segments were available.",
    };
  }

  const explicitAgentSpeaker = metadata.agentSpeaker;
  const explicitClientSpeaker = metadata.clientSpeaker;

  if (explicitAgentSpeaker || explicitClientSpeaker) {
    const speakerMap = {};

    speakers.forEach((speaker) => {
      let role = "unknown";
      let displayName = speaker;

      if (speaker === explicitAgentSpeaker) role = "agent";
      if (speaker === explicitClientSpeaker) role = "client";

      if (role === "agent") {
        displayName = metadata.agent || "Agent";
      } else if (role === "client") {
        displayName = "Client";
      }

      speakerMap[speaker] = {
        role,
        displayName,
      };
    });

    return {
      speakerMap,
      detectedAgentSpeaker: explicitAgentSpeaker || null,
      detectedClientSpeaker: explicitClientSpeaker || null,
      confidence: "high",
      reason: "Speaker roles were provided in metadata.",
    };
  }

  const agentKeywords = [
    "my name is",
    "recorded line",
    "legal department",
    "consumer legal department",
    "am i speaking with",
    "this is",
    "calling from",
    "can i speak with",
    "may i speak with",
  ];
  const clientKeywords = [
    "call me back",
    "not working right now",
    "wrong number",
    "not interested",
    "can you call me back",
    "i can't hear",
  ];

  const scores = speakers.map((speaker) => {
    const speakerSegments = segments.filter(
      (segment) => segment.speaker === speaker,
    );
    const text = speakerSegments.map((segment) => segment.text).join(" ");
    const agentScore = countKeywordMatches(text, agentKeywords);
    const clientScore = countKeywordMatches(text, clientKeywords);

    return {
      speaker,
      agentScore,
      clientScore,
      totalWords: text.split(/\s+/).filter(Boolean).length,
    };
  });

  const sortedByAgentScore = [...scores].sort((left, right) => {
    if (right.agentScore !== left.agentScore) {
      return right.agentScore - left.agentScore;
    }
    return right.totalWords - left.totalWords;
  });

  const detectedAgentSpeaker =
    sortedByAgentScore[0] && sortedByAgentScore[0].agentScore > 0
      ? sortedByAgentScore[0].speaker
      : null;

  const detectedClientSpeaker =
    detectedAgentSpeaker && speakers.length === 2
      ? speakers.find((speaker) => speaker !== detectedAgentSpeaker) || null
      : null;

  const speakerMap = {};
  speakers.forEach((speaker) => {
    let role = "unknown";
    let displayName = speaker;

    if (speaker === detectedAgentSpeaker) role = "agent";
    if (speaker === detectedClientSpeaker) role = "client";

    if (role === "agent") {
      displayName = metadata.agent || "Agent";
    } else if (role === "client") {
      displayName = "Client";
    }

    speakerMap[speaker] = {
      role,
      displayName,
    };
  });

  return {
    speakerMap,
    detectedAgentSpeaker,
    detectedClientSpeaker,
    confidence: detectedAgentSpeaker ? "medium" : "low",
    reason: detectedAgentSpeaker
      ? "Agent speaker was inferred from introduction and compliance phrases."
      : "No strong speaker-role cues were found in the transcript.",
  };
}

function normalizeRecordingUrls(recordingUrls) {
  if (!Array.isArray(recordingUrls)) {
    throw Object.assign(new Error("recordingUrls must be an array"), {
      statusCode: 400,
    });
  }

  return recordingUrls.map((item) => {
    if (typeof item !== "string") {
      throw Object.assign(
        new Error("each recordingUrls item must be a string"),
        {
          statusCode: 400,
        },
      );
    }

    return normalizeUrlString(item);
  });
}

async function getRecordingsTranscriptionStatus(recordingUrls) {
  const urls = Array.from(new Set(normalizeRecordingUrls(recordingUrls)));
  const hasMissing = urls.some((url) => !url);

  if (hasMissing) {
    throw Object.assign(
      new Error("each recordingUrls item must be a non-empty string"),
      {
        statusCode: 400,
      },
    );
  }

  if (urls.length === 0) {
    return [];
  }

  const jobs = await TranscriptionJob.findAll({
    where: {
      recording_url: {
        [Op.in]: urls,
      },
    },
    order: [["created_at", "DESC"]],
  });

  const latestByUrl = new Map();
  jobs.forEach((job) => {
    if (!latestByUrl.has(job.recording_url)) {
      latestByUrl.set(job.recording_url, job);
    }
  });

  return urls
    .map((recordingUrl) => {
      const job = latestByUrl.get(recordingUrl);

      if (!job) {
        return null;
      }

      return {
        recordingUrl,
        id: job.id,
        status: job.status,
        providerStatus: job.provider_status,
        caseNumber: job.case_number,
        callOutcomeCode: job.call_outcome_code,
        callOutcomeLabel: job.call_outcome_label,
        nextActionCode: job.next_action_code,
        nextActionLabel: job.next_action_label,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      };
    })
    .filter(Boolean);
}

const SILENCE_THRESHOLD_MS = 1000;

function detectSilences(segments, silenceThresholdMs = SILENCE_THRESHOLD_MS) {
  if (!Array.isArray(segments) || segments.length < 2) {
    return [];
  }

  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  const silences = [];

  for (let i = 1; i < sorted.length; i++) {
    const gapStart = sorted[i - 1].end_ms;
    const gapEnd = sorted[i].start_ms;
    const gapMs = gapEnd - gapStart;

    if (gapMs >= silenceThresholdMs) {
      silences.push({
        startMs: gapStart,
        endMs: gapEnd,
        durationMs: gapMs,
      });
    }
  }

  return silences;
}

function computeSpeechRates(segments, speakerMap = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { overall: null, bySpeaker: {} };
  }

  const bySpeaker = {};
  let totalWords = 0;
  let totalDurationMs = 0;

  segments.forEach((segment) => {
    const speaker = segment.speaker || "speaker_unknown";
    const words = String(segment.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const durationMs = Math.max(
      0,
      (segment.end_ms || 0) - (segment.start_ms || 0),
    );

    if (!bySpeaker[speaker]) {
      bySpeaker[speaker] = {
        words: 0,
        durationMs: 0,
        role: speakerMap[speaker]?.role || "unknown",
        displayName: speakerMap[speaker]?.displayName || speaker,
      };
    }

    bySpeaker[speaker].words += words;
    bySpeaker[speaker].durationMs += durationMs;
    totalWords += words;
    totalDurationMs += durationMs;
  });

  const toWpm = (words, durationMs) => {
    if (!durationMs) return null;
    return Math.round((words / (durationMs / 1000)) * 60);
  };

  const bySpeakerWpm = {};
  Object.entries(bySpeaker).forEach(([speaker, data]) => {
    bySpeakerWpm[speaker] = {
      role: data.role,
      displayName: data.displayName,
      totalWords: data.words,
      totalSpeakingMs: data.durationMs,
      wpm: toWpm(data.words, data.durationMs),
    };
  });

  return {
    overall: toWpm(totalWords, totalDurationMs),
    bySpeaker: bySpeakerWpm,
  };
}

function buildConversation(segments, speakerMap = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const turns = [];

  segments.forEach((segment) => {
    const speaker = segment.speaker || "speaker_unknown";
    const role = speakerMap[speaker]?.role || "unknown";
    const displayName = speakerMap[speaker]?.displayName || speaker;
    const text = String(segment.text || "").trim();

    if (!text) {
      return;
    }

    const lastTurn = turns.at(-1);
    if (lastTurn && lastTurn.speaker === speaker) {
      lastTurn.endMs = Math.max(lastTurn.endMs, segment.end_ms || 0);
      lastTurn.text = `${lastTurn.text} ${text}`.trim();
      return;
    }

    turns.push({
      role,
      speaker,
      displayName,
      startMs: segment.start_ms || 0,
      endMs: segment.end_ms || 0,
      text,
    });
  });

  return turns;
}

function buildSpeakerSummary(segments, speakerMap = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return {};
  }

  const bySpeaker = {};

  segments.forEach((segment) => {
    const speaker = segment.speaker || "speaker_unknown";
    if (!bySpeaker[speaker]) {
      bySpeaker[speaker] = {
        speaker,
        role: speakerMap[speaker]?.role || "unknown",
        displayName: speakerMap[speaker]?.displayName || speaker,
        utteranceCount: 0,
        totalDurationMs: 0,
        averageConfidence: null,
      };
      bySpeaker[speaker]._confidenceValues = [];
    }

    const duration = Math.max(
      0,
      (segment.end_ms || 0) - (segment.start_ms || 0),
    );
    bySpeaker[speaker].utteranceCount += 1;
    bySpeaker[speaker].totalDurationMs += duration;

    if (typeof segment.confidence === "number") {
      bySpeaker[speaker]._confidenceValues.push(segment.confidence);
    }
  });

  Object.values(bySpeaker).forEach((item) => {
    item.averageConfidence = average(item._confidenceValues);
    delete item._confidenceValues;
  });

  return bySpeaker;
}

function inferCallOutcome(transcriptText) {
  const text = String(transcriptText || "").toLowerCase();

  if (!text) {
    return {
      code: "unknown",
      label: "Outcome not inferred",
      reason: "The transcript is empty.",
      nextAction: {
        code: "follow_up",
        label: "Review manually",
        reason: "A person should review the call to determine disposition.",
      },
    };
  }

  if (
    text.includes("payment") ||
    text.includes("paid") ||
    text.includes("settlement") ||
    text.includes("agreed")
  ) {
    return {
      code: "commitment",
      label: "Commitment reached",
      reason: "The customer appears to agree with a payment or commitment.",
      nextAction: {
        code: "confirm_follow_up",
        label: "Confirm follow-up",
        reason: "Follow up to validate commitment completion.",
      },
    };
  }

  if (text.includes("wrong number") || text.includes("not the right person")) {
    return {
      code: "wrong_number",
      label: "Wrong number",
      reason: "The contact indicated that the number or person was incorrect.",
      nextAction: {
        code: "close_no_interest",
        label: "Close as wrong number",
        reason: "No further outreach should be attempted to this contact.",
      },
    };
  }

  if (text.includes("not interested") || text.includes("take me off")) {
    return {
      code: "not_interested",
      label: "Not interested",
      reason: "The customer rejected the offer or contact.",
      nextAction: {
        code: "close_no_interest",
        label: "Close as not interested",
        reason: "No active follow-up is recommended.",
      },
    };
  }

  if (
    text.includes("can't hear") ||
    text.includes("staticky") ||
    text.includes("going in and out")
  ) {
    return {
      code: "audio_issue",
      label: "Audio or call quality issue",
      reason: "The call mentions audio quality problems.",
      nextAction: {
        code: "follow_up",
        label: "Retry contact",
        reason:
          "A follow-up call may be needed because the conversation quality was poor.",
      },
    };
  }

  return {
    code: "unknown",
    label: "Outcome not inferred",
    reason: "The transcript did not clearly match a predefined outcome.",
    nextAction: {
      code: "follow_up",
      label: "Review manually",
      reason:
        "A person should review the call to determine the proper disposition.",
    },
  };
}

function buildEnrichedResult(job, segments) {
  const metadata = normalizeMetadata(job.metadata);
  const transcriptText = segments
    .map((item) => item.text)
    .join(" ")
    .trim();
  const roleInference = inferSpeakerRoles(segments, metadata);
  const conversation = buildConversation(segments, roleInference.speakerMap);
  const speakerSummary = buildSpeakerSummary(
    segments,
    roleInference.speakerMap,
  );
  const outcome = inferCallOutcome(transcriptText);

  return {
    id: job.id,
    caseNumber: job.case_number,
    status: job.status,
    providerStatus: job.provider_status,
    error: job.error_message,
    metadata,
    segments: segments.map((item) => ({
      speaker: item.speaker,
      role: roleInference.speakerMap[item.speaker]?.role || "unknown",
      displayName:
        roleInference.speakerMap[item.speaker]?.displayName || item.speaker,
      startMs: item.start_ms,
      endMs: item.end_ms,
      text: item.text,
      confidence: item.confidence,
    })),
    transcriptText,
    conversation,
    speakerMap: {
      ...roleInference.speakerMap,
      _meta: {
        agentSpeaker: roleInference.detectedAgentSpeaker,
        clientSpeaker: roleInference.detectedClientSpeaker,
        confidence: roleInference.confidence,
        reason: roleInference.reason,
      },
    },
    speakerSummary,
    callMetrics: (() => {
      const durationMs = segments.length
        ? Math.max(...segments.map((item) => item.end_ms))
        : 0;
      const silences = detectSilences(segments);
      const totalSilenceMs = silences.reduce((sum, s) => sum + s.durationMs, 0);
      const speechRates = computeSpeechRates(
        segments,
        roleInference.speakerMap,
      );

      return {
        segmentCount: segments.length,
        conversationTurnCount: conversation.length,
        durationMs,
        averageConfidence: average(
          segments
            .map((item) => item.confidence)
            .filter((value) => typeof value === "number"),
        ),
        silences,
        totalSilenceMs,
        silencePercentage: durationMs
          ? Math.round((totalSilenceMs / durationMs) * 10000) / 100
          : 0,
        speechRateWpm: speechRates,
      };
    })(),
    callOutcome: outcome,
    nextAction: outcome.nextAction,
  };
}

async function maybeBuildAiInsights(job, enrichedResult, options = {}) {
  const includeAnalysis = Boolean(options.includeAnalysis);

  if (!includeAnalysis) return null;
  if (!hasOpenAiConfig()) {
    return {
      available: false,
      reason: "Azure OpenAI is not configured for enriched analysis.",
    };
  }

  const currentMetadata = normalizeMetadata(job.metadata);
  const existingInsights =
    job.ai_insights || currentMetadata.raw?.aiInsights || null;
  if (existingInsights && !options.forceRefresh) {
    return existingInsights;
  }

  const analysis = await generateTranscriptionInsights({
    transcriptText: enrichedResult.transcriptText,
    conversation: enrichedResult.conversation,
    speakerMap: enrichedResult.speakerMap,
    metadata: enrichedResult.metadata,
  });

  const nextMetadata = currentMetadata.raw
    ? { ...currentMetadata.raw, aiInsights: analysis }
    : { aiInsights: analysis };

  await job.update({
    metadata: nextMetadata,
    ai_insights: analysis,
  });

  return analysis;
}

async function uploadRecordingToBlob(job, recordingUrl) {
  const { inputContainerClient, outputContainerClient } = getBlobClients();

  await inputContainerClient.createIfNotExists();
  await outputContainerClient.createIfNotExists();

  const blobName = `job-${job.id}-${Date.now()}.mp3`;
  const blobClient = inputContainerClient.getBlockBlobClient(blobName);
  const { stream, contentType } = await fetchRecordingStream(recordingUrl);

  await blobClient.uploadStream(stream, 4 * 1024 * 1024, 5, {
    blobHTTPHeaders: {
      blobContentType: contentType || "audio/mpeg",
    },
  });

  const expiresOn = new Date(Date.now() + BLOB_SAS_TTL_HOURS * 60 * 60 * 1000);

  const inputBlobSasUrl = await blobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    expiresOn,
  });

  const outputContainerSasUrl = await outputContainerClient.generateSasUrl({
    permissions: ContainerSASPermissions.parse("racwdl"),
    expiresOn,
  });

  return {
    blobName,
    blobUrl: blobClient.url,
    inputBlobSasUrl,
    outputContainerSasUrl,
  };
}

async function submitSpeechBatchTranscription({
  inputBlobSasUrl,
  outputContainerSasUrl,
  displayName,
  locale,
}) {
  const baseUrl = getSpeechBaseUrl();
  const url = `${baseUrl}/speechtotext/v3.2/transcriptions`;

  const payload = {
    displayName,
    locale,
    contentUrls: [inputBlobSasUrl],
    properties: {
      diarizationEnabled: true,
      wordLevelTimestampsEnabled: true,
      punctuationMode: "DictatedAndAutomatic",
      profanityFilterMode: "Masked",
    },
    destinationContainerUrl: outputContainerSasUrl,
  };

  const response = await axios.post(url, payload, {
    headers: getSpeechHeaders(),
    timeout: 60000,
  });

  const providerSelfUrl =
    response.data?.self || response.headers?.location || null;
  const providerJobId =
    response.data?.id || extractProviderJobId(providerSelfUrl);

  if (!providerSelfUrl) {
    throw new Error("Azure Speech did not return transcription self URL");
  }

  return {
    providerSelfUrl,
    providerJobId,
    providerStatus: response.data?.status || "NotStarted",
  };
}

async function createTranscription({
  recordingUrl,
  caseNumber,
  locale,
  metadata,
}) {
  if (!recordingUrl) {
    throw Object.assign(new Error("recordingUrl is required"), {
      statusCode: 400,
    });
  }

  const selectedLocale = locale || DEFAULT_LOCALE;
  const safeRecordingUrl = assertAllowedRecordingUrl(recordingUrl);
  const normalizedMetadata = normalizeMetadata(metadata);

  const job = await TranscriptionJob.create({
    case_number: caseNumber || null,
    recording_url: safeRecordingUrl,
    locale: selectedLocale,
    status: "queued",
    provider_status: "NotStarted",
    metadata: Object.keys(normalizedMetadata).length
      ? normalizedMetadata.raw
      : null,
  });

  try {
    logger.info(
      `TranscriptionService -> uploading recording for job ${job.id}`,
    );
    const upload = await uploadRecordingToBlob(job, safeRecordingUrl);

    logger.info(
      `TranscriptionService -> creating Azure transcription job ${job.id}`,
    );
    const provider = await submitSpeechBatchTranscription({
      inputBlobSasUrl: upload.inputBlobSasUrl,
      outputContainerSasUrl: upload.outputContainerSasUrl,
      displayName: `callcenter-job-${job.id}`,
      locale: selectedLocale,
    });

    await job.update({
      status: "running",
      provider_status: provider.providerStatus,
      provider_job_id: provider.providerJobId,
      provider_self_url: provider.providerSelfUrl,
      storage_blob_name: upload.blobName,
      storage_blob_url: upload.blobUrl,
      started_at: new Date(),
      error_message: null,
    });

    return job;
  } catch (error) {
    await job.update({
      status: "failed",
      error_message: error.message,
      completed_at: new Date(),
      provider_status: "Failed",
    });

    throw error;
  }
}

async function saveSuccessfulResult(job, providerPayload) {
  const filesUrl = providerPayload?.links?.files;

  if (!filesUrl) {
    throw new Error("Azure Speech response did not include files link");
  }

  const filesResponse = await axios.get(filesUrl, {
    headers: getSpeechHeaders(),
    timeout: 30000,
  });

  const values = Array.isArray(filesResponse.data?.values)
    ? filesResponse.data.values
    : [];

  const transcriptionFile = values.find(
    (value) => value?.kind === "Transcription" && value?.links?.contentUrl,
  );

  if (!transcriptionFile?.links?.contentUrl) {
    throw new Error("Azure Speech did not return a transcription content file");
  }

  const contentResponse = await axios.get(transcriptionFile.links.contentUrl, {
    timeout: 60000,
  });

  const segments = parseAzureTranscriptionSegments(contentResponse.data);
  const providerStatus = providerPayload?.status || "Succeeded";
  const jobSnapshot = {
    id: job.id,
    case_number: job.case_number,
    status: "succeeded",
    provider_status: providerStatus,
    error_message: null,
    metadata: job.metadata,
  };
  const enrichedResult = buildEnrichedResult(jobSnapshot, segments);
  const persistedPayload = buildPersistedEnrichmentPayload(enrichedResult);

  await sequelize.transaction(async (transaction) => {
    await TranscriptionSegment.destroy({
      where: { job_id: job.id },
      transaction,
    });

    if (segments.length) {
      await TranscriptionSegment.bulkCreate(
        segments.map((segment) => ({
          ...segment,
          job_id: job.id,
        })),
        { transaction },
      );
    }

    await job.update(
      {
        status: "succeeded",
        provider_status: providerStatus,
        error_message: null,
        completed_at: new Date(),
        ...persistedPayload,
      },
      { transaction },
    );
  });
}

async function pollPendingTranscriptions() {
  const pendingJobs = await TranscriptionJob.findAll({
    where: {
      status: {
        [Op.in]: ["queued", "running"],
      },
    },
    order: [["updated_at", "ASC"]],
    limit: MAX_POLL_BATCH,
  });

  let processed = 0;

  for (const job of pendingJobs) {
    if (!job.provider_self_url) {
      continue;
    }

    try {
      const response = await axios.get(job.provider_self_url, {
        headers: getSpeechHeaders(),
        timeout: 30000,
      });

      const providerStatus = response.data?.status || "Unknown";

      if (["Running", "NotStarted"].includes(providerStatus)) {
        await job.update({
          status: "running",
          provider_status: providerStatus,
          error_message: null,
        });
        processed += 1;
        continue;
      }

      if (providerStatus === "Succeeded") {
        await saveSuccessfulResult(job, response.data);
        processed += 1;
        continue;
      }

      const providerError = response.data?.properties?.error?.message || null;
      await job.update({
        status: "failed",
        provider_status: providerStatus,
        error_message: providerError || `Azure status: ${providerStatus}`,
        completed_at: new Date(),
      });
      processed += 1;
    } catch (error) {
      logger.error(
        `TranscriptionService -> polling failed for job ${job.id}: ${error.message}`,
      );
      await job.update({
        status: "failed",
        provider_status: "Failed",
        error_message: error.message,
        completed_at: new Date(),
      });
      processed += 1;
    }
  }

  return processed;
}

function parsePagingOptions(options = {}) {
  const pageValue = Number(options.page);
  const limitValue = Number(options.limit);

  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit =
    Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(Math.floor(limitValue), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

function buildListWhereClause(filters = {}) {
  const where = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.caseNumber) {
    where.case_number = {
      [Op.like]: `%${String(filters.caseNumber).trim()}%`,
    };
  }

  if (filters.outcomeCode) {
    where.call_outcome_code = filters.outcomeCode;
  }

  if (filters.providerStatus) {
    where.provider_status = filters.providerStatus;
  }

  if (filters.createdFrom || filters.createdTo) {
    where.created_at = {};
    if (filters.createdFrom) {
      where.created_at[Op.gte] = new Date(filters.createdFrom);
    }
    if (filters.createdTo) {
      where.created_at[Op.lte] = new Date(filters.createdTo);
    }
  }

  if (filters.search) {
    const needle = `%${String(filters.search).trim()}%`;
    where[Op.or] = [
      { case_number: { [Op.like]: needle } },
      { provider_job_id: { [Op.like]: needle } },
      { recording_url: { [Op.like]: needle } },
      { transcript_text: { [Op.like]: needle } },
    ];
  }

  return where;
}

function toTranscriptionListItem(job) {
  return {
    id: job.id,
    caseNumber: job.case_number,
    status: job.status,
    providerStatus: job.provider_status,
    providerJobId: job.provider_job_id,
    locale: job.locale,
    callOutcome: {
      code: job.call_outcome_code,
      label: job.call_outcome_label,
    },
    nextAction: {
      code: job.next_action_code,
      label: job.next_action_label,
    },
    callMetrics: job.call_metrics || null,
    hasInsights: Boolean(job.ai_insights),
    recordingUrl: job.recording_url,
    error: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  };
}

async function listTranscriptionJobs(filters = {}) {
  const { page, limit, offset } = parsePagingOptions(filters);
  const where = buildListWhereClause(filters);

  const { rows, count } = await TranscriptionJob.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });

  return {
    items: rows.map((job) => toTranscriptionListItem(job)),
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    },
  };
}

async function rebuildTranscriptionDerivedData(id, options = {}) {
  const job = await TranscriptionJob.findByPk(id);

  if (!job) {
    throw Object.assign(new Error("Transcription job not found"), {
      statusCode: 404,
    });
  }

  const segments = await TranscriptionSegment.findAll({
    where: { job_id: job.id },
    order: [["start_ms", "ASC"]],
  });

  const enrichedResult = buildEnrichedResult(job, segments);
  const aiInsights = await maybeBuildAiInsights(job, enrichedResult, options);

  await job.update(buildPersistedEnrichmentPayload(enrichedResult, aiInsights));

  if (aiInsights) {
    enrichedResult.aiInsights = aiInsights;
  }

  return enrichedResult;
}

async function getTranscriptionStatus(id) {
  const job = await TranscriptionJob.findByPk(id);

  if (!job) {
    throw Object.assign(new Error("Transcription job not found"), {
      statusCode: 404,
    });
  }

  return {
    id: job.id,
    caseNumber: job.case_number,
    status: job.status,
    providerStatus: job.provider_status,
    providerJobId: job.provider_job_id,
    metadata: normalizeMetadata(job.metadata),
    callOutcome: {
      code: job.call_outcome_code,
      label: job.call_outcome_label,
    },
    nextAction: {
      code: job.next_action_code,
      label: job.next_action_label,
    },
    callMetrics: job.call_metrics || null,
    hasInsights: Boolean(job.ai_insights),
    startedAt: job.started_at,
    completedAt: job.completed_at,
    error: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function getTranscriptionResult(id, options = {}) {
  const job = await TranscriptionJob.findByPk(id);

  if (!job) {
    throw Object.assign(new Error("Transcription job not found"), {
      statusCode: 404,
    });
  }

  const segments = await TranscriptionSegment.findAll({
    where: { job_id: job.id },
    order: [["start_ms", "ASC"]],
  });

  const enrichedResult = buildEnrichedResult(job, segments);
  const aiInsights = await maybeBuildAiInsights(job, enrichedResult, options);

  if (aiInsights) {
    enrichedResult.aiInsights = aiInsights;
  }

  return enrichedResult;
}

async function getTranscriptionDetail(id, options = {}) {
  const job = await TranscriptionJob.findByPk(id);

  if (!job) {
    throw Object.assign(new Error("Transcription job not found"), {
      statusCode: 404,
    });
  }

  const segments = await TranscriptionSegment.findAll({
    where: { job_id: job.id },
    order: [["start_ms", "ASC"]],
  });

  const enrichedResult = buildEnrichedResult(job, segments);
  const aiInsights = await maybeBuildAiInsights(job, enrichedResult, options);

  if (aiInsights) {
    enrichedResult.aiInsights = aiInsights;
  } else if (job.ai_insights) {
    enrichedResult.aiInsights = job.ai_insights;
  }

  return {
    ...enrichedResult,
    recordingUrl: job.recording_url,
    storageBlobName: job.storage_blob_name,
    storageBlobUrl: job.storage_blob_url,
    providerJobId: job.provider_job_id,
    providerSelfUrl: job.provider_self_url,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    isCompleted: ["succeeded", "failed"].includes(job.status),
    isTranscribed: job.status === "succeeded",
  };
}

module.exports = {
  createTranscription,
  pollPendingTranscriptions,
  listTranscriptionJobs,
  rebuildTranscriptionDerivedData,
  getTranscriptionStatus,
  getTranscriptionResult,
  getTranscriptionDetail,
  getRecordingsTranscriptionStatus,
};
