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

function isFollowUpQuery(message) {
  const text = String(message || "")
    .trim()
    .toLowerCase();
  if (!text) return false;

  const followUpCues = [
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
  ];

  const shortMessage = text.length <= 90;
  return shortMessage && followUpCues.some((cue) => text.includes(cue));
}

function enrichWithSessionContext(userMessage, sessionData) {
  if (!sessionData?.lastFilters || !isFollowUpQuery(userMessage)) {
    return userMessage;
  }

  const f = sessionData.lastFilters;
  const context = [];

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

function humanizePayload(payload, type, lang = "en") {
  if (!payload?.message) return payload;

  const baseMessage = String(payload.message).trim();
  const spanishIntros = [
    "Listo, te comparto lo que encontré:",
    "Perfecto, revisé la información y esto es lo relevante:",
    "Claro, aquí tienes el resultado:",
    "Hecho, este es el resumen:",
  ];
  const englishIntros = [
    "Done, here is what I found:",
    "Sure, here is the result:",
    "I checked it, here are the key details:",
    "Great, this is what came back:",
  ];

  const spanishOutros = payload.excelFile
    ? [
        "Si quieres, también puedo ayudarte a filtrar este resultado por estado, origen o fecha.",
        "Si te sirve, en el siguiente paso te lo separo por estado o por agente.",
      ]
    : [
        "Si quieres, lo refinamos más con otro filtro.",
        "Si necesitas, te lo desgloso por fecha, estado o agente.",
      ];

  const englishOutros = payload.excelFile
    ? [
        "If you want, I can also break this down by status, origin, or date.",
        "I can refine this further by agent or date in the next step.",
      ]
    : [
        "If you want, I can refine it with another filter.",
        "I can break this down further by date, status, or agent.",
      ];

  const intro =
    lang === "es"
      ? pickVariant(spanishIntros, `${type}:${baseMessage.length}`)
      : pickVariant(englishIntros, `${type}:${baseMessage.length}`);

  const outro =
    lang === "es"
      ? pickVariant(spanishOutros, `${baseMessage.length}:${type}`)
      : pickVariant(englishOutros, `${baseMessage.length}:${type}`);

  return {
    ...payload,
    message: `${intro}\n\n${baseMessage}\n\n${outro}`,
  };
}

exports.processMessage = async (userMessage, userId = null) => {
  const userLang = detectUserLanguage(userMessage);

  try {
    logger.info(`Incoming chatbot message [user:${userId}]: ${userMessage}`);

    // Load session from DB; cache in memory (L1) to reduce DB reads within the same process
    const cacheKey = String(userId ?? "anonymous");
    if (!sessionCache[cacheKey]) {
      sessionCache[cacheKey] =
        await chatSessionService.getOrCreateSession(userId);
    }
    const sessionData = sessionCache[cacheKey];

    // Enrich the message with previous filter context if this looks like a follow-up query
    const contextualUserMessage = enrichWithSessionContext(userMessage, {
      lastFilters: sessionData.last_filters,
      lastResults: sessionData.last_results,
    });

    // Build message array: system prompt + full user history + new user message
    const historyForAI = chatSessionService.buildMessagesForAI(
      sessionData.messages,
    );
    const messages = [
      { role: "system", content: systemPrompt },
      ...historyForAI,
      { role: "user", content: contextualUserMessage },
    ];

    const response = await askModel(messages);
    const detectedRange = detectDateRange(userMessage);

    if (detectedRange && !isAttemptsQuery(userMessage)) {
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

      const rangePayload = humanizePayload(
        formattedResponse,
        "getCasesByDateRange",
        userLang,
      );

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
      let functionResult;

      switch (functionName) {
        case "getCaseByDate":
          functionResult = await metrics.sf.getCaseByDate(
            args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
          );
          break;

        case "getCaseByNumber":
          functionResult = await metrics.sf.getCaseByNumber(args.caseNumber);
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

        case "getCasesByTypeFromReport":
          functionResult = await metrics.dashboard.getCasesByTypeFromReport(
            args.type,
          );
          break;

        default:
          throw new Error("UNKNOWN_FUNCTION");
      }

      sessionCache[cacheKey].last_results = functionResult;

      const formattedResponse = await formatResult(
        functionName,
        functionResult,
        userLang,
      );
      const finalPayload = humanizePayload(
        formattedResponse,
        functionName,
        userLang,
      );

      // ─── Persistir conversación en BD de forma asíncrona (no bloquea respuesta) ──
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
    output += `${i + 1}. **${caseItem.CaseNumber}** | ${caseItem.Substatus__c} | ${caseItem.Owner?.Name || "Unassigned"}\n`;
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
