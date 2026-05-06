const metrics = require("./metrics");
const logger = require("../../utils/logger");
const { askModel } = require("./ai.config");
const { systemPrompt } = require("./prompts");
const excelService = require("./excel.service");
const apiIntegrations = require("./api-integrations");
const { DateTime } = require("luxon");
const chatSessionService = require("../../services/chatSession.service");

// Caché en memoria para reducir lecturas a BD durante la misma sesión de proceso.
// Se usa como capa L1; la fuente de verdad siempre es la BD.
const sessionCache = {};

// Constant for bulk case threshold
const BULK_THRESHOLD = 3; // If more than 3 cases, generate Excel
const ATTEMPTS_BULK_THRESHOLD = 15;
const VENDORS_BULK_THRESHOLD = 15;
const VENDOR_CASE_DETAILS_BULK_THRESHOLD = 30;

const RESPONSE_LAYOUT_PROMPT = `
Format the final answer for quick scanning while keeping a natural tone:
- Use 1 short intro line.
- Leave a blank line.
- Show key metrics on separate lines (bullet points are allowed).
- Leave a blank line before any recommendation or next step.
- Avoid one single paragraph for data-heavy answers.
`;

function detectUserLanguage(message) {
  const text = (message || "").toLowerCase();

  if (/[áéíóúñü¿¡]/i.test(text)) return "es";
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return "fr";
  if (/[ãõáâàçéêíóôú]/i.test(text)) return "pt";
  if (/[àèéìíîòóùú]/i.test(text)) return "it";
  if (/[äöüß]/i.test(text)) return "de";

  const languageHints = {
    es: [
      "hola",
      "dime",
      "caso",
      "hoy",
      "ayer",
      "intento",
      "llamada",
      "por favor",
      "numero",
    ],
    fr: ["bonjour", "salut", "aujourd", "hier", "tentative", "appel"],
    pt: ["ola", "olá", "hoje", "ontem", "tentativa", "ligacao"],
    it: ["ciao", "oggi", "ieri", "tentativo", "chiamata"],
    de: ["hallo", "heute", "gestern", "versuch", "anruf"],
  };

  const detected = Object.entries(languageHints).find(([, tokens]) =>
    tokens.some((token) => text.includes(token)),
  );

  if (detected) return detected[0];

  return "en";
}

function i18n(lang, esText, enText) {
  if (lang === "es") return esText;
  if (lang === "en") return enText;

  const dictionary = {
    fr: {
      Case: "Cas",
      Status: "Statut",
      Substatus: "Sous-statut",
      Origin: "Origine",
      "Supplier Segment": "Segment fournisseur",
      Owner: "Proprietaire",
      Created: "Cree",
      Type: "Type",
      "Operational Summary": "Resume operationnel",
      Total: "Total",
      "By Status": "Par statut",
      "By Origin": "Par origine",
      "By Segment": "Par segment",
      "Total Cases": "Total des cas",
      Phone: "Telephone",
      "Total Attempts": "Tentatives totales",
      Date: "Date",
      Scope: "Portee",
      File: "Fichier",
      "Days with records": "Jours avec enregistrements",
      "Attempts by date": "Tentatives par date",
      "Case Attempts List": "Liste des tentatives par cas",
      "The artificial intelligence service is not available.":
        "Le service d'intelligence artificielle n'est pas disponible.",
      "There was a problem processing the request.":
        "Un probleme est survenu lors du traitement de la demande.",
      "Please provide a valid phone number to check attempts.":
        "Veuillez fournir un numero de telephone valide pour verifier les tentatives.",
      "Please provide a valid date in YYYY-MM-DD format.":
        "Veuillez fournir une date valide au format YYYY-MM-DD.",
      "An unexpected error occurred.": "Une erreur inattendue s'est produite.",
      "No results found.": "Aucun resultat trouve.",
    },
    pt: {
      Case: "Caso",
      Status: "Status",
      Substatus: "Substatus",
      Origin: "Origem",
      "Supplier Segment": "Segmento do fornecedor",
      Owner: "Responsavel",
      Created: "Criado",
      Type: "Tipo",
      "Operational Summary": "Resumo operacional",
      Total: "Total",
      "By Status": "Por status",
      "By Origin": "Por origem",
      "By Segment": "Por segmento",
      "Total Cases": "Total de casos",
      Phone: "Telefone",
      "Total Attempts": "Tentativas totais",
      Date: "Data",
      Scope: "Escopo",
      File: "Arquivo",
      "Days with records": "Dias com registros",
      "Attempts by date": "Tentativas por data",
      "Case Attempts List": "Lista de tentativas por caso",
      "The artificial intelligence service is not available.":
        "O servico de inteligencia artificial nao esta disponivel.",
      "There was a problem processing the request.":
        "Houve um problema ao processar a solicitacao.",
      "Please provide a valid phone number to check attempts.":
        "Forneca um numero de telefone valido para consultar tentativas.",
      "Please provide a valid date in YYYY-MM-DD format.":
        "Forneca uma data valida no formato YYYY-MM-DD.",
      "An unexpected error occurred.": "Ocorreu um erro inesperado.",
      "No results found.": "Nenhum resultado encontrado.",
    },
    it: {
      Case: "Caso",
      Status: "Stato",
      Substatus: "Sottostato",
      Origin: "Origine",
      "Supplier Segment": "Segmento fornitore",
      Owner: "Responsabile",
      Created: "Creato",
      Type: "Tipo",
      "Operational Summary": "Riepilogo operativo",
      Total: "Totale",
      "By Status": "Per stato",
      "By Origin": "Per origine",
      "By Segment": "Per segmento",
      "Total Cases": "Totale casi",
      Phone: "Telefono",
      "Total Attempts": "Tentativi totali",
      Date: "Data",
      Scope: "Ambito",
      File: "File",
      "Days with records": "Giorni con registrazioni",
      "Attempts by date": "Tentativi per data",
      "Case Attempts List": "Elenco tentativi per caso",
      "The artificial intelligence service is not available.":
        "Il servizio di intelligenza artificiale non e disponibile.",
      "There was a problem processing the request.":
        "Si e verificato un problema nell'elaborazione della richiesta.",
      "Please provide a valid phone number to check attempts.":
        "Fornisci un numero di telefono valido per controllare i tentativi.",
      "Please provide a valid date in YYYY-MM-DD format.":
        "Fornisci una data valida nel formato YYYY-MM-DD.",
      "An unexpected error occurred.": "Si e verificato un errore imprevisto.",
      "No results found.": "Nessun risultato trovato.",
    },
    de: {
      Case: "Fall",
      Status: "Status",
      Substatus: "Unterstatus",
      Origin: "Herkunft",
      "Supplier Segment": "Lieferantensegment",
      Owner: "Verantwortlicher",
      Created: "Erstellt",
      Type: "Typ",
      "Operational Summary": "Operative Zusammenfassung",
      Total: "Gesamt",
      "By Status": "Nach Status",
      "By Origin": "Nach Herkunft",
      "By Segment": "Nach Segment",
      "Total Cases": "Gesamtfaelle",
      Phone: "Telefon",
      "Total Attempts": "Gesamtversuche",
      Date: "Datum",
      Scope: "Umfang",
      File: "Datei",
      "Days with records": "Tage mit Eintragen",
      "Attempts by date": "Versuche nach Datum",
      "Case Attempts List": "Versuchsliste pro Fall",
      "The artificial intelligence service is not available.":
        "Der Dienst fur kunstliche Intelligenz ist nicht verfugbar.",
      "There was a problem processing the request.":
        "Bei der Verarbeitung der Anfrage ist ein Problem aufgetreten.",
      "Please provide a valid phone number to check attempts.":
        "Bitte gib eine gultige Telefonnummer zur Prufung der Versuche an.",
      "Please provide a valid date in YYYY-MM-DD format.":
        "Bitte gib ein gultiges Datum im Format YYYY-MM-DD an.",
      "An unexpected error occurred.":
        "Ein unerwarteter Fehler ist aufgetreten.",
      "No results found.": "Keine Ergebnisse gefunden.",
    },
  };

  return dictionary[lang]?.[enText] || enText;
}

/**
 * Format a date string to a readable format: DD/MM/YYYY HH:mm
 * @param {String} dateString - ISO date string from Salesforce
 * @returns {String} Formatted date or "N/A" if invalid
 */
function formatDate(dateString, includeTime = false) {
  if (!dateString) return "N/A";

  try {
    const date = DateTime.fromISO(dateString, { zone: "utc" }).setZone(
      "America/Lima",
    );
    if (!date.isValid) return "N/A";

    return includeTime
      ? date.toFormat("dd/MM/yyyy HH:mm")
      : date.toFormat("dd/MM/yyyy");
  } catch (error) {
    logger.warn(`Error formatting date: ${dateString} - ${error.message}`);
    return "N/A";
  }
}

function detectDateRange(message) {
  const text = message.toLowerCase();

  const today = DateTime.now();
  const todayStr = today.toISODate();
  const yesterdayStr = today.minus({ days: 1 }).toISODate();

  if (text.includes("hoy y ayer")) {
    return {
      startDate: yesterdayStr,
      endDate: todayStr,
    };
  }

  if (text.includes("últimos 2 días") || text.includes("last 2 days")) {
    return {
      startDate: today.minus({ days: 2 }).toISODate(),
      endDate: todayStr,
    };
  }

  if (text.includes("última semana") || text.includes("last week")) {
    return {
      startDate: today.minus({ days: 7 }).toISODate(),
      endDate: todayStr,
    };
  }

  if (text.includes("último mes") || text.includes("last month")) {
    return {
      startDate: today.minus({ days: 30 }).toISODate(),
      endDate: todayStr,
    };
  }

  return null;
}

function isAttemptsQuery(message) {
  const text = message.toLowerCase();
  return (
    text.includes("attempt") ||
    text.includes("intento") ||
    text.includes("llamada") ||
    text.includes("calls")
  );
}

/**
 * Detects if the user is requesting a T9 Rideshare API send.
 * Returns { caseNumber } if intent is detected, null otherwise.
 * Used to bypass AI model hallucination when model skips the function call.
 */
/**
 * Pads a case number to 8 digits with leading zeros.
 * Handles cases where the user omits leading zeros (e.g. "124230" → "00124230").
 */
function normalizeCaseNumber(caseNumber) {
  if (!caseNumber) return caseNumber;
  const digits = String(caseNumber).trim().replace(/\D/g, "");
  return digits.padStart(8, "0");
}

function detectT9SendIntent(message) {
  const text = String(message || "").toLowerCase();

  const mentionsSend =
    text.includes("envi") ||
    text.includes("manda") ||
    text.includes("send") ||
    text.includes("submit");

  const mentionsT9 =
    text.includes("t9") ||
    text.includes("tier 9") ||
    text.includes("tier9") ||
    text.includes("rideshare");

  if (!mentionsSend || !mentionsT9) return null;

  // Extract 8-digit case number (with or without leading zeros)
  const caseMatch = text.match(/\b(0*\d{5,8})\b/);
  if (!caseMatch) return null;

  return { caseNumber: caseMatch[1] };
}

function detectJdcT3SendIntent(message) {
  const text = String(message || "").toLowerCase();

  const mentionsSend =
    text.includes("envi") ||
    text.includes("manda") ||
    text.includes("send") ||
    text.includes("submit");

  const mentionsJdcT3 =
    text.includes("jdc t3") ||
    text.includes("jdc") ||
    text.includes("juvenile detention center") ||
    text.includes("juvenile t3") ||
    text.includes("detention center t3") ||
    (text.includes("juvenile") && text.includes("t3"));

  if (!mentionsSend || !mentionsJdcT3) return null;

  const caseMatch = /\b(0*\d{5,8})\b/.exec(text);
  if (!caseMatch) return null;

  return { caseNumber: caseMatch[1] };
}

function detectCaseAttemptsByDateIntent(message) {
  const text = String(message || "").toLowerCase();
  const mentionsAttempts =
    text.includes("attempt") ||
    text.includes("intento") ||
    text.includes("llamada") ||
    text.includes("calls");

  const mentionsCaseScope =
    text.includes("cada caso") ||
    text.includes("por caso") ||
    text.includes("casos del dia") ||
    text.includes("casos de hoy") ||
    text.includes("cases of today") ||
    text.includes("each case");

  if (!mentionsAttempts || !mentionsCaseScope) {
    return null;
  }

  if (text.includes("hoy") || text.includes("today")) {
    return { dateKeyword: "today" };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return { dateKeyword: "yesterday" };
  }

  const isoDateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoDateMatch) {
    return { date: isoDateMatch[1] };
  }

  return null;
}

function normalizeBusinessQuery(message) {
  let text = String(message || "");

  const replacements = [
    [/\battempst\b/gi, "attempts"],
    [/\battemp\b/gi, "attempt"],
    [/\bllamdas\b/gi, "llamadas"],
    [/\bcampaing\b/gi, "campaign"],
    [/\bcampain\b/gi, "campaign"],
    [/\bvenddor\b/gi, "vendor"],
    [/\bvednor\b/gi, "vendor"],
    [/\benvidos\b/gi, "enviados"],
    [/\bnnumero\b/gi, "numero"],
    [/\bcahtbot\b/gi, "chatbot"],
    [/\bsub\s*stat\b/gi, "substatus"],
    [/\bestatus\b/gi, "status"],
    [/\bquelity\b/gi, "quality"],
    [/\bhigh\s*quelity\b/gi, "high quality"],
    [/\bmedio\b/gi, "medium"],
    [/\bbajo\b/gi, "low quality"],
    [/\bfirmad[oa]s?\b/gi, "sent"],
    [/\bt9\b/gi, "tier9"],
    [/\btier\s*(\d+)\b/gi, "tier$1"],
  ];

  replacements.forEach(([pattern, value]) => {
    text = text.replace(pattern, value);
  });

  return text;
}

function isFollowUpQuery(message) {
  const text = String(message || "")
    .trim()
    .toLowerCase();
  if (!text) return false;

  const followUpCues = [
    "si",
    "sí",
    "ok",
    "dale",
    "y ",
    "y de",
    "tambien",
    "también",
    "ahora",
    "solo",
    "mismos",
    "mismos casos",
    "de hoy",
    "de ayer",
    "igual",
    "ese",
    "esa",
    "razon",
    "razón",
    "por que",
    "porque",
    "descalific",
  ];

  const shortMessage = text.length <= 90;
  return shortMessage && followUpCues.some((cue) => text.includes(cue));
}

function extractLastReferencedCaseNumber(storedMessages = []) {
  if (!Array.isArray(storedMessages) || !storedMessages.length) {
    return null;
  }

  const contextualPattern =
    /(?:case|caso|lead|casenumber|numero de caso)\s*(?:#|number|numero)?\s*[:-]?\s*(\d{6,12})/i;

  for (let i = storedMessages.length - 1; i >= 0; i -= 1) {
    const content = String(storedMessages[i]?.content || "");
    if (!content) continue;

    const contextualMatch = contextualPattern.exec(content);
    if (contextualMatch?.[1]) {
      return contextualMatch[1];
    }
  }

  return null;
}

function enrichWithSessionContext(userMessage, sessionData) {
  if (!isFollowUpQuery(userMessage)) {
    return userMessage;
  }

  const f = sessionData?.lastFilters || {};
  const context = [];
  const inferredCaseNumber =
    f.caseNumber || extractLastReferencedCaseNumber(sessionData?.messages);

  if (f.status) context.push(`status=${f.status}`);
  if (f.origin) context.push(`origin=${f.origin}`);
  if (f.segment) context.push(`segment=${f.segment}`);
  if (f.type) context.push(`type=${f.type}`);
  if (f.substatus) context.push(`substatus=${f.substatus}`);
  if (f.agentName) context.push(`agentName=${f.agentName}`);
  if (f.dateKeyword) context.push(`dateKeyword=${f.dateKeyword}`);
  if (f.date) context.push(`date=${f.date}`);
  if (f.startDate && f.endDate)
    context.push(`startDate=${f.startDate}`, `endDate=${f.endDate}`);
  if (inferredCaseNumber) context.push(`caseNumber=${inferredCaseNumber}`);

  if (!context.length) return userMessage;

  return `${userMessage}\n\n[Conversation context from previous request: ${context.join(", ")}]`;
}

function pickVariant(variants, seedText) {
  const seed = String(seedText || "");
  const hash = seed
    .split("")
    .reduce((acc, ch, idx) => acc + (ch.codePointAt(0) || 0) * (idx + 1), 0);
  return variants[hash % variants.length];
}

// humanizePayload is intentionally a pass-through.
// The AI model is now responsible for natural, varied language via the system prompt.
// Wrapping responses here with fixed intros/outros caused repetitive phrasing.
function humanizePayload(payload) {
  return payload;
}

exports.processMessage = async (
  userMessage,
  userId = null,
  uploadedAttachments = [],
) => {
  const normalizedUserMessage = normalizeBusinessQuery(userMessage);
  const userLang = detectUserLanguage(normalizedUserMessage);
  const requestAttachments = Array.isArray(uploadedAttachments)
    ? uploadedAttachments
    : [];

  try {
    logger.info(
      `Incoming chatbot message [user:${userId}]: ${normalizedUserMessage}`,
    );
    if (requestAttachments.length > 0) {
      logger.info(
        `Chatbot request includes ${requestAttachments.length} attachment(s) for current turn`,
      );
    }

    // Load session from DB; cache in memory (L1) to reduce DB reads within the same process
    const cacheKey = String(userId ?? "anonymous");
    if (!sessionCache[cacheKey]) {
      sessionCache[cacheKey] =
        await chatSessionService.getOrCreateSession(userId);
    }
    const sessionData = sessionCache[cacheKey];

    // Enrich the message with previous filter context if this looks like a follow-up query
    const contextualNormalizedMessage = enrichWithSessionContext(
      normalizedUserMessage,
      {
        lastFilters: sessionData.last_filters,
        lastResults: sessionData.last_results,
        messages: sessionData.messages,
      },
    );

    // Build message array: system prompt + full user history + new user message
    const historyForAI = chatSessionService.buildMessagesForAI(
      sessionData.messages,
    );
    const uploadContextMessages =
      requestAttachments.length > 0
        ? [
            {
              role: "system",
              content: `Current request already includes ${requestAttachments.length} uploaded file(s): ${requestAttachments
                .map((file) => file.fileName)
                .join(
                  ", ",
                )}. If user asks to send T9 or JDC T3 API, treat attachments as provided in this request.`,
            },
          ]
        : [
            {
              role: "system",
              content:
                "IMPORTANT: No files were attached to this request. " +
                "If the user asks to send a T9 Rideshare or JDC T3 payload (any variant: enviar API, envíame el API, send API, PI, etc.), " +
                "you MUST call the sendT9RidesharePayload or sendJdcT3Payload function with the provided case number — do NOT generate a text response, " +
                "do NOT simulate success, do NOT invent HTTP codes, do NOT invent Lead IDs. " +
                "The function itself will detect missing files and return the appropriate error. " +
                "Never fabricate a successful delivery response under any circumstances.",
            },
          ];
    const messages = [
      { role: "system", content: systemPrompt },
      ...uploadContextMessages,
      ...historyForAI,
      { role: "user", content: contextualNormalizedMessage },
    ];

    const response = await askModel(messages);
    const detectedRange = detectDateRange(normalizedUserMessage);
    const directCaseAttemptsIntent = detectCaseAttemptsByDateIntent(
      normalizedUserMessage,
    );

    if (directCaseAttemptsIntent) {
      const functionResult = await metrics.sql.getCaseAttemptsByDate(
        directCaseAttemptsIntent,
      );

      const formattedResponse = await formatResult(
        "getCaseAttemptsByDate",
        functionResult,
        userLang,
      );

      let directMessage = formattedResponse.message;
      try {
        const humanMessages = [
          { role: "system", content: systemPrompt },
          { role: "system", content: RESPONSE_LAYOUT_PROMPT },
          ...chatSessionService.buildMessagesForAI(sessionData.messages),
          { role: "user", content: userMessage },
          {
            role: "function",
            name: "getCaseAttemptsByDate",
            content: formattedResponse.message,
          },
        ];
        const humanResponse = await askModel(humanMessages);
        const humanContent = humanResponse.choices?.[0]?.message?.content;
        if (humanContent) directMessage = humanContent;
      } catch (humanErr) {
        logger.warn(
          `[Humanize] Fallback to structured response: ${humanErr.message}`,
        );
      }

      const directPayload = humanizePayload({
        ...formattedResponse,
        message: directMessage,
      });

      chatSessionService
        .appendMessages(
          userId,
          [
            { role: "user", content: userMessage },
            { role: "assistant", content: directPayload.message || "" },
          ],
          sessionCache[cacheKey].last_filters,
          functionResult,
        )
        .catch((err) =>
          logger.error(
            `[ChatSession] Failed to persist messages: ${err.message}`,
          ),
        );

      return directPayload;
    }

    if (detectedRange && !isAttemptsQuery(normalizedUserMessage)) {
      logger.info("Date range detected locally");

      const functionResult = await metrics.sf.getCasesByDateRange(
        detectedRange.startDate,
        detectedRange.endDate,
      );

      const formattedResponse = await formatResult(
        "getCasesByDateRange",
        functionResult,
        userLang,
      );

      let rangeMessage = formattedResponse.message;
      try {
        const humanMessages = [
          { role: "system", content: systemPrompt },
          { role: "system", content: RESPONSE_LAYOUT_PROMPT },
          ...chatSessionService.buildMessagesForAI(sessionData.messages),
          { role: "user", content: userMessage },
          {
            role: "function",
            name: "getCasesByDateRange",
            content: formattedResponse.message,
          },
        ];
        const humanResponse = await askModel(humanMessages);
        const humanContent = humanResponse.choices?.[0]?.message?.content;
        if (humanContent) rangeMessage = humanContent;
      } catch (humanErr) {
        logger.warn(
          `[Humanize] Fallback to structured response: ${humanErr.message}`,
        );
      }

      const rangePayload = humanizePayload({
        ...formattedResponse,
        message: rangeMessage,
      });

      chatSessionService
        .appendMessages(
          userId,
          [
            { role: "user", content: userMessage },
            { role: "assistant", content: rangePayload.message || "" },
          ],
          null,
          functionResult,
        )
        .catch((err) =>
          logger.error(
            `[ChatSession] Failed to persist messages: ${err.message}`,
          ),
        );

      return rangePayload;
    }
    const message = response.choices?.[0]?.message;

    if (!message) throw new Error("AI_INVALID_RESPONSE");

    // Function call returned by the AI model
    if (message.function_call) {
      const functionName = message.function_call.name;

      logger.info(`Function requested: ${functionName}`);

      let args;
      try {
        args = JSON.parse(message.function_call.arguments);
      } catch {
        throw new Error("INVALID_FUNCTION_ARGUMENTS");
      }
      if (!args || typeof args !== "object") {
        args = {};
      }
      let functionResult;

      const saveApiRoutingFilters = () => {
        if (!args.caseNumber) return;
        sessionData.last_filters = {
          ...(sessionData.last_filters || {}),
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: args.tort,
        };
        sessionCache[cacheKey].last_filters = sessionData.last_filters;
      };

      if (functionName === "prepareBardPortT2Payload") {
        functionResult =
          await apiIntegrations.bardPortT2.prepareBardPortT2Payload({
            caseNumber: args.caseNumber,
            tort: args.tort,
            tier: args.tier,
          });
        saveApiRoutingFilters();
      } else if (functionName === "sendBardPortT2Payload") {
        functionResult = await apiIntegrations.bardPortT2.sendBardPortT2Payload(
          {
            caseNumber: args.caseNumber,
            tort: args.tort,
            tier: args.tier,
          },
        );
        saveApiRoutingFilters();
      } else {
        switch (functionName) {
          case "getCaseByDate":
            functionResult = await metrics.sf.getCaseByDate(
              args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
            );
            break;

          case "getCaseByNumber":
            args.caseNumber = normalizeCaseNumber(args.caseNumber);
            functionResult = await metrics.sf.getCaseByNumber(args.caseNumber);
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "getCaseByPhone":
            functionResult = await metrics.sf.getCaseByPhone(args.phone);
            break;

          case "getCasesByStatus":
            functionResult = await metrics.sf.getCasesByStatus(
              args.status,
              args.dateKeyword,
              args.date,
            );
            break;

          case "getCasesByDateRange":
            functionResult = await metrics.sf.getCasesByDateRange(
              args.startDate,
              args.endDate,
            );
            break;

          case "getCaseByEmail":
            functionResult = await metrics.sf.getCaseByEmail(args.email);
            break;

          case "getCasesByOrigin":
            functionResult = await metrics.sf.getCasesByOrigin(
              args.origin,
              args.dateKeyword,
              args.date,
            );
            break;

          case "getCasesBySupplierSegment":
            functionResult = await metrics.sf.getCasesBySupplierSegment(
              args.segment,
              args.dateKeyword,
              args.date,
            );
            break;

          case "getCasesBySubstatus":
            functionResult = await metrics.sf.getCasesBySubstatus(
              args.substatus,
              args.dateKeyword,
              args.date,
            );
            break;

          case "getCasesByType": {
            const typeValue =
              args.type?.toLowerCase() === "tort" ? "Tort" : args.type;
            functionResult = await metrics.sf.getCasesByType(
              typeValue,
              args.dateKeyword,
              args.date,
            );
            break;
          }

          case "getCasesByFilters":
            functionResult = await metrics.sf.getCasesByFilters(args);
            sessionData.last_filters = args;
            sessionCache[cacheKey].last_filters = args;
            break;

          case "getCasesGroupedByField":
            functionResult = await metrics.sf.getCasesGroupedByField(
              args.field,
              args.dateKeyword,
            );
            break;

          case "getOperationalSummary":
            functionResult = await metrics.sf.getOperationalSummary(
              args.dateKeyword,
            );
            break;

          case "getVendorsWithLeads":
            functionResult = await metrics.sf.getVendorsWithLeads({
              dateKeyword: args.dateKeyword,
              period: args.period,
              date: args.date,
              startDate: args.startDate,
              endDate: args.endDate,
            });
            break;

          case "getTopVendors":
            functionResult = await metrics.sf.getTopVendors({
              limit: args.limit,
              sort: args.sort,
              dateKeyword: args.dateKeyword,
              period: args.period,
              date: args.date,
              startDate: args.startDate,
              endDate: args.endDate,
            });
            break;

          case "getTopVendorsWithCaseDetails":
            functionResult = await metrics.sf.getTopVendorsWithCaseDetails({
              limit: args.limit,
              sort: args.sort,
              dateKeyword: args.dateKeyword,
              period: args.period,
              date: args.date,
              startDate: args.startDate,
              endDate: args.endDate,
            });
            break;

          case "getCaseDisqualificationReason":
            args.caseNumber =
              args.caseNumber ||
              sessionData.last_filters?.caseNumber ||
              extractLastReferencedCaseNumber(sessionData.messages);

            if (!args.caseNumber) {
              functionResult = { found: false, missingCaseNumber: true };
              break;
            }

            args.caseNumber = normalizeCaseNumber(args.caseNumber);
            functionResult = await metrics.sf.getCaseDisqualificationReason(
              args.caseNumber,
            );
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "prepareT9RidesharePayload":
            functionResult =
              await apiIntegrations.t9Rideshare.prepareT9RidesharePayload({
                caseNumber: args.caseNumber,
                tort: args.tort,
                tier: args.tier,
                attachments:
                  requestAttachments.length > 0
                    ? requestAttachments
                    : args.attachments,
              });
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
                tier: args.tier,
                type: args.tort,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "sendT9RidesharePayload":
            functionResult =
              await apiIntegrations.t9Rideshare.sendT9RidesharePayload({
                caseNumber: args.caseNumber,
                tort: args.tort,
                tier: args.tier,
                attachments:
                  requestAttachments.length > 0
                    ? requestAttachments
                    : args.attachments,
              });
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
                tier: args.tier,
                type: args.tort,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "prepareBardPortT2Payload": {
            const bardTort = args.tort || "Bard Port";
            const bardTier = args.tier || "T2";

            functionResult =
              await apiIntegrations.bardPortT2.prepareBardPortT2Payload({
                caseNumber: args.caseNumber,
                tort: bardTort,
                tier: bardTier,
              });

            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
                tier: bardTier,
                type: bardTort,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;
          }

          case "sendBardPortT2Payload": {
            const bardTort = args.tort || "Bard Port";
            const bardTier = args.tier || "T2";

            functionResult =
              await apiIntegrations.bardPortT2.sendBardPortT2Payload({
                caseNumber: args.caseNumber,
                tort: bardTort,
                tier: bardTier,
              });

            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
                tier: bardTier,
                type: bardTort,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;
          }

          case "prepareA4DRideshareT11Payload":
            functionResult =
              await apiIntegrations.a4dRideshareT11.prepareA4DRideshareT11Payload(
                { caseNumber: args.caseNumber },
              );
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "sendA4DRideshareT11Payload":
            functionResult =
              await apiIntegrations.a4dRideshareT11.sendA4DRideshareT11Payload({
                caseNumber: args.caseNumber,
              });
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "prepareJdcT3Payload":
            functionResult = await apiIntegrations.jdcT3.prepareJdcT3Payload({
              caseNumber: args.caseNumber,
            });
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "sendJdcT3Payload":
            functionResult = await apiIntegrations.jdcT3.sendJdcT3Payload({
              caseNumber: args.caseNumber,
              attachments:
                requestAttachments.length > 0
                  ? requestAttachments
                  : args.attachments,
            });
            if (args.caseNumber) {
              sessionData.last_filters = {
                ...(sessionData.last_filters || {}),
                caseNumber: args.caseNumber,
              };
              sessionCache[cacheKey].last_filters = sessionData.last_filters;
            }
            break;

          case "getVendorsBySupplierSegment":
            functionResult = await metrics.sf.getVendorsBySupplierSegment(
              args.segment,
              {
                dateKeyword: args.dateKeyword,
                period: args.period,
                date: args.date,
                startDate: args.startDate,
                endDate: args.endDate,
              },
            );
            break;

          case "getCasesByAgent":
            functionResult = await metrics.dashboard.getCasesByAgent(
              args.agentName,
            );
            break;

          case "getCasesByCallCenter":
            functionResult = await metrics.dashboard.getCasesByCallCenter(
              args.callCenter,
            );
            break;

          case "getTotalAttemptsByAgent":
            functionResult = await metrics.sql.getTotalAttemptsByAgent(
              args.agentName,
              {
                dateKeyword: args.dateKeyword,
                date: args.date,
              },
            );
            break;

          case "getAgentAttemptsByPhonePerHour":
            functionResult = await metrics.sql.getAgentAttemptsByPhonePerHour(
              args.agentName,
              args.phone,
              {
                dateKeyword: args.dateKeyword,
                date: args.date,
              },
            );
            break;

          case "getVicidialAgentsStatus":
            functionResult = await metrics.sql.getVicidialAgentsStatus({
              agentName: args.agentName,
            });
            break;

          case "getAttemptsByPhone":
            functionResult = await metrics.sql.getAttemptsByPhone(args.phone, {
              dateKeyword: args.dateKeyword,
              date: args.date,
              lastDays: args.lastDays,
            });
            break;

          case "getAttemptsByCaseNumber": {
            args.caseNumber =
              args.caseNumber ||
              sessionData.last_filters?.caseNumber ||
              extractLastReferencedCaseNumber(sessionData.messages);

            if (!args.caseNumber) {
              functionResult = { missingCaseNumber: true };
              break;
            }

            args.caseNumber = normalizeCaseNumber(args.caseNumber);
            let caseAttemptsFilters = {
              dateKeyword: args.dateKeyword,
              date: args.date,
              lastDays: args.lastDays,
            };

            if (
              !caseAttemptsFilters.dateKeyword &&
              !caseAttemptsFilters.date &&
              !caseAttemptsFilters.lastDays
            ) {
              if (/\b(hoy|today)\b/i.exec(normalizedUserMessage)) {
                caseAttemptsFilters.dateKeyword = "today";
              } else if (/\b(ayer|yesterday)\b/i.exec(normalizedUserMessage)) {
                caseAttemptsFilters.dateKeyword = "yesterday";
              } else {
                const isoDate = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(
                  normalizedUserMessage,
                );
                if (isoDate) {
                  caseAttemptsFilters.date = isoDate[1];
                }
              }
            }

            functionResult = await metrics.sql.getAttemptsByCaseNumber(
              args.caseNumber,
              caseAttemptsFilters,
            );

            sessionData.last_filters = {
              ...(sessionData.last_filters || {}),
              caseNumber: args.caseNumber,
            };
            sessionCache[cacheKey].last_filters = sessionData.last_filters;
            break;
          }

          case "getCaseAttemptsByDate":
            functionResult = await metrics.sql.getCaseAttemptsByDate({
              dateKeyword: args.dateKeyword,
              date: args.date,
            });
            break;

          case "getAssignedAgentByCaseNumber":
            args.caseNumber =
              args.caseNumber ||
              sessionData.last_filters?.caseNumber ||
              extractLastReferencedCaseNumber(sessionData.messages);

            if (!args.caseNumber) {
              functionResult = { found: false, missingCaseNumber: true };
              break;
            }

            args.caseNumber = normalizeCaseNumber(args.caseNumber);
            functionResult = await metrics.mysql.getAssignedAgentByCaseNumber(
              args.caseNumber,
            );

            sessionData.last_filters = {
              ...(sessionData.last_filters || {}),
              caseNumber: args.caseNumber,
            };
            sessionCache[cacheKey].last_filters = sessionData.last_filters;
            break;

          case "getVendorLeadAttempts":
            functionResult = await metrics.sql.getVendorLeadAttempts(
              args.vendorName,
              {
                includeAgentDetails: args.includeAgentDetails,
                dateKeyword: args.dateKeyword,
                date: args.date,
                startDate: args.startDate,
                endDate: args.endDate,
              },
            );
            break;

          case "getCasesByTypeFromReport":
            functionResult = await metrics.dashboard.getCasesByTypeFromReport(
              args.type,
            );
            break;

          default:
            throw new Error("UNKNOWN_FUNCTION");
        }
      }

      sessionCache[cacheKey].last_results = functionResult;

      // Build a structured data summary and send it back to the AI so it can
      // compose a natural, human reply instead of returning a rigid template.
      const formattedResponse = await formatResult(
        functionName,
        functionResult,
        userLang,
      );

      // Ask the model to rewrite the structured result in a human, conversational tone.
      // If the AI call fails, fall back to the structured text so the user always gets data.
      let finalMessage = formattedResponse.message;
      try {
        const humanMessages = [
          { role: "system", content: systemPrompt },
          { role: "system", content: RESPONSE_LAYOUT_PROMPT },
          ...chatSessionService.buildMessagesForAI(sessionData.messages),
          { role: "user", content: userMessage },
          {
            role: "function",
            name: functionName,
            content: formattedResponse.message,
          },
        ];
        const humanResponse = await askModel(humanMessages);
        const humanContent = humanResponse.choices?.[0]?.message?.content;
        if (humanContent) finalMessage = humanContent;
      } catch (humanErr) {
        logger.warn(
          `[Humanize] Fallback to structured response: ${humanErr.message}`,
        );
      }

      // Keep attempt queries deterministic to prevent contradictory paraphrases
      // like claiming no attempts "today" while listing attempts for today's date.
      if (
        functionName === "getAttemptsByCaseNumber" ||
        functionName === "getAttemptsByPhone"
      ) {
        finalMessage = formattedResponse.message;
      }

      if (
        functionName === "sendT9RidesharePayload" &&
        functionResult?.sent === false &&
        functionResult?.attachmentsRequired === true
      ) {
        finalMessage = i18n(
          userLang,
          `No se hizo el envío T9 del case ${functionResult.caseNumber} porque para este tier los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje y vuelve a pedir el envío.`,
          `T9 delivery was not started for case ${functionResult.caseNumber} because files are mandatory for this tier. Attach the required documents directly in the same message and request the submission again.`,
        );
      }

      if (functionName === "sendT9RidesharePayload" && functionResult?.sent) {
        const sentMessage = i18n(
          userLang,
          `Listo, envié correctamente el API del caso ${functionResult.caseNumber}.`,
          `Done, I sent the API successfully for case ${functionResult.caseNumber}.`,
        );

        const clientResponseText = functionResult.clientResponse || "N/A";
        let salesforceSavedText = "N/A";
        if (typeof functionResult.salesforceUpdated === "boolean") {
          salesforceSavedText = functionResult.salesforceUpdated
            ? i18n(userLang, "si", "yes")
            : i18n(userLang, "no", "no");
        }

        finalMessage = `${sentMessage}\n\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${clientResponseText}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${salesforceSavedText}`;
      }

      if (
        functionName === "sendJdcT3Payload" &&
        functionResult?.sent === false &&
        functionResult?.attachmentsRequired === true
      ) {
        finalMessage = i18n(
          userLang,
          `No se hizo el envío JDC T3 del case ${functionResult.caseNumber} porque los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje y vuelve a pedir el envío.`,
          `JDC T3 delivery was not started for case ${functionResult.caseNumber} because files are mandatory. Attach the required documents directly in the same message and request the submission again.`,
        );
      }

      if (functionName === "sendJdcT3Payload" && functionResult?.sent) {
        const sentMessage = i18n(
          userLang,
          `Listo, envié correctamente el API del caso ${functionResult.caseNumber}.`,
          `Done, I sent the API successfully for case ${functionResult.caseNumber}.`,
        );

        const clientResponseText = functionResult.clientResponse || "N/A";
        let salesforceSavedText = "N/A";
        if (typeof functionResult.salesforceUpdated === "boolean") {
          salesforceSavedText = functionResult.salesforceUpdated
            ? i18n(userLang, "si", "yes")
            : i18n(userLang, "no", "no");
        }

        finalMessage = `${sentMessage}\n\n${i18n(userLang, "HTTP", "HTTP")}: ${functionResult.statusCode || "N/A"}\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${clientResponseText}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${salesforceSavedText}`;
      }

      if (functionName === "sendBardPortT2Payload" && functionResult?.sent) {
        const sentMessage = i18n(
          userLang,
          `Listo, envié correctamente el API del caso ${functionResult.caseNumber}.`,
          `Done, I sent the API successfully for case ${functionResult.caseNumber}.`,
        );

        const clientResponseText = functionResult.clientResponse || "N/A";
        let salesforceSavedText = "N/A";
        if (typeof functionResult.salesforceUpdated === "boolean") {
          salesforceSavedText = functionResult.salesforceUpdated
            ? i18n(userLang, "si", "yes")
            : i18n(userLang, "no", "no");
        }

        finalMessage = `${sentMessage}\n\n${i18n(userLang, "HTTP", "HTTP")}: ${functionResult.statusCode || "N/A"}\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${clientResponseText}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${salesforceSavedText}`;
      }

      if (
        functionName === "sendA4DRideshareT11Payload" &&
        functionResult?.sent
      ) {
        const sentMessage = i18n(
          userLang,
          `Listo, envié correctamente el API del caso ${functionResult.caseNumber}.`,
          `Done, I sent the API successfully for case ${functionResult.caseNumber}.`,
        );
        const sfText =
          typeof functionResult.salesforceUpdated === "boolean"
            ? functionResult.salesforceUpdated
              ? i18n(userLang, "si", "yes")
              : i18n(userLang, "no", "no")
            : "N/A";
        finalMessage = `${sentMessage}\n\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${functionResult.clientResponse || "N/A"}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`;
      }

      const finalPayload = humanizePayload({
        ...formattedResponse,
        message: finalMessage,
      });

      // Persist conversation asynchronously — does not block the response
      chatSessionService
        .appendMessages(
          userId,
          [
            { role: "user", content: userMessage },
            { role: "assistant", content: finalPayload.message || "" },
          ],
          sessionCache[cacheKey].last_filters,
          functionResult,
        )
        .catch((err) =>
          logger.error(
            `[ChatSession] Failed to persist messages: ${err.message}`,
          ),
        );

      return finalPayload;
    }

    // Normal conversation (no function_call returned by the model)
    // Safety net: if the model skipped calling sendT9RidesharePayload and generated
    // a plain-text response instead, detect the intent locally and execute the function.
    const t9Intent = detectT9SendIntent(normalizedUserMessage);
    if (t9Intent && requestAttachments.length > 0) {
      logger.warn(
        `[T9 Safety Net] Model skipped function call. Forcing sendT9RidesharePayload for case ${t9Intent.caseNumber}`,
      );
      const t9FunctionResult =
        await apiIntegrations.t9Rideshare.sendT9RidesharePayload({
          caseNumber: t9Intent.caseNumber,
          tort: "Rideshare",
          tier: "T9",
          attachments: requestAttachments,
        });

      let t9FinalMessage;
      if (t9FunctionResult.sent) {
        const sfText =
          typeof t9FunctionResult.salesforceUpdated === "boolean"
            ? t9FunctionResult.salesforceUpdated
              ? i18n(userLang, "si", "yes")
              : i18n(userLang, "no", "no")
            : "N/A";
        t9FinalMessage = `${i18n(userLang, `Listo, envié correctamente el API del caso ${t9FunctionResult.caseNumber}.`, `Done, I sent the API successfully for case ${t9FunctionResult.caseNumber}.`)}\n\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${t9FunctionResult.clientResponse || "N/A"}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`;
      } else if (t9FunctionResult.attachmentsRequired) {
        t9FinalMessage = i18n(
          userLang,
          `No se hizo el envío T9 del case ${t9FunctionResult.caseNumber} porque los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje.`,
          `T9 delivery was not started for case ${t9FunctionResult.caseNumber} because files are mandatory for this tier. Attach the documents directly in the same message.`,
        );
      } else if (!t9FunctionResult.found) {
        t9FinalMessage = i18n(
          userLang,
          `No encontré el case ${t9Intent.caseNumber} en Salesforce. Verifica el número e intenta de nuevo.`,
          `I couldn't find case ${t9Intent.caseNumber} in Salesforce. Please verify the case number and try again.`,
        );
      } else {
        t9FinalMessage = i18n(
          userLang,
          `No se completó el envío T9 para el case ${t9FunctionResult.caseNumber}. ${t9FunctionResult.message || t9FunctionResult.error || "Revisa la configuración del endpoint"}.`,
          `T9 delivery for case ${t9FunctionResult.caseNumber} was not completed. ${t9FunctionResult.message || t9FunctionResult.error || "Check endpoint configuration"}.`,
        );
      }

      chatSessionService
        .appendMessages(
          userId,
          [
            { role: "user", content: userMessage },
            { role: "assistant", content: t9FinalMessage },
          ],
          sessionCache[cacheKey].last_filters,
          t9FunctionResult,
        )
        .catch((err) =>
          logger.error(
            `[ChatSession] Failed to persist messages: ${err.message}`,
          ),
        );

      return { message: t9FinalMessage };
    }

    const jdcIntent = detectJdcT3SendIntent(normalizedUserMessage);
    if (jdcIntent) {
      logger.warn(
        `[JDC T3 Safety Net] Model skipped function call. Forcing sendJdcT3Payload for case ${jdcIntent.caseNumber}`,
      );
      const jdcFunctionResult = await apiIntegrations.jdcT3.sendJdcT3Payload({
        caseNumber: jdcIntent.caseNumber,
        attachments: requestAttachments,
      });

      let jdcFinalMessage;
      if (jdcFunctionResult.sent) {
        const sfText =
          typeof jdcFunctionResult.salesforceUpdated === "boolean"
            ? jdcFunctionResult.salesforceUpdated
              ? i18n(userLang, "si", "yes")
              : i18n(userLang, "no", "no")
            : "N/A";
        jdcFinalMessage = `${i18n(userLang, `Listo, envié correctamente el API del caso ${jdcFunctionResult.caseNumber}.`, `Done, I sent the API successfully for case ${jdcFunctionResult.caseNumber}.`)}\n\n${i18n(userLang, "HTTP", "HTTP")}: ${jdcFunctionResult.statusCode || "N/A"}\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${jdcFunctionResult.clientResponse || "N/A"}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`;
      } else if (jdcFunctionResult.attachmentsRequired) {
        jdcFinalMessage = i18n(
          userLang,
          `No se hizo el envío JDC T3 del case ${jdcFunctionResult.caseNumber} porque los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje.`,
          `JDC T3 delivery was not started for case ${jdcFunctionResult.caseNumber} because files are mandatory. Attach the documents directly in the same message.`,
        );
      } else if (!jdcFunctionResult.found) {
        jdcFinalMessage = i18n(
          userLang,
          `No encontré el case ${jdcIntent.caseNumber} en Salesforce. Verifica el número e intenta de nuevo.`,
          `I couldn't find case ${jdcIntent.caseNumber} in Salesforce. Please verify the case number and try again.`,
        );
      } else {
        const sfText =
          typeof jdcFunctionResult.salesforceUpdated === "boolean"
            ? jdcFunctionResult.salesforceUpdated
              ? i18n(userLang, "si", "yes")
              : i18n(userLang, "no", "no")
            : "N/A";
        jdcFinalMessage = `${i18n(
          userLang,
          `No se completó el envío JDC T3 para el case ${jdcFunctionResult.caseNumber}. ${jdcFunctionResult.message || jdcFunctionResult.error || "Revisa la configuración del endpoint"}.`,
          `JDC T3 delivery for case ${jdcFunctionResult.caseNumber} was not completed. ${jdcFunctionResult.message || jdcFunctionResult.error || "Check endpoint configuration"}.`,
        )}\n\n${i18n(userLang, "HTTP", "HTTP")}: ${jdcFunctionResult.statusCode || "N/A"}\n${i18n(userLang, "Respuesta del cliente", "Client response")}: ${jdcFunctionResult.clientResponse || "N/A"}\n${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`;
      }

      chatSessionService
        .appendMessages(
          userId,
          [
            { role: "user", content: userMessage },
            { role: "assistant", content: jdcFinalMessage },
          ],
          sessionCache[cacheKey].last_filters,
          jdcFunctionResult,
        )
        .catch((err) =>
          logger.error(
            `[ChatSession] Failed to persist messages: ${err.message}`,
          ),
        );

      return { message: jdcFinalMessage };
    }

    const assistantContent = message.content || "";

    chatSessionService
      .appendMessages(
        userId,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: assistantContent },
        ],
        sessionCache[cacheKey].last_filters,
        null,
      )
      .catch((err) =>
        logger.error(
          `[ChatSession] Failed to persist messages: ${err.message}`,
        ),
      );

    return { message: assistantContent };
  } catch (error) {
    logger.error(`Chatbot processing error: ${error.message}`);

    switch (error.message) {
      case "AI_SERVICE_FAILURE":
        return {
          message: i18n(
            userLang,
            "El servicio de inteligencia artificial no esta disponible.",
            "The artificial intelligence service is not available.",
          ),
        };

      case "INVALID_FUNCTION_ARGUMENTS":
        return {
          message: i18n(
            userLang,
            "Hubo un problema procesando la solicitud.",
            "There was a problem processing the request.",
          ),
        };

      case "INVALID_PHONE":
        return {
          message: i18n(
            userLang,
            "Por favor envia un numero de telefono valido para consultar attempts.",
            "Please provide a valid phone number to check attempts.",
          ),
        };

      case "INVALID_DATE_FORMAT":
        return {
          message: i18n(
            userLang,
            "Por favor envia una fecha valida con formato YYYY-MM-DD.",
            "Please provide a valid date in YYYY-MM-DD format.",
          ),
        };

      case "INVALID_VENDOR_NAME":
        return {
          message: i18n(
            userLang,
            "Por favor indica un nombre de vendor valido.",
            "Please provide a valid vendor name.",
          ),
        };

      default:
        return {
          message: i18n(
            userLang,
            "Ocurrio un error inesperado.",
            "An unexpected error occurred.",
          ),
        };
    }
  }
};

async function formatResult(type, data, lang = "en") {
  if (!data) {
    return {
      message: i18n(lang, "No se encontraron resultados.", "No results found."),
    };
  }

  if (type === "getAttemptsByPhone") {
    return await formatAttemptsByPhoneResult(data, lang);
  }

  if (type === "getAttemptsByCaseNumber") {
    return await formatAttemptsByCaseNumberResult(data, lang);
  }

  if (type === "getCaseAttemptsByDate") {
    return await formatCaseAttemptsByDateResult(data, lang);
  }

  if (type === "getTotalAttemptsByAgent") {
    return formatTotalAttemptsByAgentResult(data, lang);
  }

  if (type === "getAgentAttemptsByPhonePerHour") {
    return formatAgentAttemptsByPhonePerHourResult(data, lang);
  }

  if (type === "getVicidialAgentsStatus") {
    return formatVicidialAgentsStatusResult(data, lang);
  }

  if (type === "getVendorsWithLeads") {
    return formatVendorsWithLeadsResult(data, lang);
  }

  if (type === "getTopVendors") {
    return formatTopVendorsResult(data, lang);
  }

  if (type === "getTopVendorsWithCaseDetails") {
    return formatTopVendorsWithCaseDetailsResult(data, lang);
  }

  if (type === "getVendorsBySupplierSegment") {
    return formatVendorsBySegmentResult(data, lang);
  }

  if (type === "getVendorLeadAttempts") {
    return formatVendorLeadAttemptsResult(data, lang);
  }

  if (type === "getCaseDisqualificationReason") {
    return formatCaseDisqualificationResult(data, lang);
  }

  if (type === "prepareT9RidesharePayload") {
    return formatPrepareT9RidesharePayloadResult(data, lang);
  }

  if (type === "sendT9RidesharePayload") {
    return formatSendT9RidesharePayloadResult(data, lang);
  }

  if (type === "prepareBardPortT2Payload") {
    return formatPrepareBardPortT2PayloadResult(data, lang);
  }

  if (type === "sendBardPortT2Payload") {
    return formatSendBardPortT2PayloadResult(data, lang);
  }

  if (type === "prepareA4DRideshareT11Payload") {
    return formatPrepareA4DRideshareT11PayloadResult(data, lang);
  }

  if (type === "sendA4DRideshareT11Payload") {
    return formatSendA4DRideshareT11PayloadResult(data, lang);
  }

  if (type === "prepareJdcT3Payload") {
    return formatPrepareJdcT3PayloadResult(data, lang);
  }

  if (type === "sendJdcT3Payload") {
    return formatSendJdcT3PayloadResult(data, lang);
  }

  // Grouped result
  if (type === "getCasesGroupedByField" && data.groups) {
    const scopeLabel =
      data.dateScope === "all"
        ? i18n(lang, "todos los registros", "all records")
        : data.dateScope.toUpperCase();

    const lines = Object.entries(data.groups)
      .map(([key, count]) => `• **${key}:** ${count}`)
      .join("\n");

    return {
      message: `
📊 **${i18n(lang, `Casos agrupados por ${data.fieldLabel}`, `Cases grouped by ${data.fieldLabel}`)}**
• **${i18n(lang, "Total", "Total")}:** ${data.total}
• **${i18n(lang, "Alcance", "Scope")}:** ${scopeLabel}

${lines}
`,
    };
  }

  // Assigned agent in dashboard (MySQL)
  if (type === "getAssignedAgentByCaseNumber") {
    if (!data.found) {
      return {
        message: `🔍 **${i18n(lang, "Asignación del caso", "Case Assignment")}: ${data.caseNumber}**\n\n${i18n(lang, "Este caso no tiene ningún agente asignado actualmente en el dashboard.", "This case has no agent currently assigned in the dashboard.")}`,
      };
    }
    return {
      message: `👤 **${i18n(lang, "Agente asignado al caso", "Assigned agent for case")}: ${data.caseNumber}**
• **${i18n(lang, "Agente", "Agent")}:** ${data.agentName || "N/A"}
• **${i18n(lang, "Email", "Email")}:** ${data.agentEmail || "N/A"}
• **${i18n(lang, "Asignado desde", "Assigned since")}:** ${formatDate(data.assignedAt, true)}
`,
    };
  }

  // Single case - show full details
  if (type === "getCaseByNumber") {
    return {
      message: `
📌 **${i18n(lang, "Caso", "Case")}: ${data.CaseNumber}**
• **${i18n(lang, "Estado", "Status")}:** ${data.Status}
• **${i18n(lang, "Subestado", "Substatus")}:** ${data.Substatus__c}
• **${i18n(lang, "Tipo", "Type")}:** ${data.Type}
• **${i18n(lang, "Origen", "Origin")}:** ${data.Origin}
• **${i18n(lang, "Segmento", "Supplier Segment")}:** ${data.Supplier_Segment__c}
• **${i18n(lang, "Propietario", "Owner")}:** ${data.Owner?.Name}
• **${i18n(lang, "Fecha de entrada", "Entry date")}:** ${formatDate(data.CreatedDate, true)}${data.ClosedDate ? `\n• **${i18n(lang, "Fecha de cierre", "Closed date")}:** ${formatDate(data.ClosedDate, true)}` : ""}
`,
    };
  }

  // Multiple cases - determine if bulk or not
  let casesArray = [];
  let totalCount = 0;

  if (data.records && Array.isArray(data.records)) {
    casesArray = data.records;
    totalCount = data.total || data.records.length;
  } else if (Array.isArray(data)) {
    casesArray = data;
    totalCount = data.length;
  } else if (data.summary) {
    // Operational summary
    return {
      message: `
📊 **${i18n(lang, "Resumen Operativo", "Operational Summary")}**

• **${i18n(lang, "Total", "Total")}:** ${data.summary.total}

**${i18n(lang, "Por Estado", "By Status")}:**
${formatSummary(data.summary.byStatus)}

**${i18n(lang, "Por Origen", "By Origin")}:**
${formatSummary(data.summary.byOrigin)}

**${i18n(lang, "Por Segmento", "By Segment")}:**
${formatSummary(data.summary.bySegment)}
`,
    };
  }

  // If cases exist, determine if bulk
  if (casesArray.length > 0) {
    // BULK CASES: Generate Excel
    if (casesArray.length > BULK_THRESHOLD) {
      try {
        const excelFile = await Promise.resolve(
          excelService.generateCasesExcel(casesArray),
        );

        return {
          message: `
📊 **Bulk Results Found**

✅ A total of **${totalCount} cases** were found.

Due to the number of records, I have prepared a complete Excel file with all the details for you to download and analyze:

📥 **File:** ${excelFile.fileName}

The file contains:
• Case Number
• Status and Substatus
• Case Type
• Origin
• Supplier Segment
• Assigned Owner
• Contact Information
• And more details...
`,
          excelFile,
        };
      } catch (error) {
        logger.error(`Error generating Excel: ${error.message}`);
        // Fallback: show first cases in chat
        return {
          message: formatSmallResultSet(casesArray, totalCount),
        };
      }
    }

    // SMALL SET: Show in chat
    return {
      message: formatSmallResultSet(casesArray, totalCount, lang),
    };
  }

  return {
    message: i18n(lang, "No se encontraron resultados.", "No results found."),
  };
}

/**
 * Formats a small result set for chat display
 */
function formatSmallResultSet(casesArray, totalCount, lang = "en") {
  let output = `📋 **${i18n(lang, "Total de Casos", "Total Cases")}: ${totalCount}**\n\n`;

  casesArray.slice(0, 20).forEach((caseItem, i) => {
    output += `${i + 1}. **${caseItem.CaseNumber}** | ${i18n(lang, "Tipo", "Type")}: ${caseItem.Type || "N/A"} | Tier: ${caseItem.Tier__c || "N/A"} | ${caseItem.Substatus__c || "N/A"} | ${caseItem.Owner?.Name || "Unassigned"}\n`;
  });

  return output;
}

/**
 * Formats a summary into a readable structure
 */
function formatSummary(summaryObj) {
  if (!summaryObj) return "N/A";

  return Object.entries(summaryObj)
    .map(([key, value]) => `  • ${key}: ${value}`)
    .join("\n");
}

async function formatAttemptsByPhoneResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron attempts para el telefono **${data.phone}** en el periodo solicitado.`,
        `No attempts found for phone **${data.phone}** in the requested period.`,
      ),
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((row) => ({
        phone: data.phone,
        call_date: row.call_date,
        attempts: row.attempts,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(excelRows),
      );

      return {
        message: `
      📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
      • **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
      • **${i18n(lang, "Dias con registros", "Days with records")}:** ${data.totalDays}

      ${i18n(lang, "El resultado es amplio, asi que genere un archivo Excel con el detalle completo de attempts.", "The result is extensive, so I generated an Excel file with full attempt details.")}

      📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 30)
    .map(
      (row, idx) =>
        `${idx + 1}. ${row.call_date}: ${row.attempts} ${i18n(lang, "intentos", "attempts")}`,
    )
    .join("\n");

  const scopeLabel =
    data.scope === "all" ? "all available dates" : data.scopeLabel;

  if (data.totalDays === 1 && data.records[0]) {
    const singleDay = data.records[0];

    return {
      message: `
    📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
    • **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
    • **${i18n(lang, "Fecha", "Date")}:** ${singleDay.call_date}
`,
    };
  }

  return {
    message: `
📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
• **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
• **${i18n(lang, "Dias con registros", "Days with records")}:** ${data.totalDays}
• **${i18n(lang, "Alcance", "Scope")}:** ${scopeLabel}

**${i18n(lang, "Attempts por fecha", "Attempts by date")}:**
${lines}
`,
  };
}

async function formatAttemptsByCaseNumberResult(data, lang = "en") {
  if (!data) {
    return {
      message: i18n(
        lang,
        "No se encontro un caso con ese numero.",
        "No case found with that case number.",
      ),
    };
  }

  if (!data.phone) {
    return {
      message: `
    📌 **${i18n(lang, "Caso", "Case")}:** ${data.caseNumber}
    ${i18n(lang, "Este caso no tiene un telefono asociado, por eso no se pueden calcular attempts.", "No phone number is associated with this case, so attempts cannot be calculated.")}
`,
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((row) => ({
        CaseNumber: data.caseNumber,
        phone: data.phone,
        call_date: row.call_date,
        attempts: row.attempts,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(excelRows),
      );

      return {
        message: `
      📌 **${i18n(lang, "Caso", "Case")}:** ${data.caseNumber}
      📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
      • **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
      • **${i18n(lang, "Dias con registros", "Days with records")}:** ${data.totalDays}

      ${i18n(lang, "El resultado es amplio, asi que genere un Excel con el historial completo de attempts.", "The result is extensive, so I generated an Excel file with the full attempts history.")}

      📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = (data.records || [])
    .slice(0, 30)
    .map(
      (row, idx) =>
        `${idx + 1}. ${row.call_date}: ${row.attempts} ${i18n(lang, "intentos", "attempts")}`,
    )
    .join("\n");

  return {
    message: `
📌 **${i18n(lang, "Caso", "Case")}:** ${data.caseNumber}
📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
• **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
• **${i18n(lang, "Dias con registros", "Days with records")}:** ${data.totalDays}

${
  lines
    ? `**${i18n(lang, "Attempts por fecha", "Attempts by date")}:**\n${lines}`
    : i18n(
        lang,
        "No se encontraron attempts para el telefono de este caso.",
        "No attempts found for this case phone.",
      )
}
`,
  };
}

async function formatCaseAttemptsByDateResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron casos para ${data.date}.`,
        `No cases found for ${data.date}.`,
      ),
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(data.records),
      );

      return {
        message: `
      📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
      • **${i18n(lang, "Total de Casos", "Total Cases")}:** ${data.totalCases}
      • **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}

      ${i18n(lang, "La lista es amplia, asi que genere un Excel con el detalle completo de attempts por caso.", "The list is extensive, so I generated an Excel file with full attempt details by case.")}

      📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating attempts Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 40)
    .map(
      (item, idx) =>
        `${idx + 1}. **${item.CaseNumber}** | ${i18n(lang, "intentos", "attempts")}: ${item.attempts} | ${i18n(lang, "telefono", "phone")}: ${item.phone || "N/A"}`,
    )
    .join("\n");

  return {
    message: `
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Total de Casos", "Total Cases")}:** ${data.totalCases}
• **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}

**${i18n(lang, "Lista de Attempts por Caso", "Case Attempts List")}:**
${lines}
`,
  };
}

function formatTotalAttemptsByAgentResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron attempts para el agente **${data?.agentName || ""}** en **${data?.date || "la fecha solicitada"}**.`,
        `No attempts found for agent **${data?.agentName || ""}** on **${data?.date || "the requested date"}**.`,
      ),
    };
  }

  const hourLines = (data.byHour || [])
    .map(
      (item) =>
        `• ${String(item.hour).padStart(2, "0")}:00 -> ${item.attempts}`,
    )
    .join("\n");

  return {
    message: `
👤 **${i18n(lang, "Agente", "Agent")}:** ${data.agentName}
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}
• **${i18n(lang, "Telefonos Unicos", "Unique Phones")}:** ${data.totalPhones}

**${i18n(lang, "Attempts por hora", "Attempts by hour")}:**
${hourLines || i18n(lang, "Sin datos por hora.", "No hourly data.")}
`,
  };
}

function formatAgentAttemptsByPhonePerHourResult(data, lang = "en") {
  if (!data?.byHour?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron attempts para el agente **${data?.agentName || ""}** y telefono **${data?.phone || ""}** en **${data?.date || "la fecha solicitada"}**.`,
        `No attempts found for agent **${data?.agentName || ""}** and phone **${data?.phone || ""}** on **${data?.date || "the requested date"}**.`,
      ),
    };
  }

  const lines = data.byHour
    .map(
      (row) => `• ${String(row.hour).padStart(2, "0")}:00 -> ${row.attempts}`,
    )
    .join("\n");

  return {
    message: `
👤 **${i18n(lang, "Agente", "Agent")}:** ${data.agentName}
📞 **${i18n(lang, "Telefono", "Phone")}:** ${data.phone}
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Attempts Totales", "Total Attempts")}:** ${data.totalAttempts}

**${i18n(lang, "Attempts por hora", "Attempts by hour")}:**
${lines}
`,
  };
}

function formatVicidialAgentsStatusResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        "No se encontraron agentes activos en Vicidial para ese filtro.",
        "No active Vicidial agents were found for that filter.",
      ),
    };
  }

  const lines = data.records
    .slice(0, 30)
    .map(
      (agent, idx) =>
        `${idx + 1}. **${agent.name}** | ${i18n(lang, "Estado", "Status")}: ${agent.status || "N/A"} | ${i18n(lang, "Tiempo en estado", "Time in status")}: ${agent.time_in_status || "N/A"}`,
    )
    .join("\n");

  return {
    message: `
🛰️ **${i18n(lang, "Agentes Vicidial", "Vicidial Agents")}**
• **${i18n(lang, "Total", "Total")}:** ${data.total}

${lines}
`,
  };
}

async function formatVendorsWithLeadsResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        "No se encontraron vendors con leads para ese periodo.",
        "No vendors with leads were found for that period.",
      ),
    };
  }

  if (data.records.length > VENDORS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((item) => ({
        vendor: item.vendor,
        segment: item.segment || "N/A",
        totalLeads: item.totalLeads,
        scope: data.scope,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateVendorsExcel(excelRows),
      );

      return {
        message: `
🏢 **${i18n(lang, "Vendors con leads", "Vendors with leads")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Total vendors", "Total vendors")}:** ${data.totalVendors}
• **${i18n(lang, "Total leads", "Total leads")}:** ${data.totalLeads}

${i18n(
  lang,
  "El resultado trae muchos vendors, asi que prepare un Excel con el detalle completo para revisarlo mejor.",
  "The result contains many vendors, so I prepared an Excel file with the full detail for easier review.",
)}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating vendors Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 30)
    .map((item, idx) => `${idx + 1}. **${item.vendor}** -> ${item.totalLeads}`)
    .join("\n");

  return {
    message: `
🏢 **${i18n(lang, "Vendors con leads", "Vendors with leads")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Total vendors", "Total vendors")}:** ${data.totalVendors}
• **${i18n(lang, "Total leads", "Total leads")}:** ${data.totalLeads}

${lines}
`,
  };
}

async function formatTopVendorsResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        "No se encontraron vendors para generar el top en ese periodo.",
        "No vendors were found to build the ranking for that period.",
      ),
    };
  }

  if (data.records.length > VENDORS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((item) => ({
        vendor: item.vendor,
        segment: item.segment || "N/A",
        totalLeads: item.totalLeads,
        scope: data.scope,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateVendorsExcel(excelRows),
      );

      return {
        message: `
🏆 **${i18n(lang, "Top Vendors", "Top Vendors")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Top", "Top")}:** ${data.limit}

${i18n(
  lang,
  "El ranking es amplio, por eso te deje el reporte completo en Excel.",
  "The ranking is extensive, so I exported the full report to Excel.",
)}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating vendors Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .map((item, idx) => `${idx + 1}. **${item.vendor}** -> ${item.totalLeads}`)
    .join("\n");

  return {
    message: `
🏆 **${i18n(lang, "Top Vendors", "Top Vendors")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Top", "Top")}:** ${data.limit}

${lines}
`,
  };
}

async function formatVendorsBySegmentResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron vendors en el segmento **${data?.segment || ""}** para ese periodo.`,
        `No vendors were found in segment **${data?.segment || ""}** for that period.`,
      ),
    };
  }

  if (data.records.length > VENDORS_BULK_THRESHOLD) {
    try {
      const excelRows = data.records.map((item) => ({
        vendor: item.vendor,
        segment: item.segment || data.segment || "N/A",
        totalLeads: item.totalLeads,
        scope: data.scope,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateVendorsExcel(excelRows),
      );

      return {
        message: `
📈 **${i18n(lang, "Vendors por Supplier Segment", "Vendors by Supplier Segment")}**
• **${i18n(lang, "Segmento", "Segment")}:** ${data.segment}
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Total vendors", "Total vendors")}:** ${data.totalVendors}
• **${i18n(lang, "Total leads", "Total leads")}:** ${data.totalLeads}

${i18n(
  lang,
  "Hay muchos vendors en este segmento, asi que te comparti el detalle completo en Excel.",
  "There are many vendors in this segment, so I shared the full detail in an Excel file.",
)}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating vendors Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 30)
    .map((item, idx) => `${idx + 1}. **${item.vendor}** -> ${item.totalLeads}`)
    .join("\n");

  return {
    message: `
📈 **${i18n(lang, "Vendors por Supplier Segment", "Vendors by Supplier Segment")}**
• **${i18n(lang, "Segmento", "Segment")}:** ${data.segment}
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Total vendors", "Total vendors")}:** ${data.totalVendors}
• **${i18n(lang, "Total leads", "Total leads")}:** ${data.totalLeads}

${lines}
`,
  };
}

async function formatTopVendorsWithCaseDetailsResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        "No se encontraron vendors para ese top con los filtros indicados.",
        "No vendors were found for that ranking with the selected filters.",
      ),
    };
  }

  const detailRows = data.records.flatMap((vendorItem) =>
    (vendorItem.cases || []).map((caseItem) => ({
      vendor: vendorItem.vendor,
      caseNumber: caseItem.caseNumber,
      phone: caseItem.phone,
      segment: caseItem.segment || vendorItem.segment || "N/A",
      createdDate: caseItem.createdDate,
      scope: data.scope,
    })),
  );

  if (detailRows.length > VENDOR_CASE_DETAILS_BULK_THRESHOLD) {
    try {
      const excelFile = await Promise.resolve(
        excelService.generateVendorCasesExcel(detailRows),
      );

      return {
        message: `
🏆 **${i18n(lang, "Top Vendors con detalle de leads", "Top Vendors with lead details")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Top", "Top")}:** ${data.limit}
• **${i18n(lang, "Leads listados", "Listed leads")}:** ${detailRows.length}

${i18n(
  lang,
  "Como salieron muchos leads, te deje el detalle completo (vendor, case number y phone) en un Excel.",
  "Since many leads were found, I exported the full detail (vendor, case number, and phone) to Excel.",
)}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(
        `Error generating vendor case detail Excel: ${error.message}`,
      );
    }
  }

  const lines = data.records
    .map((vendorItem, idx) => {
      const caseLines = (vendorItem.cases || [])
        .slice(0, 10)
        .map(
          (caseItem) =>
            `   - ${caseItem.caseNumber || "N/A"} | ${i18n(lang, "telefono", "phone")}: ${caseItem.phone || "N/A"}`,
        )
        .join("\n");

      return `${idx + 1}. **${vendorItem.vendor}** (${i18n(lang, "leads", "leads")}: ${vendorItem.totalLeads})\n${caseLines || `   - ${i18n(lang, "Sin casos", "No cases")}`}`;
    })
    .join("\n");

  return {
    message: `
🏆 **${i18n(lang, "Top Vendors con detalle de leads", "Top Vendors with lead details")}**
• **${i18n(lang, "Periodo", "Period")}:** ${data.scope}
• **${i18n(lang, "Top", "Top")}:** ${data.limit}

${lines}
`,
  };
}

async function formatVendorLeadAttemptsResult(data, lang = "en") {
  if (!data?.records?.length) {
    return {
      message: i18n(
        lang,
        `No se encontraron leads para el vendor **${data?.vendorName || ""}** con ese filtro de fecha.`,
        `No leads were found for vendor **${data?.vendorName || ""}** with that date filter.`,
      ),
    };
  }

  if (data.records.length > ATTEMPTS_BULK_THRESHOLD) {
    try {
      const excelRows =
        data.exportRows ||
        data.records.map((item) => ({
          vendor: item.vendor,
          caseNumber: item.caseNumber,
          phone: item.phone,
          attempts: item.attempts,
          segment: item.segment,
          createdDate: item.createdDate,
          scope: data.scope,
          callDate: null,
          hour: null,
          agentName: null,
          callCenter: null,
          assignmentType: item.matchQuality || "N/A",
        }));

      const excelFile = await Promise.resolve(
        excelService.generateVendorAttemptsExcel(excelRows),
      );

      return {
        message: `
📞 **${i18n(lang, "Attempts por lead del vendor", "Attempts by vendor lead")}**
• **${i18n(lang, "Vendor", "Vendor")}:** ${data.vendorName}
• **${i18n(lang, "Periodo de leads", "Lead period")}:** ${data.scope}
• **${i18n(lang, "Periodo de attempts", "Attempts period")}:** ${data.attemptsScope}
• **${i18n(lang, "Total de leads", "Total leads")}:** ${data.totalCases}
• **${i18n(lang, "Attempts totales", "Total attempts")}:** ${data.totalAttempts}
• **${i18n(lang, "Detalle", "Detail mode")}:** ${data.detailMode}
${
  data.includeAgentDetails
    ? `• **${i18n(lang, "Vista por agente", "Agent view")}:** ${data.agentDetailsAvailable ? i18n(lang, "si", "yes") : i18n(lang, "no disponible para historial agregado", "not available for aggregated history")}
`
    : ""
}

${i18n(
  lang,
  "El resultado es amplio, por eso te exporte el detalle completo con case number, phone, attempts y hora cuando aplica.",
  "The result set is large, so I exported the full detail with case number, phone, attempts, and hour when available.",
)}

${
  data.ambiguousRows
    ? i18n(
        lang,
        `Ojo: ${data.ambiguousRows} registros quedaron como ambiguos por telefonos repetidos entre casos y no los asigne de forma inventada.`,
        `Note: ${data.ambiguousRows} rows were ambiguous because the same phone appeared in multiple cases, so I did not force a fake assignment.`,
      )
    : ""
}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating vendor attempts Excel: ${error.message}`);
    }
  }

  const lines = data.records
    .slice(0, 40)
    .map((row, idx) => {
      const hourlyText = (row.byHour || []).length
        ? (row.byHour || [])
            .slice(0, 6)
            .map((item) => {
              if (!data.includeAgentDetails) {
                return `${item.label} (${item.attempts})`;
              }

              return `${item.label} (${item.attempts}) - ${i18n(lang, "agente", "agent")}: ${item.agentName || "N/A"} - ${i18n(lang, "call center", "call center")}: ${item.callCenter || "N/A"}`;
            })
            .join(", ")
        : i18n(
            lang,
            row.ambiguousPhone
              ? "telefono ambiguo entre varios casos"
              : "sin detalle por hora",
            row.ambiguousPhone
              ? "ambiguous phone across multiple cases"
              : "no hourly detail",
          );

      return `${idx + 1}. **${row.caseNumber || "N/A"}** | ${i18n(lang, "telefono", "phone")}: ${row.phone || "N/A"} | ${i18n(lang, "attempts", "attempts")}: ${row.attempts} | ${i18n(lang, "horas", "hours")}: ${hourlyText}`;
    })
    .join("\n");

  return {
    message: `
📞 **${i18n(lang, "Attempts por lead del vendor", "Attempts by vendor lead")}**
• **${i18n(lang, "Vendor", "Vendor")}:** ${data.vendorName}
• **${i18n(lang, "Periodo de leads", "Lead period")}:** ${data.scope}
• **${i18n(lang, "Periodo de attempts", "Attempts period")}:** ${data.attemptsScope}
• **${i18n(lang, "Total de leads", "Total leads")}:** ${data.totalCases}
• **${i18n(lang, "Attempts totales", "Total attempts")}:** ${data.totalAttempts}
• **${i18n(lang, "Detalle", "Detail mode")}:** ${data.detailMode}
${
  data.includeAgentDetails
    ? `• **${i18n(lang, "Vista por agente", "Agent view")}:** ${data.agentDetailsAvailable ? i18n(lang, "si", "yes") : i18n(lang, "no disponible para historial agregado", "not available for aggregated history")}
`
    : ""
}

${
  data.ambiguousRows
    ? `• **${i18n(lang, "Filas ambiguas", "Ambiguous rows")}:** ${data.ambiguousRows}\n`
    : ""
}

${lines}
`,
  };
}

// Formats the result of getCaseDisqualificationReason
function formatCaseDisqualificationResult(data, lang = "en") {
  if (data.missingCaseNumber) {
    return {
      message: i18n(
        lang,
        "Te ayudo con eso. Solo necesito el número de caso para buscar la razón exacta de descalificación.",
        "I can help with that. I only need the case number to fetch the exact disqualification reason.",
      ),
    };
  }

  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré ningún caso con el número ${data.caseNumber}. Verifica que el número sea correcto.`,
        `I couldn't find any case with number ${data.caseNumber}. Please double-check the case number.`,
      ),
    };
  }

  const lines = [];
  lines.push(`📋 **${i18n(lang, "Case", "Case")} ${data.caseNumber}**`);
  lines.push(
    `• **${i18n(lang, "Status", "Status")}:** ${data.status || "N/A"}`,
  );
  lines.push(
    `• **${i18n(lang, "Substatus", "Substatus")}:** ${data.substatus || "N/A"}`,
  );

  if (data.bpo) {
    lines.push(
      `• **${i18n(lang, "Call Center", "Call Center")}:** ${data.bpo}`,
    );
  }

  if (data.bpoIntaker) {
    lines.push(
      `• **${i18n(lang, "Intaker que descalificó", "Disqualifying intaker")}:** ${data.bpoIntaker}`,
    );
  }

  if (data.reasonForDQ) {
    lines.push(
      `• **${i18n(lang, "Razón de descalificación", "Reason for DQ")}:** ${data.reasonForDQ}`,
    );
  }

  if (data.reasonDoesntMeetCriteria) {
    lines.push(
      `• **${i18n(lang, "No cumple criterios", "Doesn't meet criteria")}:** ${data.reasonDoesntMeetCriteria}`,
    );
  }

  if (!data.reasonForDQ && !data.reasonDoesntMeetCriteria) {
    lines.push(
      i18n(
        lang,
        "Este caso está marcado como Descalificado pero no tiene razón registrada en Salesforce.",
        "This case is marked as Disqualified but has no reason recorded in Salesforce.",
      ),
    );
  }

  if (data.owner) {
    lines.push(`• **${i18n(lang, "Owner", "Owner")}:** ${data.owner}`);
  }

  return { message: lines.join("\n") };
}

function formatPrepareT9RidesharePayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload T9.`,
        `I couldn't find case ${data.caseNumber} to build the T9 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload T9 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build T9 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload T9 preparado", "T9 payload prepared")}**
• **Case:** ${data.caseNumber}
• **Tort:** ${data.tort}
• **Tier:** ${data.tier}

${i18n(
  lang,
  "La estructura JSON quedó lista para envío al endpoint del cliente.",
  "The JSON structure is ready to be sent to the client endpoint.",
)}
`,
  };
}

function formatSendT9RidesharePayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload T9.`,
        `I couldn't find case ${data.caseNumber}. I could not send the T9 payload.`,
      ),
    };
  }

  if (data.attachmentsRequired) {
    return {
      message: i18n(
        lang,
        `No se hizo el envío T9 del case ${data.caseNumber} porque para este tier los archivos son obligatorios. Vuelve a enviar tu mensaje del chatbot adjuntando los documentos en la misma solicitud usando el campo files, y luego pide el envío otra vez.`,
        `T9 delivery was not started for case ${data.caseNumber} because files are mandatory for this tier. Send your chatbot message again with the required documents attached in the same request using the files field, then ask to submit it again.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload T9 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send T9 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (!data.sent) {
    if (data.dryRun) {
      return {
        message: i18n(
          lang,
          `🧪 Simulación T9 completada para el case ${data.caseNumber}. No se envió al cliente porque el modo dry-run está activo. Revisé y registré en logs el body final con campos y archivos (${data.attachmentsCount}).`,
          `🧪 T9 simulation completed for case ${data.caseNumber}. It was not sent to the client because dry-run mode is active. The final body with fields and files (${data.attachmentsCount}) was logged.`,
        ),
      };
    }

    return {
      message: i18n(
        lang,
        `No se completó el envío T9 para el case ${data.caseNumber}. ${data.message || data.error || "Revisa la configuración del endpoint"}.`,
        `T9 delivery for case ${data.caseNumber} was not completed. ${data.message || data.error || "Check endpoint configuration"}.`,
      ),
    };
  }

  const sfText =
    typeof data.salesforceUpdated === "boolean"
      ? data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no")
      : "N/A";

  return {
    message: `${i18n(lang, `Listo, envié correctamente el API del caso ${data.caseNumber}.`, `Done, I sent the API successfully for case ${data.caseNumber}.`)}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
  };
}

function formatPrepareBardPortT2PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de Bard Port T2.`,
        `I couldn't find case ${data.caseNumber} to build the Bard Port T2 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de Bard Port T2 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build Bard Port T2 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload Bard Port T2 preparado", "Bard Port T2 payload prepared")}**
• **Case:** ${data.caseNumber}
• **Tort:** ${data.tort}
• **Tier:** ${data.tier}

${i18n(
  lang,
  "La estructura JSON quedó lista para envío al endpoint del cliente.",
  "The JSON structure is ready to be sent to the client endpoint.",
)}
`,
  };
}

function formatSendBardPortT2PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de Bard Port T2.`,
        `I couldn't find case ${data.caseNumber}. I could not send the Bard Port T2 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload de Bard Port T2 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send Bard Port T2 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (!data.sent) {
    const httpText = data.statusCode || "N/A";
    let salesforceSavedText = "N/A";
    if (typeof data.salesforceUpdated === "boolean") {
      salesforceSavedText = data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no");
    }

    return {
      message: `${i18n(
        lang,
        `No se completó el envío de Bard Port T2 para el case ${data.caseNumber}. ${data.message || data.error || "Revisa la configuración del endpoint"}.`,
        `Bard Port T2 delivery for case ${data.caseNumber} was not completed. ${data.message || data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${httpText}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${salesforceSavedText}`,
    };
  }

  const sfText =
    typeof data.salesforceUpdated === "boolean"
      ? data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no")
      : "N/A";

  return {
    message: `${i18n(lang, `Listo, envié correctamente el API del caso ${data.caseNumber}.`, `Done, I sent the API successfully for case ${data.caseNumber}.`)}\n\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
  };
}

function formatPrepareA4DRideshareT11PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de A4D Rideshare T11.`,
        `I couldn't find case ${data.caseNumber} to build the A4D Rideshare T11 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de A4D Rideshare T11 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build A4D Rideshare T11 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload A4D Rideshare T11 preparado", "A4D Rideshare T11 payload prepared")}**
• **Case:** ${data.caseNumber}

${i18n(
  lang,
  "La estructura JSON quedó lista para envío al endpoint del cliente.",
  "The JSON structure is ready to be sent to the client endpoint.",
)}
`,
  };
}

function formatSendA4DRideshareT11PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de A4D Rideshare T11.`,
        `I couldn't find case ${data.caseNumber}. I could not send the A4D Rideshare T11 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload de A4D Rideshare T11 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send A4D Rideshare T11 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (!data.sent) {
    return {
      message: i18n(
        lang,
        `No se completó el envío de A4D Rideshare T11 para el case ${data.caseNumber}. ${data.error || "Revisa la configuración del endpoint"}.`,
        `A4D Rideshare T11 delivery for case ${data.caseNumber} was not completed. ${data.error || "Check endpoint configuration"}.`,
      ),
    };
  }

  const sfText =
    typeof data.salesforceUpdated === "boolean"
      ? data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no")
      : "N/A";

  return {
    message: `${i18n(lang, `Listo, envié correctamente el API del caso ${data.caseNumber}.`, `Done, I sent the API successfully for case ${data.caseNumber}.`)}\n\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
  };
}

function formatPrepareJdcT3PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de JDC T3.`,
        `I couldn't find case ${data.caseNumber} to build the JDC T3 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de JDC T3 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build JDC T3 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload JDC T3 preparado", "JDC T3 payload prepared")}**
• **Case:** ${data.caseNumber}

${i18n(
  lang,
  "La estructura JSON quedó lista para envío al endpoint del cliente.",
  "The JSON structure is ready to be sent to the client endpoint.",
)}
`,
  };
}

function formatSendJdcT3PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de JDC T3.`,
        `I couldn't find case ${data.caseNumber}. I could not send the JDC T3 payload.`,
      ),
    };
  }

  if (data.attachmentsRequired) {
    return {
      message: i18n(
        lang,
        `No se hizo el envío JDC T3 del case ${data.caseNumber} porque los archivos son obligatorios. Vuelve a enviar tu mensaje del chatbot adjuntando los documentos en la misma solicitud usando el campo files, y luego pide el envío otra vez.`,
        `JDC T3 delivery was not started for case ${data.caseNumber} because files are mandatory. Send your chatbot message again with the required documents attached in the same request using the files field, then ask to submit it again.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload JDC T3 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send JDC T3 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (!data.sent) {
    const sfText =
      typeof data.salesforceUpdated === "boolean"
        ? data.salesforceUpdated
          ? i18n(lang, "si", "yes")
          : i18n(lang, "no", "no")
        : "N/A";

    return {
      message: `${i18n(
        lang,
        `No se completó el envío JDC T3 para el case ${data.caseNumber}. ${data.error || "Revisa la configuración del endpoint"}.`,
        `JDC T3 delivery for case ${data.caseNumber} was not completed. ${data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    };
  }

  const sfText =
    typeof data.salesforceUpdated === "boolean"
      ? data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no")
      : "N/A";

  return {
    message: `${i18n(lang, `Listo, envié correctamente el API del caso ${data.caseNumber}.`, `Done, I sent the API successfully for case ${data.caseNumber}.`)}\n\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
  };
}
