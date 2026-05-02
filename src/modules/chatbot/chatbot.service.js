const metrics = require("./metrics");
const logger = require("../../utils/logger");
const { askModel } = require("./ai.config");
const { systemPrompt } = require("./prompts");
const excelService = require("./excel.service");
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
function formatDate(dateString) {
  if (!dateString) return "N/A";

  try {
    const date = DateTime.fromISO(dateString);
    if (!date.isValid) return "N/A";

    return date.toFormat("dd/MM/yyyy HH:mm");
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
    /(?:case|caso|lead|casenumber|numero de caso)\s*(?:#|number|numero)?\s*[:\-]?\s*(\d{6,12})/i;

  for (let i = storedMessages.length - 1; i >= 0; i -= 1) {
    const content = String(storedMessages[i]?.content || "");
    if (!content) continue;

    const contextualMatch = content.match(contextualPattern);
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

exports.processMessage = async (userMessage, userId = null) => {
  const normalizedUserMessage = normalizeBusinessQuery(userMessage);
  const userLang = detectUserLanguage(normalizedUserMessage);

  try {
    logger.info(
      `Incoming chatbot message [user:${userId}]: ${normalizedUserMessage}`,
    );

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
    const messages = [
      { role: "system", content: systemPrompt },
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

      switch (functionName) {
        case "getCaseByDate":
          functionResult = await metrics.sf.getCaseByDate(
            args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
          );
          break;

        case "getCaseByNumber":
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

        case "getAttemptsByCaseNumber":
          functionResult = await metrics.sql.getAttemptsByCaseNumber(
            args.caseNumber,
          );
          break;

        case "getCaseAttemptsByDate":
          functionResult = await metrics.sql.getCaseAttemptsByDate({
            dateKeyword: args.dateKeyword,
            date: args.date,
          });
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
• **${i18n(lang, "Creado", "Created")}:** ${formatDate(data.CreatedDate)}
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
