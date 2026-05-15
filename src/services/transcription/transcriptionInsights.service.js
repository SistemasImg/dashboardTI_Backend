const { AzureOpenAI } = require("openai");

function hasOpenAiConfig() {
  return Boolean(
    process.env.AZURE_OPENAI_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_DEPLOYMENT &&
    process.env.AZURE_OPENAI_API_VERSION,
  );
}

function getClient() {
  return new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, ""),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  if (!value) {
    throw new Error("AI returned an empty analysis payload");
  }

  try {
    return JSON.parse(value);
  } catch {
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("AI analysis response was not valid JSON");
    }

    return JSON.parse(value.slice(firstBrace, lastBrace + 1));
  }
}

async function generateTranscriptionInsights({
  transcriptText,
  conversation,
  speakerMap,
  metadata,
}) {
  if (!hasOpenAiConfig()) {
    throw Object.assign(new Error("Azure OpenAI is not configured"), {
      statusCode: 400,
    });
  }

  const client = getClient();
  const compactConversation = Array.isArray(conversation)
    ? conversation.map((item) => ({
        role: item.role,
        speaker: item.speaker,
        startMs: item.startMs,
        endMs: item.endMs,
        text: item.text,
      }))
    : [];

  const messages = [
    {
      role: "system",
      content:
        "You analyze call-center call transcripts. Return only valid JSON. Do not wrap it in markdown. Use the evidence in the transcript only. Keep the summary concise and business-ready.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "Analyze the call transcript and produce business-ready insights.",
          requiredJsonShape: {
            summary: "short paragraph",
            callOutcome: {
              code: "callback_requested|interested|not_interested|wrong_number|no_contact|audio_issue|unknown",
              label: "short human label",
              reason: "why this outcome applies",
            },
            nextAction: {
              code: "call_back|follow_up|close_no_interest|review_audio|none",
              label: "short human label",
              reason: "specific action recommendation",
            },
            customerSentiment: "positive|neutral|negative|mixed|unknown",
            followUpNeeded: true,
            followUpWindow: "short suggestion or null",
            keyMoments: [
              {
                speaker: "agent|client|unknown",
                text: "important utterance",
                whyItMatters: "brief reason",
              },
            ],
            speakerLabels: {
              agentSpeaker: "speaker id or null",
              clientSpeaker: "speaker id or null",
              confidence: "high|medium|low",
              reason: "brief reasoning",
            },
          },
          speakerMap,
          metadata,
          transcriptText,
          conversation: compactConversation,
        },
        null,
        2,
      ),
    },
  ];

  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages,
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content || "";
  return extractJsonObject(content);
}

module.exports = {
  hasOpenAiConfig,
  generateTranscriptionInsights,
};
