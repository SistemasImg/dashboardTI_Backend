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
const runtimePendingApprovals = {};

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
  const caseMatch = /\b(0*\d{5,8})\b/.exec(text);
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

function detectWomensPrisonerAbuseT1SendIntent(message) {
  const text = String(message || "").toLowerCase();

  const mentionsSend =
    text.includes("envi") ||
    text.includes("manda") ||
    text.includes("send") ||
    text.includes("submit");

  const mentionsWpaT1 =
    text.includes("womens prisoner abuse") ||
    text.includes("women's prisoner abuse") ||
    text.includes("wpa t1") ||
    text.includes("pulaski t1") ||
    text.includes("womens detention center") ||
    (text.includes("prisoner abuse") && text.includes("t1"));

  if (!mentionsSend || !mentionsWpaT1) return null;

  const caseMatch = /\b(0*\d{5,8})\b/.exec(text);
  if (!caseMatch) return null;

  return { caseNumber: caseMatch[1] };
}

function detectDepoProveraT8SendIntent(message) {
  const text = String(message || "").toLowerCase();

  const mentionsSend =
    text.includes("envi") ||
    text.includes("manda") ||
    text.includes("send") ||
    text.includes("submit");

  const mentionsDepoT8 =
    text.includes("depo") ||
    text.includes("provera") ||
    text.includes("depo provera") ||
    text.includes("t8") ||
    text.includes("tier 8") ||
    text.includes("tier8");

  if (!mentionsSend || !mentionsDepoT8) return null;

  const caseMatch = /\b(0*\d{5,8})\b/.exec(text);
  if (!caseMatch) return null;

  return { caseNumber: caseMatch[1] };
}

function detectAdReachRideshareSendIntent(message) {
  const text = String(message || "").toLowerCase();

  const mentionsSend =
    text.includes("envi") ||
    text.includes("manda") ||
    text.includes("send") ||
    text.includes("submit");

  const mentionsAdReach =
    text.includes("adreach") ||
    text.includes("ad reach") ||
    text.includes("rideshare t12") ||
    text.includes("rideshare t13") ||
    text.includes("rideshare t14") ||
    text.includes("tier 12") ||
    text.includes("tier 13") ||
    text.includes("tier 14") ||
    text.includes("t12") ||
    text.includes("t13") ||
    text.includes("t14");

  if (!mentionsSend || !mentionsAdReach) return null;

  const caseMatch = /\b(0*\d{5,8})\b/.exec(text);
  const tierMatch = /\b(?:t|tier\s*)?(12|13|14)\b/.exec(text);
  if (!caseMatch || !tierMatch?.[1]) return null;

  return { caseNumber: caseMatch[1], tier: tierMatch[1] };
}

function getPendingBardT2Approval(sessionData) {
  return sessionData?.last_filters?.pendingBardPortT2 || null;
}

function getSessionLastFilters(sessionData) {
  const lastFilters = sessionData?.last_filters;
  return lastFilters && typeof lastFilters === "object" ? lastFilters : {};
}

function getSalesforceSavedText(value, lang) {
  if (typeof value !== "boolean") {
    return "N/A";
  }

  return value ? i18n(lang, "si", "yes") : i18n(lang, "no", "no");
}

function buildApiSuccessMessage(caseNumber, lang, detailLines) {
  const sentMessage = i18n(
    lang,
    `Listo, envié correctamente el API del caso ${caseNumber}.`,
    `Done, I sent the API successfully for case ${caseNumber}.`,
  );

  return [sentMessage, "", ...detailLines].join("\n");
}

function getAgentViewSummaryLine(data, lang) {
  if (!data.includeAgentDetails) {
    return "";
  }

  const viewText = data.agentDetailsAvailable
    ? i18n(lang, "si", "yes")
    : i18n(
        lang,
        "no disponible para historial agregado",
        "not available for aggregated history",
      );

  return `• **${i18n(lang, "Vista por agente", "Agent view")}:** ${viewText}\n`;
}

function getHourlyFallbackText(row, lang) {
  const esText = row.ambiguousPhone
    ? "telefono ambiguo entre varios casos"
    : "sin detalle por hora";
  const enText = row.ambiguousPhone
    ? "ambiguous phone across multiple cases"
    : "no hourly detail";

  return i18n(lang, esText, enText);
}

function setPendingBardT2Approval(sessionData, cacheKey, pendingData) {
  sessionData.last_filters = {
    ...getSessionLastFilters(sessionData),
    pendingBardPortT2: pendingData,
  };
  sessionCache[cacheKey].last_filters = sessionData.last_filters;
}

function clearPendingBardT2Approval(sessionData, cacheKey) {
  if (!sessionData?.last_filters?.pendingBardPortT2) return;

  const { pendingBardPortT2, ...rest } = sessionData.last_filters;
  sessionData.last_filters = rest;
  sessionCache[cacheKey].last_filters = sessionData.last_filters;
}

function detectBardT2ApprovalIntent(message) {
  const text = String(message || "").toLowerCase();
  return (
    /\b(confirmar|confirmo|ok|dale|procede|enviar|envia|send|approve|approved|esta bien|está bien)\b/i.test(
      text,
    ) &&
    !/\b(cambiar|modificar|editar|corregir|corrige|update|field|campo)\b/i.test(
      text,
    )
  );
}

function detectBardT2CancelIntent(message) {
  return /\b(cancelar|cancel|anular|detener|descartar|no enviar)\b/i.test(
    String(message || "").toLowerCase(),
  );
}

function parseBardT2EditIntent(message) {
  const text = String(message || "").trim();

  const equalsMatch =
    /(?:editar|corregir|corrige|cambiar|modificar|actualizar)?\s*(?:t2\s*)?(?:campo\s*)?([a-z_]+)\s*[:=]\s*(.+)$/i.exec(
      text,
    );
  if (equalsMatch) {
    return {
      field: equalsMatch[1].trim(),
      value: equalsMatch[2].trim().replace(/^['"]|['"]$/g, ""),
    };
  }

  const naturalMatch =
    /(?:editar|corregir|corrige|cambiar|modificar|actualizar)\s+(?:el\s+)?(?:campo\s+)?([a-z_]+)\s+(?:a|por)\s+(.+)$/i.exec(
      text,
    );
  if (naturalMatch) {
    return {
      field: naturalMatch[1].trim(),
      value: naturalMatch[2].trim().replace(/^['"]|['"]$/g, ""),
    };
  }

  return null;
}

function formatBardT2ApprovalPreviewMessage(prepared, lang = "en") {
  const prettyPayload = JSON.stringify(prepared.payload || {}, null, 2);
  return `${i18n(
    lang,
    `Esta es la estructura que se enviará al cliente para el case ${prepared.caseNumber}:`,
    `This is the structure that will be sent to the client for case ${prepared.caseNumber}:`,
  )}\n\n\`\`\`json\n${prettyPayload}\n\`\`\``;
}

function setRuntimePendingApproval(cacheKey, data) {
  runtimePendingApprovals[cacheKey] = data;
}

function getRuntimePendingApproval(cacheKey) {
  return runtimePendingApprovals[cacheKey] || null;
}

function clearRuntimePendingApproval(cacheKey) {
  delete runtimePendingApprovals[cacheKey];
}

function formatApiApprovalPreviewMessage(data, lang = "en") {
  const prettyPayload = JSON.stringify(data.payload || {}, null, 2);
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const attachmentLine =
    attachments.length > 0
      ? `\n\n${i18n(lang, "Adjuntos", "Attachments")}: ${attachments.length}`
      : "";

  return `${i18n(
    lang,
    `Esta es la estructura que se enviará al cliente para el case ${data.caseNumber}:`,
    `This is the structure that will be sent to the client for case ${data.caseNumber}:`,
  )}\n\n\`\`\`json\n${prettyPayload}\n\`\`\`${attachmentLine}`;
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

  const mentionsCaseWord = text.includes("caso") || text.includes("cases");
  const mentionsDateScope =
    text.includes("hoy") ||
    text.includes("today") ||
    text.includes("ayer") ||
    text.includes("yesterday") ||
    /\b20\d{2}-\d{2}-\d{2}\b/.test(text);

  const mentionsCaseIngress =
    text.includes("ingres") ||
    text.includes("entr") ||
    text.includes("created") ||
    text.includes("entered");

  const hasCaseDateIntent =
    mentionsCaseScope ||
    (mentionsCaseWord && mentionsDateScope && mentionsCaseIngress);

  if (!mentionsAttempts || !hasCaseDateIntent) {
    return null;
  }

  const withoutAttempts = [
    /\bsin\s+attempts?\b/i,
    /\bsin\s+intentos?\b/i,
    /\bsin\s+llamadas(?:\s+registradas)?\b/i,
    /\bwithout\s+attempts?\b/i,
    /\bno\s+attempts?\b/i,
    /\bzero\s+attempts?\b/i,
  ].some((pattern) => pattern.test(text));

  if (text.includes("hoy") || text.includes("today")) {
    return { dateKeyword: "today", withoutAttempts };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return { dateKeyword: "yesterday", withoutAttempts };
  }

  const isoDateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (isoDateMatch) {
    return { date: isoDateMatch[1], withoutAttempts };
  }

  return null;
}

function detectScheduledCallbacksIntent(message) {
  const text = String(message || "").toLowerCase();
  const mentionsCallback =
    text.includes("callback") || text.includes("callbacks");

  if (!mentionsCallback) {
    return null;
  }

  // If user explicitly asks for cases callback, keep existing case-substatus flow.
  if (text.includes("casos") || text.includes("cases")) {
    return null;
  }

  const mentionsSchedule =
    text.includes("program") ||
    text.includes("agend") ||
    text.includes("calendar") ||
    text.includes("calendario");

  if (
    !mentionsSchedule &&
    !/(hoy|today|ayer|yesterday|manana|mañana|tomorrow|20\d{2}-\d{2}-\d{2})/.test(
      text,
    )
  ) {
    return null;
  }

  if (text.includes("hoy") || text.includes("today")) {
    return { dateKeyword: "today" };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return { dateKeyword: "yesterday" };
  }

  if (
    text.includes("manana") ||
    text.includes("mañana") ||
    text.includes("tomorrow")
  ) {
    return { dateKeyword: "tomorrow" };
  }

  const isoDateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (isoDateMatch) {
    return { date: isoDateMatch[1] };
  }

  return { dateKeyword: "today" };
}

function detectSentCasesByAgentRankingIntent(message) {
  const text = String(message || "").toLowerCase();
  const mentionsSent = text.includes("sent");
  const mentionsAgent =
    text.includes("agente") ||
    text.includes("agents") ||
    text.includes("agent") ||
    text.includes("owner") ||
    text.includes("intaker") ||
    text.includes("intake") ||
    text.includes("bpo");

  if (!mentionsSent || !mentionsAgent) {
    return null;
  }

  const mentionsLowest =
    text.includes("menos") ||
    text.includes("lowest") ||
    text.includes("least") ||
    text.includes("menor");

  const mentionsLastWeek =
    text.includes("ultima semana") ||
    text.includes("última semana") ||
    text.includes("last week") ||
    text.includes("last_week");

  if (mentionsLastWeek) {
    return {
      sort: mentionsLowest ? "lowest" : "highest",
      dateKeyword: "last_week",
    };
  }

  if (text.includes("hoy") || text.includes("today")) {
    return {
      sort: mentionsLowest ? "lowest" : "highest",
      dateKeyword: "today",
    };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return {
      sort: mentionsLowest ? "lowest" : "highest",
      dateKeyword: "yesterday",
    };
  }

  const isoDateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (isoDateMatch) {
    return {
      sort: mentionsLowest ? "lowest" : "highest",
      date: isoDateMatch[1],
    };
  }

  return {
    sort: mentionsLowest ? "lowest" : "highest",
    dateKeyword: "today",
  };
}

function detectFakeLeadDQByVendorIntent(message) {
  const text = String(message || "").toLowerCase();
  const mentionsFakeLead =
    text.includes("fake lead") ||
    (text.includes("fake") && text.includes("lead"));
  const mentionsDQ =
    text.includes("dq") ||
    text.includes("disqual") ||
    text.includes("descalific");
  const mentionsVendor =
    text.includes("vendor") ||
    text.includes("owner") ||
    text.includes("case owner") ||
    text.includes("proveedor");

  if (!mentionsFakeLead || (!mentionsDQ && !mentionsVendor)) {
    return null;
  }

  if (
    text.includes("ultima semana") ||
    text.includes("última semana") ||
    text.includes("last week") ||
    text.includes("last_week")
  ) {
    return { dateKeyword: "last_week" };
  }

  if (text.includes("hoy") || text.includes("today")) {
    return { dateKeyword: "today" };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return { dateKeyword: "yesterday" };
  }

  const isoDateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (isoDateMatch) {
    return { date: isoDateMatch[1] };
  }

  return { dateKeyword: "today" };
}

function detectCasesStillInCallbackIntent(message) {
  const text = String(message || "").toLowerCase();
  const mentionsCallback =
    text.includes("callback") ||
    text.includes("callbacks") ||
    text.includes("cb");
  const mentionsCases = text.includes("casos") || text.includes("cases");
  const mentionsStillInCallback =
    text.includes("siguen") ||
    text.includes("still") ||
    text.includes("continuan") ||
    text.includes("continúan") ||
    text.includes("en callback") ||
    text.includes("en cb") ||
    text.includes("in callback") ||
    text.includes("in cb");

  if (!mentionsCallback || (!mentionsCases && !mentionsStillInCallback)) {
    return null;
  }

  if (
    text.includes("ultimos 30 dias") ||
    text.includes("últimos 30 días") ||
    text.includes("last 30 days") ||
    text.includes("last_30_days")
  ) {
    return { dateKeyword: "last_30_days" };
  }

  if (
    text.includes("ultimos 7 dias") ||
    text.includes("últimos 7 días") ||
    text.includes("last 7 days") ||
    text.includes("last_7_days")
  ) {
    return { dateKeyword: "last_7_days" };
  }

  if (
    text.includes("ultima semana") ||
    text.includes("última semana") ||
    text.includes("last week") ||
    text.includes("last_week")
  ) {
    return { dateKeyword: "last_week" };
  }

  if (
    text.includes("ultimo mes") ||
    text.includes("último mes") ||
    text.includes("last month") ||
    text.includes("last_month")
  ) {
    return { dateKeyword: "last_month" };
  }

  if (text.includes("hoy") || text.includes("today")) {
    return { dateKeyword: "today" };
  }

  if (text.includes("ayer") || text.includes("yesterday")) {
    return { dateKeyword: "yesterday" };
  }

  const isoDateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (isoDateMatch) {
    return { date: isoDateMatch[1] };
  }

  return { dateKeyword: "today" };
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
    [/\bcb\b/gi, "callback"],
    [/\bestatus\b/gi, "status"],
    [/\bquelity\b/gi, "quality"],
    [/\bhigh\s*quelity\b/gi, "high quality"],
    [/\bmedio\b/gi, "medium"],
    [/\bbajo\b/gi, "low quality"],
    [/\bfirmad[oa]s?\b/gi, "signed"],
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

function persistAssistantReply({
  cacheKey,
  userId,
  userMessage,
  assistantMessage,
  result,
  filters,
}) {
  chatSessionService
    .appendMessages(
      userId,
      [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage || "" },
      ],
      filters === undefined ? sessionCache[cacheKey].last_filters : filters,
      result,
    )
    .catch((err) =>
      logger.error(`[ChatSession] Failed to persist messages: ${err.message}`),
    );
}

function updateSessionLastFilters(sessionData, cacheKey, updates) {
  sessionData.last_filters = {
    ...getSessionLastFilters(sessionData),
    ...updates,
  };
  sessionCache[cacheKey].last_filters = sessionData.last_filters;
}

function buildApprovalResult(prepared, extra = {}) {
  if (!prepared.found || !prepared.ready) {
    return {
      sent: false,
      ...prepared,
    };
  }

  return {
    sent: false,
    approvalRequired: true,
    found: true,
    ready: true,
    caseNumber: prepared.caseNumber,
    payload: prepared.payload,
    ...extra,
  };
}

function buildChatRequestMessages(
  systemPromptValue,
  sessionData,
  userContent,
  requestAttachments,
) {
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
              )}. If user asks to send T9, JDC T3, or Women's Prisoner Abuse T1 API, treat attachments as provided in this request.`,
          },
        ]
      : [
          {
            role: "system",
            content:
              "IMPORTANT: No files were attached to this request. " +
              "If the user asks to send a T9 Rideshare, JDC T3, or Women's Prisoner Abuse T1 payload (any variant: enviar API, envíame el API, send API, PI, etc.), " +
              "you MUST call the sendT9RidesharePayload, sendJdcT3Payload, or sendWomensPrisonerAbuseT1Payload function with the provided case number — do NOT generate a text response, " +
              "do NOT simulate success, do NOT invent HTTP codes, do NOT invent Lead IDs. " +
              "The function itself will detect missing files and return the appropriate error. " +
              "Never fabricate a successful delivery response under any circumstances.",
          },
        ];

  return [
    { role: "system", content: systemPromptValue },
    ...uploadContextMessages,
    ...historyForAI,
    { role: "user", content: userContent },
  ];
}

async function handlePendingBardT2Turn(context) {
  const {
    cacheKey,
    normalizedUserMessage,
    sessionData,
    userId,
    userLang,
    userMessage,
  } = context;
  const pendingBardT2 = getPendingBardT2Approval(sessionData);
  if (!pendingBardT2) {
    return null;
  }

  if (detectBardT2CancelIntent(normalizedUserMessage)) {
    clearPendingBardT2Approval(sessionData, cacheKey);
    const cancelMessage = i18n(
      userLang,
      `Se canceló el envío pendiente de Bard Port T2 para el case ${pendingBardT2.caseNumber}.`,
      `Pending Bard Port T2 delivery for case ${pendingBardT2.caseNumber} was canceled.`,
    );
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: cancelMessage,
      result: {
        status: "bard_t2_canceled",
        caseNumber: pendingBardT2.caseNumber,
      },
    });
    return { message: cancelMessage };
  }

  const editIntent = parseBardT2EditIntent(normalizedUserMessage);
  if (editIntent) {
    const revised =
      await apiIntegrations.bardPortT2.reviseBardPortT2PayloadField({
        caseNumber: pendingBardT2.caseNumber,
        field: editIntent.field,
        value: editIntent.value,
        tort: pendingBardT2.tort,
        tier: pendingBardT2.tier,
      });

    let revisedMessage;
    if (!revised.found) {
      revisedMessage = i18n(
        userLang,
        `No encontré el case ${pendingBardT2.caseNumber} para actualizar el campo solicitado.`,
        `I couldn't find case ${pendingBardT2.caseNumber} to update the requested field.`,
      );
      clearPendingBardT2Approval(sessionData, cacheKey);
    } else if (!revised.updated) {
      const allowed = (revised.allowedFields || []).join(", ");
      revisedMessage = i18n(
        userLang,
        `El campo indicado no se puede editar para T2. Campos permitidos: ${allowed}.`,
        `That field cannot be edited for T2. Allowed fields: ${allowed}.`,
      );
    } else if (revised.ready) {
      setPendingBardT2Approval(sessionData, cacheKey, {
        caseNumber: revised.caseNumber,
        tort: revised.tort,
        tier: revised.tier,
        payload: revised.payload,
      });

      revisedMessage = `${i18n(
        userLang,
        `Campo ${revised.field} actualizado en Salesforce. Este es el nuevo JSON para validar antes del envío:`,
        `Field ${revised.field} was updated in Salesforce. This is the updated JSON to validate before sending:`,
      )}\n\n\`\`\`json\n${JSON.stringify(revised.payload || {}, null, 2)}\n\`\`\``;
    } else {
      const fields = (revised.missingFields || []).join(", ");
      revisedMessage = i18n(
        userLang,
        `El campo ${revised.field} se actualizó en Salesforce, pero el payload aún está incompleto. Faltan: ${fields}.`,
        `Field ${revised.field} was updated in Salesforce, but the payload is still incomplete. Missing: ${fields}.`,
      );
    }

    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: revisedMessage,
      result: revised,
    });
    return { message: revisedMessage };
  }

  if (detectBardT2ApprovalIntent(normalizedUserMessage)) {
    const sendResult = await apiIntegrations.bardPortT2.sendBardPortT2Payload({
      caseNumber: pendingBardT2.caseNumber,
      tort: pendingBardT2.tort,
      tier: pendingBardT2.tier,
    });
    clearPendingBardT2Approval(sessionData, cacheKey);
    const sentMessage = formatSendBardPortT2PayloadResult(
      sendResult,
      userLang,
    ).message;
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: sentMessage,
      result: sendResult,
    });
    return { message: sentMessage };
  }

  const pendingReminder = i18n(
    userLang,
    `Tienes un envío T2 pendiente para el case ${pendingBardT2.caseNumber}.`,
    `You have a pending T2 delivery for case ${pendingBardT2.caseNumber}.`,
  );
  persistAssistantReply({
    cacheKey,
    userId,
    userMessage,
    assistantMessage: pendingReminder,
    result: { status: "bard_t2_pending", caseNumber: pendingBardT2.caseNumber },
  });
  return { message: pendingReminder };
}

async function revisePendingRuntimePayload(pendingRuntime, editIntent) {
  if (pendingRuntime.kind === "t9") {
    return apiIntegrations.t9Rideshare.reviseT9RidesharePayloadField({
      caseNumber: pendingRuntime.caseNumber,
      tort: pendingRuntime.tort,
      tier: pendingRuntime.tier,
      attachments: pendingRuntime.attachments || [],
      field: editIntent.field,
      value: editIntent.value,
    });
  }
  if (pendingRuntime.kind === "jdc_t3") {
    return apiIntegrations.jdcT3.reviseJdcT3PayloadField({
      caseNumber: pendingRuntime.caseNumber,
      attachments: pendingRuntime.attachments || [],
      field: editIntent.field,
      value: editIntent.value,
    });
  }
  if (pendingRuntime.kind === "wpa_t1") {
    return apiIntegrations.womensPrisonerAbuseT1.reviseWomensPrisonerAbuseT1PayloadField(
      {
        caseNumber: pendingRuntime.caseNumber,
        attachments: pendingRuntime.attachments || [],
        field: editIntent.field,
        value: editIntent.value,
      },
    );
  }
  if (pendingRuntime.kind === "depo_t8") {
    return apiIntegrations.depoProveraT8.reviseDepoProveraT8PayloadField({
      caseNumber: pendingRuntime.caseNumber,
      tort: pendingRuntime.tort,
      tier: pendingRuntime.tier,
      field: editIntent.field,
      value: editIntent.value,
    });
  }
  if (pendingRuntime.kind === "adreach_rideshare") {
    return apiIntegrations.adReachRideshare.reviseAdReachRidesharePayloadField({
      caseNumber: pendingRuntime.caseNumber,
      tier: pendingRuntime.tier,
      field: editIntent.field,
      value: editIntent.value,
    });
  }
  return apiIntegrations.a4dRideshareT11.reviseA4DRideshareT11PayloadField({
    caseNumber: pendingRuntime.caseNumber,
    field: editIntent.field,
    value: editIntent.value,
  });
}

async function sendPendingRuntimePayload(pendingRuntime) {
  if (pendingRuntime.kind === "t9") {
    return apiIntegrations.t9Rideshare.sendT9RidesharePayload({
      caseNumber: pendingRuntime.caseNumber,
      tort: pendingRuntime.tort,
      tier: pendingRuntime.tier,
      attachments: pendingRuntime.attachments || [],
    });
  }
  if (pendingRuntime.kind === "jdc_t3") {
    return apiIntegrations.jdcT3.sendJdcT3Payload({
      caseNumber: pendingRuntime.caseNumber,
      attachments: pendingRuntime.attachments || [],
    });
  }
  if (pendingRuntime.kind === "wpa_t1") {
    return apiIntegrations.womensPrisonerAbuseT1.sendWomensPrisonerAbuseT1Payload(
      {
        caseNumber: pendingRuntime.caseNumber,
        attachments: pendingRuntime.attachments || [],
      },
    );
  }
  if (pendingRuntime.kind === "depo_t8") {
    return apiIntegrations.depoProveraT8.sendDepoProveraT8Payload({
      caseNumber: pendingRuntime.caseNumber,
      tort: pendingRuntime.tort,
      tier: pendingRuntime.tier,
    });
  }
  if (pendingRuntime.kind === "adreach_rideshare") {
    return apiIntegrations.adReachRideshare.sendAdReachRidesharePayload({
      caseNumber: pendingRuntime.caseNumber,
      tier: pendingRuntime.tier,
    });
  }
  return apiIntegrations.a4dRideshareT11.sendA4DRideshareT11Payload({
    caseNumber: pendingRuntime.caseNumber,
  });
}

function formatPendingRuntimeSentMessage(pendingRuntime, sendResult, userLang) {
  if (pendingRuntime.kind === "t9") {
    return formatSendT9RidesharePayloadResult(sendResult, userLang).message;
  }
  if (pendingRuntime.kind === "jdc_t3") {
    return formatSendJdcT3PayloadResult(sendResult, userLang).message;
  }
  if (pendingRuntime.kind === "wpa_t1") {
    return formatSendWomensPrisonerAbuseT1PayloadResult(sendResult, userLang)
      .message;
  }
  if (pendingRuntime.kind === "depo_t8") {
    return formatSendDepoProveraT8PayloadResult(sendResult, userLang).message;
  }
  if (pendingRuntime.kind === "adreach_rideshare") {
    return formatSendAdReachRidesharePayloadResult(sendResult, userLang)
      .message;
  }
  return formatSendA4DRideshareT11PayloadResult(sendResult, userLang).message;
}

async function handlePendingRuntimeTurn(context) {
  const {
    cacheKey,
    normalizedUserMessage,
    requestAttachments,
    userId,
    userLang,
    userMessage,
  } = context;
  const pendingRuntime = getRuntimePendingApproval(cacheKey);
  if (!pendingRuntime) {
    return null;
  }

  if (requestAttachments.length > 0) {
    pendingRuntime.attachments = requestAttachments;
    setRuntimePendingApproval(cacheKey, pendingRuntime);
  }

  if (detectBardT2CancelIntent(normalizedUserMessage)) {
    clearRuntimePendingApproval(cacheKey);
    const cancelMessage = i18n(
      userLang,
      `Se canceló el envío pendiente de ${pendingRuntime.apiLabel} para el case ${pendingRuntime.caseNumber}.`,
      `Pending ${pendingRuntime.apiLabel} delivery for case ${pendingRuntime.caseNumber} was canceled.`,
    );
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: cancelMessage,
      result: {
        status: `${pendingRuntime.kind}_canceled`,
        caseNumber: pendingRuntime.caseNumber,
      },
    });
    return { message: cancelMessage };
  }

  const editIntent = parseBardT2EditIntent(normalizedUserMessage);
  if (editIntent) {
    const revised = await revisePendingRuntimePayload(
      pendingRuntime,
      editIntent,
    );
    let revisedMessage;
    if (!revised.found) {
      revisedMessage = i18n(
        userLang,
        `No encontré el case ${pendingRuntime.caseNumber} para actualizar el campo solicitado.`,
        `I couldn't find case ${pendingRuntime.caseNumber} to update the requested field.`,
      );
      clearRuntimePendingApproval(cacheKey);
    } else if (!revised.updated) {
      const allowed = (revised.allowedFields || []).join(", ");
      revisedMessage = i18n(
        userLang,
        `El campo indicado no se puede editar para ${pendingRuntime.apiLabel}. Campos permitidos: ${allowed}.`,
        `That field cannot be edited for ${pendingRuntime.apiLabel}. Allowed fields: ${allowed}.`,
      );
    } else if (revised.ready) {
      const updatedPending = { ...pendingRuntime, payload: revised.payload };
      setRuntimePendingApproval(cacheKey, updatedPending);
      revisedMessage = formatApiApprovalPreviewMessage(
        { ...updatedPending, caseNumber: revised.caseNumber },
        userLang,
      );
    } else {
      const fields = (revised.missingFields || []).join(", ");
      revisedMessage = i18n(
        userLang,
        `El campo ${revised.field} se actualizó en Salesforce, pero el payload aún está incompleto. Faltan: ${fields}.`,
        `Field ${revised.field} was updated in Salesforce, but the payload is still incomplete. Missing: ${fields}.`,
      );
    }

    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: revisedMessage,
      result: revised,
    });
    return { message: revisedMessage };
  }

  if (detectBardT2ApprovalIntent(normalizedUserMessage)) {
    const sendResult = await sendPendingRuntimePayload(pendingRuntime);
    if (sendResult?.attachmentsRequired) {
      const waitFilesMessage = i18n(
        userLang,
        `Faltan documentos para completar el envío de ${pendingRuntime.apiLabel} del case ${pendingRuntime.caseNumber}.`,
        `Files are still required to complete ${pendingRuntime.apiLabel} delivery for case ${pendingRuntime.caseNumber}.`,
      );
      persistAssistantReply({
        cacheKey,
        userId,
        userMessage,
        assistantMessage: waitFilesMessage,
        result: sendResult,
      });
      return { message: waitFilesMessage };
    }

    clearRuntimePendingApproval(cacheKey);
    const sentMessage = formatPendingRuntimeSentMessage(
      pendingRuntime,
      sendResult,
      userLang,
    );
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: sentMessage,
      result: sendResult,
    });
    return { message: sentMessage };
  }

  const pendingReminder = i18n(
    userLang,
    `Tienes un envío ${pendingRuntime.apiLabel} pendiente para el case ${pendingRuntime.caseNumber}.`,
    `You have a pending ${pendingRuntime.apiLabel} delivery for case ${pendingRuntime.caseNumber}.`,
  );
  persistAssistantReply({
    cacheKey,
    userId,
    userMessage,
    assistantMessage: pendingReminder,
    result: {
      status: `${pendingRuntime.kind}_pending`,
      caseNumber: pendingRuntime.caseNumber,
    },
  });
  return { message: pendingReminder };
}

async function handleDirectIntentTurn(context) {
  const {
    cacheKey,
    normalizedUserMessage,
    sessionData,
    userId,
    userLang,
    userMessage,
  } = context;
  const directIntents = [
    {
      intent: detectCaseAttemptsByDateIntent(normalizedUserMessage),
      getName: (intent) =>
        intent.withoutAttempts
          ? "getCasesWithoutAttemptsByDate"
          : "getCaseAttemptsByDate",
      execute: (intent) =>
        intent.withoutAttempts
          ? metrics.sql.getCasesWithoutAttemptsByDate(intent)
          : metrics.sql.getCaseAttemptsByDate(intent),
    },
    {
      intent: detectScheduledCallbacksIntent(normalizedUserMessage),
      getName: () => "getScheduledCallbacks",
      execute: (intent) => metrics.sf.getScheduledCallbacks(intent),
    },
    {
      intent: detectSentCasesByAgentRankingIntent(normalizedUserMessage),
      getName: () => "getSentCasesByAgentRanking",
      execute: (intent) => metrics.sf.getSentCasesByAgentRanking(intent),
    },
    {
      intent: detectFakeLeadDQByVendorIntent(normalizedUserMessage),
      getName: () => "getFakeLeadDQByVendorRanking",
      execute: (intent) => metrics.sf.getFakeLeadDQByVendorRanking(intent),
    },
    {
      intent: detectCasesStillInCallbackIntent(normalizedUserMessage),
      getName: () => "getCasesStillInCallback",
      execute: (intent) => metrics.sf.getCasesStillInCallback(intent),
    },
  ];

  const matched = directIntents.find((item) => item.intent);
  if (matched) {
    const functionName = matched.getName(matched.intent);
    const functionResult = await matched.execute(matched.intent);
    const formattedResponse = await formatResult(
      functionName,
      functionResult,
      userLang,
    );
    const directPayload = humanizePayload({
      ...formattedResponse,
      message: formattedResponse.message,
    });
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: directPayload.message || "",
      result: functionResult,
    });
    return directPayload;
  }

  const detectedRange = detectDateRange(normalizedUserMessage);
  if (!detectedRange || isAttemptsQuery(normalizedUserMessage)) {
    return null;
  }

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
    if (humanContent) {
      rangeMessage = humanContent;
    }
  } catch (humanErr) {
    logger.warn(
      `[Humanize] Fallback to structured response: ${humanErr.message}`,
    );
  }

  const rangePayload = humanizePayload({
    ...formattedResponse,
    message: rangeMessage,
  });
  persistAssistantReply({
    cacheKey,
    userId,
    userMessage,
    assistantMessage: rangePayload.message || "",
    result: functionResult,
    filters: null,
  });
  return rangePayload;
}

function getFunctionHandlers(context) {
  const {
    args,
    cacheKey,
    normalizedUserMessage,
    requestAttachments,
    sessionData,
  } = context;

  return {
    prepareBardPortT2Payload: async () => {
      const result = await apiIntegrations.bardPortT2.prepareBardPortT2Payload({
        caseNumber: args.caseNumber,
        tort: args.tort,
        tier: args.tier,
      });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: args.tort,
        });
      }
      return result;
    },
    sendBardPortT2Payload: async () => {
      const bardTort = args.tort || "Bard Port";
      const bardTier = args.tier || "T2";
      const prepared =
        await apiIntegrations.bardPortT2.prepareBardPortT2Payload({
          caseNumber: args.caseNumber,
          tort: bardTort,
          tier: bardTier,
        });
      if (prepared.found && prepared.ready) {
        setPendingBardT2Approval(sessionData, cacheKey, {
          caseNumber: prepared.caseNumber,
          tort: bardTort,
          tier: bardTier,
          payload: prepared.payload,
        });
      }
      return buildApprovalResult(prepared, { tort: bardTort, tier: bardTier });
    },
    getCaseByDate: () =>
      metrics.sf.getCaseByDate(
        args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
      ),
    getCaseByNumber: async () => {
      args.caseNumber = normalizeCaseNumber(args.caseNumber);
      const result = await metrics.sf.getCaseByNumber(args.caseNumber);
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
        });
      }
      return result;
    },
    getCaseByPhone: () => metrics.sf.getCaseByPhone(args.phone),
    getCasesByStatus: () =>
      metrics.sf.getCasesByStatus(args.status, args.dateKeyword, args.date),
    getCasesByDateRange: () =>
      metrics.sf.getCasesByDateRange(args.startDate, args.endDate),
    getCaseByEmail: () => metrics.sf.getCaseByEmail(args.email),
    getCasesByOrigin: () =>
      metrics.sf.getCasesByOrigin(args.origin, args.dateKeyword, args.date),
    getCasesBySupplierSegment: () =>
      metrics.sf.getCasesBySupplierSegment(
        args.segment,
        args.dateKeyword,
        args.date,
      ),
    getCasesBySubstatus: () =>
      metrics.sf.getCasesBySubstatus(
        args.substatus,
        args.dateKeyword,
        args.date,
      ),
    getScheduledCallbacks: () =>
      metrics.sf.getScheduledCallbacks({
        dateKeyword: args.dateKeyword,
        date: args.date,
      }),
    getSentCasesByAgentRanking: () =>
      metrics.sf.getSentCasesByAgentRanking({
        sort: args.sort,
        dateKeyword: args.dateKeyword,
        date: args.date,
        period: args.period,
        limit: args.limit,
      }),
    getFakeLeadDQByVendorRanking: () =>
      metrics.sf.getFakeLeadDQByVendorRanking({
        dateKeyword: args.dateKeyword,
        date: args.date,
        period: args.period,
        limit: args.limit,
      }),
    getCasesStillInCallback: () =>
      metrics.sf.getCasesStillInCallback({
        dateKeyword: args.dateKeyword,
        date: args.date,
        period: args.period,
      }),
    getCasesByType: () => {
      const typeValue =
        args.type?.toLowerCase() === "tort" ? "Tort" : args.type;
      return metrics.sf.getCasesByType(typeValue, args.dateKeyword, args.date);
    },
    getCasesByFilters: async () => {
      const result = await metrics.sf.getCasesByFilters(args);
      sessionData.last_filters = args;
      sessionCache[cacheKey].last_filters = args;
      return result;
    },
    getCasesGroupedByField: () =>
      metrics.sf.getCasesGroupedByField(args.field, args.dateKeyword),
    getOperationalSummary: () =>
      metrics.sf.getOperationalSummary(args.dateKeyword),
    getVendorsWithLeads: () =>
      metrics.sf.getVendorsWithLeads({
        dateKeyword: args.dateKeyword,
        period: args.period,
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
    getTopVendors: () =>
      metrics.sf.getTopVendors({
        limit: args.limit,
        sort: args.sort,
        dateKeyword: args.dateKeyword,
        period: args.period,
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
    getTopVendorsWithCaseDetails: () =>
      metrics.sf.getTopVendorsWithCaseDetails({
        limit: args.limit,
        sort: args.sort,
        dateKeyword: args.dateKeyword,
        period: args.period,
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
    getCaseDisqualificationReason: async () => {
      args.caseNumber =
        args.caseNumber ||
        sessionData.last_filters?.caseNumber ||
        extractLastReferencedCaseNumber(sessionData.messages);
      if (!args.caseNumber) {
        return { found: false, missingCaseNumber: true };
      }
      args.caseNumber = normalizeCaseNumber(args.caseNumber);
      const result = await metrics.sf.getCaseDisqualificationReason(
        args.caseNumber,
      );
      updateSessionLastFilters(sessionData, cacheKey, {
        caseNumber: args.caseNumber,
      });
      return result;
    },
    prepareT9RidesharePayload: async () => {
      const result =
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
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: args.tort,
        });
      }
      return result;
    },
    sendT9RidesharePayload: async () => {
      const t9Tort = args.tort || "Rideshare";
      const t9Tier = args.tier || "T9";
      const t9Attachments =
        requestAttachments.length > 0
          ? requestAttachments
          : args.attachments || [];
      const prepared =
        await apiIntegrations.t9Rideshare.prepareT9RidesharePayload({
          caseNumber: args.caseNumber,
          tort: t9Tort,
          tier: t9Tier,
          attachments: t9Attachments,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: args.tort,
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "t9",
          apiLabel: "T9",
          caseNumber: prepared.caseNumber,
          tort: t9Tort,
          tier: t9Tier,
          payload: prepared.payload,
          attachments: t9Attachments,
        });
      }
      return buildApprovalResult(prepared, {
        tort: t9Tort,
        tier: t9Tier,
        attachments: t9Attachments,
      });
    },
    prepareDepoProveraT8Payload: async () => {
      const depoTort = args.tort || "Depo Provera";
      const depoTier = args.tier || "T8";
      const result =
        await apiIntegrations.depoProveraT8.prepareDepoProveraT8Payload({
          caseNumber: args.caseNumber,
          tort: depoTort,
          tier: depoTier,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: depoTier,
          type: depoTort,
        });
      }
      return result;
    },
    sendDepoProveraT8Payload: async () => {
      const depoTort = args.tort || "Depo Provera";
      const depoTier = args.tier || "T8";
      const prepared =
        await apiIntegrations.depoProveraT8.prepareDepoProveraT8Payload({
          caseNumber: args.caseNumber,
          tort: depoTort,
          tier: depoTier,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: depoTier,
          type: depoTort,
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "depo_t8",
          apiLabel: "Depo Provera T8",
          caseNumber: prepared.caseNumber,
          tort: depoTort,
          tier: depoTier,
          payload: prepared.payload,
          attachments: [],
        });
      }
      return buildApprovalResult(prepared, {
        tort: depoTort,
        tier: depoTier,
        attachments: [],
      });
    },
    prepareAdReachRidesharePayload: async () => {
      const result =
        await apiIntegrations.adReachRideshare.prepareAdReachRidesharePayload({
          caseNumber: args.caseNumber,
          tier: args.tier,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: "Rideshare",
        });
      }
      return result;
    },
    prepareA4DRideshareT11Payload: async () => {
      const result =
        await apiIntegrations.a4dRideshareT11.prepareA4DRideshareT11Payload({
          caseNumber: args.caseNumber,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
        });
      }
      return result;
    },
    sendAdReachRidesharePayload: async () => {
      const prepared =
        await apiIntegrations.adReachRideshare.prepareAdReachRidesharePayload({
          caseNumber: args.caseNumber,
          tier: args.tier,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: args.tier,
          type: "Rideshare",
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "adreach_rideshare",
          apiLabel: `adReach Rideshare T${prepared.tier}`,
          caseNumber: prepared.caseNumber,
          tort: "Rideshare",
          tier: prepared.tier,
          payload: prepared.payload,
          attachments: [],
        });
      }
      return buildApprovalResult(prepared, {
        tort: "Rideshare",
        tier: prepared.tier,
        attachments: [],
      });
    },
    sendA4DRideshareT11Payload: async () => {
      const prepared =
        await apiIntegrations.a4dRideshareT11.prepareA4DRideshareT11Payload({
          caseNumber: args.caseNumber,
        });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "a4d_t11",
          apiLabel: "A4D T11",
          caseNumber: prepared.caseNumber,
          payload: prepared.payload,
          attachments: [],
        });
      }
      return buildApprovalResult(prepared, { attachments: [] });
    },
    prepareJdcT3Payload: async () => {
      const result = await apiIntegrations.jdcT3.prepareJdcT3Payload({
        caseNumber: args.caseNumber,
      });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
        });
      }
      return result;
    },
    sendJdcT3Payload: async () => {
      const jdcAttachments =
        requestAttachments.length > 0
          ? requestAttachments
          : args.attachments || [];
      const prepared = await apiIntegrations.jdcT3.prepareJdcT3Payload({
        caseNumber: args.caseNumber,
      });
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "jdc_t3",
          apiLabel: "JDC T3",
          caseNumber: prepared.caseNumber,
          payload: prepared.payload,
          attachments: jdcAttachments,
        });
      }
      return buildApprovalResult(prepared, { attachments: jdcAttachments });
    },
    prepareWomensPrisonerAbuseT1Payload: async () => {
      const result =
        await apiIntegrations.womensPrisonerAbuseT1.prepareWomensPrisonerAbuseT1Payload(
          {
            caseNumber: args.caseNumber,
          },
        );
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: "T1",
          type: "Women's Prisoner Abuse",
        });
      }
      return result;
    },
    sendWomensPrisonerAbuseT1Payload: async () => {
      const wpaAttachments =
        requestAttachments.length > 0
          ? requestAttachments
          : args.attachments || [];
      const prepared =
        await apiIntegrations.womensPrisonerAbuseT1.prepareWomensPrisonerAbuseT1Payload(
          {
            caseNumber: args.caseNumber,
          },
        );
      if (args.caseNumber) {
        updateSessionLastFilters(sessionData, cacheKey, {
          caseNumber: args.caseNumber,
          tier: "T1",
          type: "Women's Prisoner Abuse",
        });
      }
      if (prepared.found && prepared.ready) {
        setRuntimePendingApproval(cacheKey, {
          kind: "wpa_t1",
          apiLabel: "Women's Prisoner Abuse T1",
          caseNumber: prepared.caseNumber,
          payload: prepared.payload,
          attachments: wpaAttachments,
        });
      }
      return buildApprovalResult(prepared, { attachments: wpaAttachments });
    },
    getVendorsBySupplierSegment: () =>
      metrics.sf.getVendorsBySupplierSegment(args.segment, {
        dateKeyword: args.dateKeyword,
        period: args.period,
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
    getCasesByAgent: () => metrics.dashboard.getCasesByAgent(args.agentName),
    getCasesByCallCenter: () =>
      metrics.dashboard.getCasesByCallCenter(args.callCenter),
    getTotalAttemptsByAgent: () =>
      metrics.sql.getTotalAttemptsByAgent(args.agentName, {
        dateKeyword: args.dateKeyword,
        date: args.date,
      }),
    getAgentAttemptsByPhonePerHour: () =>
      metrics.sql.getAgentAttemptsByPhonePerHour(args.agentName, args.phone, {
        dateKeyword: args.dateKeyword,
        date: args.date,
      }),
    getVicidialAgentsStatus: () =>
      metrics.sql.getVicidialAgentsStatus({ agentName: args.agentName }),
    getAttemptsByPhone: () =>
      metrics.sql.getAttemptsByPhone(args.phone, {
        dateKeyword: args.dateKeyword,
        date: args.date,
        lastDays: args.lastDays,
      }),
    getAttemptsByCaseNumber: async () => {
      args.caseNumber =
        args.caseNumber ||
        sessionData.last_filters?.caseNumber ||
        extractLastReferencedCaseNumber(sessionData.messages);
      if (!args.caseNumber) {
        return { missingCaseNumber: true };
      }
      args.caseNumber = normalizeCaseNumber(args.caseNumber);
      const caseAttemptsFilters = {
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
      const result = await metrics.sql.getAttemptsByCaseNumber(
        args.caseNumber,
        caseAttemptsFilters,
      );
      updateSessionLastFilters(sessionData, cacheKey, {
        caseNumber: args.caseNumber,
      });
      return result;
    },
    getCaseAttemptsByDate: () =>
      metrics.sql.getCaseAttemptsByDate({
        dateKeyword: args.dateKeyword,
        date: args.date,
      }),
    getCasesWithoutAttemptsByDate: () =>
      metrics.sql.getCasesWithoutAttemptsByDate({
        dateKeyword: args.dateKeyword,
        date: args.date,
      }),
    getAssignedAgentByCaseNumber: async () => {
      args.caseNumber =
        args.caseNumber ||
        sessionData.last_filters?.caseNumber ||
        extractLastReferencedCaseNumber(sessionData.messages);
      if (!args.caseNumber) {
        return { found: false, missingCaseNumber: true };
      }
      args.caseNumber = normalizeCaseNumber(args.caseNumber);
      const result = await metrics.mysql.getAssignedAgentByCaseNumber(
        args.caseNumber,
      );
      updateSessionLastFilters(sessionData, cacheKey, {
        caseNumber: args.caseNumber,
      });
      return result;
    },
    getVendorLeadAttempts: () =>
      metrics.sql.getVendorLeadAttempts(args.vendorName, {
        includeAgentDetails: args.includeAgentDetails,
        dateKeyword: args.dateKeyword,
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
    getCasesByTypeFromReport: () =>
      metrics.dashboard.getCasesByTypeFromReport(args.type),
  };
}

function getDeterministicFunctionNames() {
  return new Set([
    "getAttemptsByCaseNumber",
    "getAttemptsByPhone",
    "getCaseAttemptsByDate",
    "getCasesWithoutAttemptsByDate",
    "getScheduledCallbacks",
    "getSentCasesByAgentRanking",
    "getFakeLeadDQByVendorRanking",
    "getCasesStillInCallback",
  ]);
}

function getApprovalFunctionNames() {
  return new Set([
    "sendBardPortT2Payload",
    "sendT9RidesharePayload",
    "sendAdReachRidesharePayload",
    "sendA4DRideshareT11Payload",
    "sendJdcT3Payload",
    "sendWomensPrisonerAbuseT1Payload",
    "sendDepoProveraT8Payload",
  ]);
}

function buildApiSentMessage(functionResult, userLang, includeHttp = true) {
  const sentMessage = i18n(
    userLang,
    `Listo, envié correctamente el API del caso ${functionResult.caseNumber}.`,
    `Done, I sent the API successfully for case ${functionResult.caseNumber}.`,
  );
  const lines = [
    includeHttp
      ? `${i18n(userLang, "HTTP", "HTTP")}: ${functionResult.statusCode || "N/A"}`
      : null,
    `${i18n(userLang, "Respuesta del cliente", "Client response")}: ${functionResult.clientResponse || "N/A"}`,
    `${i18n(userLang, "Guardado en Salesforce", "Saved in Salesforce")}: ${getSalesforceSavedText(functionResult.salesforceUpdated, userLang)}`,
  ].filter(Boolean);
  return `${sentMessage}\n\n${lines.join("\n")}`;
}

function getAttachmentRequiredMessages(userLang, functionResult) {
  return {
    sendT9RidesharePayload: i18n(
      userLang,
      `No se hizo el envío T9 del case ${functionResult.caseNumber} porque para este tier los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje y vuelve a pedir el envío.`,
      `T9 delivery was not started for case ${functionResult.caseNumber} because files are mandatory for this tier. Attach the required documents directly in the same message and request the submission again.`,
    ),
    sendJdcT3Payload: i18n(
      userLang,
      `No se hizo el envío JDC T3 del case ${functionResult.caseNumber} porque los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje y vuelve a pedir el envío.`,
      `JDC T3 delivery was not started for case ${functionResult.caseNumber} because files are mandatory. Attach the required documents directly in the same message and request the submission again.`,
    ),
    sendWomensPrisonerAbuseT1Payload: i18n(
      userLang,
      `No se hizo el envío Women's Prisoner Abuse T1 del case ${functionResult.caseNumber} porque los archivos son obligatorios. Adjunta los documentos directamente en el mismo mensaje y vuelve a pedir el envío.`,
      `Women's Prisoner Abuse T1 delivery was not started for case ${functionResult.caseNumber} because files are mandatory. Attach the required documents directly in the same message and request the submission again.`,
    ),
  };
}

function getSuccessfulApiMessage(functionName, functionResult, userLang) {
  const successBuilders = {
    sendT9RidesharePayload: () =>
      buildApiSentMessage(functionResult, userLang, false),
    sendJdcT3Payload: () => buildApiSentMessage(functionResult, userLang),
    sendWomensPrisonerAbuseT1Payload: () =>
      buildApiSentMessage(functionResult, userLang),
    sendBardPortT2Payload: () => buildApiSentMessage(functionResult, userLang),
    sendDepoProveraT8Payload: () =>
      buildApiSentMessage(functionResult, userLang),
    sendAdReachRidesharePayload: () =>
      buildApiSentMessage(functionResult, userLang),
    sendA4DRideshareT11Payload: () =>
      buildApiSentMessage(functionResult, userLang, false),
  };

  return successBuilders[functionName]?.() || null;
}

function finalizeFunctionResultMessage(
  functionName,
  functionResult,
  formattedResponse,
  userLang,
) {
  const deterministicFunctionNames = getDeterministicFunctionNames();
  const approvalFunctionNames = getApprovalFunctionNames();
  if (deterministicFunctionNames.has(functionName)) {
    return formattedResponse.message;
  }

  if (
    approvalFunctionNames.has(functionName) &&
    functionResult?.approvalRequired
  ) {
    return formattedResponse.message;
  }

  if (
    functionResult?.sent === false &&
    functionResult?.attachmentsRequired === true
  ) {
    const attachmentMessage = getAttachmentRequiredMessages(
      userLang,
      functionResult,
    )[functionName];
    if (attachmentMessage) {
      return attachmentMessage;
    }
  }

  if (functionResult?.sent) {
    const successMessage = getSuccessfulApiMessage(
      functionName,
      functionResult,
      userLang,
    );
    if (successMessage) {
      return successMessage;
    }
  }

  return formattedResponse.message;
}

async function humanizeStructuredResponse(
  functionName,
  formattedResponse,
  context,
) {
  const { sessionData, userMessage } = context;
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
    return (
      humanResponse.choices?.[0]?.message?.content || formattedResponse.message
    );
  } catch (humanErr) {
    logger.warn(
      `[Humanize] Fallback to structured response: ${humanErr.message}`,
    );
    return formattedResponse.message;
  }
}

async function handleAiFunctionCall(context, aiFunctionCall) {
  const { cacheKey, userId, userLang, userMessage } = context;
  logger.info(`Function requested: ${aiFunctionCall.name}`);

  let args;
  try {
    args = JSON.parse(aiFunctionCall.arguments);
  } catch {
    throw new Error("INVALID_FUNCTION_ARGUMENTS");
  }
  if (!args || typeof args !== "object") {
    args = {};
  }

  const functionName = aiFunctionCall.name;
  const functionContext = { ...context, args };
  const handler = getFunctionHandlers(functionContext)[functionName];
  if (!handler) {
    throw new Error("UNKNOWN_FUNCTION");
  }

  const functionResult = await handler();
  sessionCache[cacheKey].last_results = functionResult;

  const formattedResponse = await formatResult(
    functionName,
    functionResult,
    userLang,
  );
  const deterministicFunctionNames = getDeterministicFunctionNames();
  const approvalFunctionNames = getApprovalFunctionNames();
  let finalMessage = formattedResponse.message;

  if (
    !deterministicFunctionNames.has(functionName) &&
    !(
      approvalFunctionNames.has(functionName) &&
      functionResult?.approvalRequired
    )
  ) {
    finalMessage = await humanizeStructuredResponse(
      functionName,
      formattedResponse,
      context,
    );
  }

  finalMessage = finalizeFunctionResultMessage(
    functionName,
    functionResult,
    { ...formattedResponse, message: finalMessage },
    userLang,
  );

  const finalPayload = humanizePayload({
    ...formattedResponse,
    message: finalMessage,
  });
  persistAssistantReply({
    cacheKey,
    userId,
    userMessage,
    assistantMessage: finalPayload.message || "",
    result: functionResult,
  });
  return finalPayload;
}

async function runSafetyNetIntent(context, config) {
  const {
    cacheKey,
    normalizedUserMessage,
    requestAttachments,
    userId,
    userLang,
    userMessage,
  } = context;
  const intent = config.detect(normalizedUserMessage);
  if (!intent) {
    return null;
  }

  logger.warn(config.logLabel(intent.caseNumber));
  const prepared = await config.prepare(
    intent.caseNumber,
    requestAttachments,
    intent,
  );
  let finalMessage;
  if (!prepared.found || !prepared.ready) {
    finalMessage = config.formatFailed(
      { sent: false, ...prepared },
      userLang,
    ).message;
  } else {
    const pending = config.buildPending(prepared, requestAttachments, intent);
    setRuntimePendingApproval(cacheKey, pending);
    finalMessage = formatApiApprovalPreviewMessage(pending, userLang);
  }

  persistAssistantReply({
    cacheKey,
    userId,
    userMessage,
    assistantMessage: finalMessage,
    result: prepared,
  });
  return { message: finalMessage };
}

async function handleSafetyNetTurn(context) {
  const configs = [
    {
      detect: detectT9SendIntent,
      prepare: (caseNumber, attachments) =>
        apiIntegrations.t9Rideshare.prepareT9RidesharePayload({
          caseNumber,
          tort: "Rideshare",
          tier: "T9",
          attachments,
        }),
      formatFailed: formatSendT9RidesharePayloadResult,
      buildPending: (prepared, attachments) => ({
        kind: "t9",
        apiLabel: "T9",
        caseNumber: prepared.caseNumber,
        tort: "Rideshare",
        tier: "T9",
        payload: prepared.payload,
        attachments,
      }),
      logLabel: (caseNumber) =>
        `[T9 Safety Net] Model skipped function call. Forcing preview workflow for case ${caseNumber}`,
    },
    {
      detect: detectJdcT3SendIntent,
      prepare: (caseNumber) =>
        apiIntegrations.jdcT3.prepareJdcT3Payload({ caseNumber }),
      formatFailed: formatSendJdcT3PayloadResult,
      buildPending: (prepared, attachments) => ({
        kind: "jdc_t3",
        apiLabel: "JDC T3",
        caseNumber: prepared.caseNumber,
        payload: prepared.payload,
        attachments,
      }),
      logLabel: (caseNumber) =>
        `[JDC T3 Safety Net] Model skipped function call. Forcing preview workflow for case ${caseNumber}`,
    },
    {
      detect: detectWomensPrisonerAbuseT1SendIntent,
      prepare: (caseNumber) =>
        apiIntegrations.womensPrisonerAbuseT1.prepareWomensPrisonerAbuseT1Payload(
          { caseNumber },
        ),
      formatFailed: formatSendWomensPrisonerAbuseT1PayloadResult,
      buildPending: (prepared, attachments) => ({
        kind: "wpa_t1",
        apiLabel: "Women's Prisoner Abuse T1",
        caseNumber: prepared.caseNumber,
        payload: prepared.payload,
        attachments,
      }),
      logLabel: (caseNumber) =>
        `[WPA T1 Safety Net] Model skipped function call. Forcing preview workflow for case ${caseNumber}`,
    },
    {
      detect: detectDepoProveraT8SendIntent,
      prepare: (caseNumber) =>
        apiIntegrations.depoProveraT8.prepareDepoProveraT8Payload({
          caseNumber,
          tort: "Depo Provera",
          tier: "T8",
        }),
      formatFailed: formatSendDepoProveraT8PayloadResult,
      buildPending: (prepared) => ({
        kind: "depo_t8",
        apiLabel: "Depo Provera T8",
        caseNumber: prepared.caseNumber,
        tort: "Depo Provera",
        tier: "T8",
        payload: prepared.payload,
        attachments: [],
      }),
      logLabel: (caseNumber) =>
        `[Depo Provera T8 Safety Net] Model skipped function call. Forcing preview workflow for case ${caseNumber}`,
    },
    {
      detect: detectAdReachRideshareSendIntent,
      prepare: (caseNumber, _attachments, intent) =>
        apiIntegrations.adReachRideshare.prepareAdReachRidesharePayload({
          caseNumber,
          tier: intent.tier,
        }),
      formatFailed: formatSendAdReachRidesharePayloadResult,
      buildPending: (prepared, _attachments, intent) => ({
        kind: "adreach_rideshare",
        apiLabel: `adReach Rideshare T${prepared.tier || intent.tier}`,
        caseNumber: prepared.caseNumber,
        tort: "Rideshare",
        tier: prepared.tier || intent.tier,
        payload: prepared.payload,
        attachments: [],
      }),
      logLabel: (caseNumber) =>
        `[adReach Rideshare Safety Net] Model skipped function call. Forcing preview workflow for case ${caseNumber}`,
    },
  ];

  for (const config of configs) {
    const result = await runSafetyNetIntent(context, config);
    if (result) {
      return result;
    }
  }

  return null;
}

function buildProcessMessageError(errorMessage, userLang) {
  switch (errorMessage) {
    case "AI_SERVICE_FAILURE":
      return i18n(
        userLang,
        "El servicio de inteligencia artificial no esta disponible.",
        "The artificial intelligence service is not available.",
      );
    case "INVALID_FUNCTION_ARGUMENTS":
      return i18n(
        userLang,
        "Hubo un problema procesando la solicitud.",
        "There was a problem processing the request.",
      );
    case "INVALID_PHONE":
      return i18n(
        userLang,
        "Por favor envia un numero de telefono valido para consultar attempts.",
        "Please provide a valid phone number to check attempts.",
      );
    case "INVALID_DATE_FORMAT":
      return i18n(
        userLang,
        "Por favor envia una fecha valida con formato YYYY-MM-DD.",
        "Please provide a valid date in YYYY-MM-DD format.",
      );
    case "SF_CALLBACKS_QUERY_FAILED":
      return i18n(
        userLang,
        "No pude leer los callbacks del calendario con esta cuenta. Revisa permisos de Event/Calendar compartido.",
        "I could not read calendar callbacks with this account. Please verify Event/shared calendar permissions.",
      );
    case "INVALID_VENDOR_NAME":
      return i18n(
        userLang,
        "Por favor indica un nombre de vendor valido.",
        "Please provide a valid vendor name.",
      );
    default:
      return i18n(
        userLang,
        "Ocurrio un error inesperado.",
        "An unexpected error occurred.",
      );
  }
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

    const cacheKey = String(userId ?? "anonymous");
    if (!sessionCache[cacheKey]) {
      sessionCache[cacheKey] =
        await chatSessionService.getOrCreateSession(userId);
    }
    const sessionData = sessionCache[cacheKey];
    const context = {
      cacheKey,
      normalizedUserMessage,
      requestAttachments,
      sessionData,
      userId,
      userLang,
      userMessage,
    };

    const pendingBardResponse = await handlePendingBardT2Turn(context);
    if (pendingBardResponse) {
      return pendingBardResponse;
    }

    const pendingRuntimeResponse = await handlePendingRuntimeTurn(context);
    if (pendingRuntimeResponse) {
      return pendingRuntimeResponse;
    }

    const contextualNormalizedMessage = enrichWithSessionContext(
      normalizedUserMessage,
      {
        lastFilters: sessionData.last_filters,
        lastResults: sessionData.last_results,
        messages: sessionData.messages,
      },
    );

    const messages = buildChatRequestMessages(
      systemPrompt,
      sessionData,
      contextualNormalizedMessage,
      requestAttachments,
    );
    const response = await askModel(messages);

    const directIntentResponse = await handleDirectIntentTurn(context);
    if (directIntentResponse) {
      return directIntentResponse;
    }

    const message = response.choices?.[0]?.message;
    if (!message) {
      throw new Error("AI_INVALID_RESPONSE");
    }

    const legacyFunctionCall = Reflect.get(
      message,
      ["function", "call"].join("_"),
    );
    const aiFunctionCall =
      message.tool_calls?.[0]?.function || legacyFunctionCall;
    if (aiFunctionCall) {
      return handleAiFunctionCall(context, aiFunctionCall);
    }

    const safetyNetResponse = await handleSafetyNetTurn(context);
    if (safetyNetResponse) {
      return safetyNetResponse;
    }

    const assistantContent = message.content || "";
    persistAssistantReply({
      cacheKey,
      userId,
      userMessage,
      assistantMessage: assistantContent,
      result: null,
    });
    return { message: assistantContent };
  } catch (error) {
    logger.error(`Chatbot processing error: ${error.message}`);
    return {
      message: buildProcessMessageError(error.message, userLang),
    };
  }
};

function buildGroupedFieldMessage(data, lang) {
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

function buildAssignedAgentMessage(data, lang) {
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

function buildSingleCaseMessage(data, lang) {
  const closedDateLine = data.ClosedDate
    ? `\n• **${i18n(lang, "Fecha de cierre", "Closed date")}:** ${formatDate(data.ClosedDate, true)}`
    : "";

  return {
    message: `
📌 **${i18n(lang, "Caso", "Case")}: ${data.CaseNumber}**
• **${i18n(lang, "Estado", "Status")}:** ${data.Status}
• **${i18n(lang, "Subestado", "Substatus")}:** ${data.Substatus__c}
• **${i18n(lang, "Tipo", "Type")}:** ${data.Type}
• **${i18n(lang, "Origen", "Origin")}:** ${data.Origin}
• **${i18n(lang, "Segmento", "Supplier Segment")}:** ${data.Supplier_Segment__c}
• **${i18n(lang, "Propietario", "Owner")}:** ${data.Owner?.Name}
• **${i18n(lang, "Fecha de entrada", "Entry date")}:** ${formatDate(data.CreatedDate, true)}${closedDateLine}
`,
  };
}

function buildOperationalSummaryMessage(data, lang) {
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

async function buildCasesCollectionMessage(data, lang) {
  let casesArray = [];
  let totalCount = 0;

  if (data.records && Array.isArray(data.records)) {
    casesArray = data.records;
    totalCount = data.total || data.records.length;
  } else if (Array.isArray(data)) {
    casesArray = data;
    totalCount = data.length;
  }

  if (!casesArray.length) {
    return null;
  }

  if (casesArray.length <= BULK_THRESHOLD) {
    return {
      message: formatSmallResultSet(casesArray, totalCount, lang),
    };
  }

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
    return {
      message: formatSmallResultSet(casesArray, totalCount, lang),
    };
  }
}

function buildResultFormatterMap(lang) {
  return {
    getAttemptsByPhone: (data) => formatAttemptsByPhoneResult(data, lang),
    getAttemptsByCaseNumber: (data) =>
      formatAttemptsByCaseNumberResult(data, lang),
    getCaseAttemptsByDate: (data) => formatCaseAttemptsByDateResult(data, lang),
    getCasesWithoutAttemptsByDate: (data) =>
      formatCasesWithoutAttemptsByDateResult(data, lang),
    getScheduledCallbacks: (data) => formatScheduledCallbacksResult(data, lang),
    getSentCasesByAgentRanking: (data) =>
      formatSentCasesByAgentRankingResult(data, lang),
    getFakeLeadDQByVendorRanking: (data) =>
      formatFakeLeadDQByVendorRankingResult(data, lang),
    getCasesStillInCallback: (data) =>
      formatCasesStillInCallbackResult(data, lang),
    getTotalAttemptsByAgent: (data) =>
      formatTotalAttemptsByAgentResult(data, lang),
    getAgentAttemptsByPhonePerHour: (data) =>
      formatAgentAttemptsByPhonePerHourResult(data, lang),
    getVicidialAgentsStatus: (data) =>
      formatVicidialAgentsStatusResult(data, lang),
    getVendorsWithLeads: (data) => formatVendorsWithLeadsResult(data, lang),
    getTopVendors: (data) => formatTopVendorsResult(data, lang),
    getTopVendorsWithCaseDetails: (data) =>
      formatTopVendorsWithCaseDetailsResult(data, lang),
    getVendorsBySupplierSegment: (data) =>
      formatVendorsBySegmentResult(data, lang),
    getVendorLeadAttempts: (data) => formatVendorLeadAttemptsResult(data, lang),
    getCaseDisqualificationReason: (data) =>
      formatCaseDisqualificationResult(data, lang),
    prepareT9RidesharePayload: (data) =>
      formatPrepareT9RidesharePayloadResult(data, lang),
    sendT9RidesharePayload: (data) =>
      formatSendT9RidesharePayloadResult(data, lang),
    prepareBardPortT2Payload: (data) =>
      formatPrepareBardPortT2PayloadResult(data, lang),
    sendBardPortT2Payload: (data) =>
      formatSendBardPortT2PayloadResult(data, lang),
    prepareDepoProveraT8Payload: (data) =>
      formatPrepareDepoProveraT8PayloadResult(data, lang),
    sendDepoProveraT8Payload: (data) =>
      formatSendDepoProveraT8PayloadResult(data, lang),
    prepareAdReachRidesharePayload: (data) =>
      formatPrepareAdReachRidesharePayloadResult(data, lang),
    sendAdReachRidesharePayload: (data) =>
      formatSendAdReachRidesharePayloadResult(data, lang),
    prepareA4DRideshareT11Payload: (data) =>
      formatPrepareA4DRideshareT11PayloadResult(data, lang),
    sendA4DRideshareT11Payload: (data) =>
      formatSendA4DRideshareT11PayloadResult(data, lang),
    prepareJdcT3Payload: (data) => formatPrepareJdcT3PayloadResult(data, lang),
    sendJdcT3Payload: (data) => formatSendJdcT3PayloadResult(data, lang),
    prepareWomensPrisonerAbuseT1Payload: (data) =>
      formatPrepareWomensPrisonerAbuseT1PayloadResult(data, lang),
    sendWomensPrisonerAbuseT1Payload: (data) =>
      formatSendWomensPrisonerAbuseT1PayloadResult(data, lang),
    getCasesGroupedByField: (data) =>
      data.groups ? buildGroupedFieldMessage(data, lang) : null,
    getAssignedAgentByCaseNumber: (data) =>
      buildAssignedAgentMessage(data, lang),
    getCaseByNumber: (data) => buildSingleCaseMessage(data, lang),
  };
}

async function formatResult(type, data, lang = "en") {
  if (!data) {
    return {
      message: i18n(lang, "No se encontraron resultados.", "No results found."),
    };
  }

  const formatter = buildResultFormatterMap(lang)[type];
  if (formatter) {
    const formatted = await formatter(data);
    if (formatted) {
      return formatted;
    }
  }

  if (data.summary) {
    return buildOperationalSummaryMessage(data, lang);
  }

  const collectionMessage = await buildCasesCollectionMessage(data, lang);
  if (collectionMessage) {
    return collectionMessage;
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

async function formatCasesWithoutAttemptsByDateResult(data, lang = "en") {
  const records = data?.records || [];

  if (!records.length) {
    return {
      message: i18n(
        lang,
        `Revise los casos que ingresaron el ${data?.date || "periodo solicitado"} y todos ya tienen attempts registrados.`,
        `I checked cases entered on ${data?.date || "the requested date"} and all of them already have attempts logged.`,
      ),
    };
  }

  const substatusCounts = records.reduce((acc, item) => {
    const key = String(item.Substatus__c || "N/A").trim() || "N/A";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const substatusLines = Object.entries(substatusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([substatus, count]) => `• ${substatus}: ${count}`)
    .join("\n");

  if (records.length > BULK_THRESHOLD) {
    try {
      const excelRows = records.map((item) => ({
        CaseNumber: item.CaseNumber,
        phone: item.phone,
        attempts: 0,
        Status: item.Status,
        Substatus__c: item.Substatus__c,
        Owner: item.Owner,
        CreatedDate: item.CreatedDate,
        date: data.date,
      }));

      const excelFile = await Promise.resolve(
        excelService.generateAttemptsExcel(excelRows),
      );

      return {
        message: `
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Casos evaluados", "Cases evaluated")}:** ${data.totalCases}
• **${i18n(lang, "Casos sin attempts", "Cases without attempts")}:** ${data.withoutAttemptsCount}

**${i18n(lang, "Conteo por substatus", "Count by substatus")}:**
${substatusLines}

${i18n(lang, "Como son varios, te genere un Excel con el detalle de los casos que realmente estan en 0 attempts.", "Since there are several, I generated an Excel file with the cases that are truly at 0 attempts.")}

📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}
`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating no-attempts Excel: ${error.message}`);
    }
  }

  const lines = records
    .slice(0, 30)
    .map(
      (item, idx) =>
        `${idx + 1}. **${item.CaseNumber}** | ${i18n(lang, "telefono", "phone")}: ${item.phone || "N/A"} | ${i18n(lang, "estado", "status")}: ${item.Status || "N/A"}`,
    )
    .join("\n");

  return {
    message: `
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Casos evaluados", "Cases evaluated")}:** ${data.totalCases}
• **${i18n(lang, "Casos sin attempts", "Cases without attempts")}:** ${data.withoutAttemptsCount}

**${i18n(lang, "Conteo por substatus", "Count by substatus")}:**
${substatusLines}

**${i18n(lang, "Casos que siguen sin attempts", "Cases still without attempts")}:**
${lines}
`,
  };
}

function formatScheduledCallbacksResult(data, lang = "en") {
  const records = data?.records || [];

  if (!records.length) {
    return {
      message: i18n(
        lang,
        `No encontré callbacks programados para ${data?.date || "la fecha solicitada"}.`,
        `I did not find scheduled callbacks for ${data?.date || "the requested date"}.`,
      ),
    };
  }

  const lines = records
    .slice(0, 60)
    .map((item, idx) => {
      const start = formatDate(item.StartDateTime, true).split(" ")[1] || "N/A";
      const end = formatDate(item.EndDateTime, true).split(" ")[1] || "N/A";
      const owner = item.Owner?.Name || "N/A";
      const caseInfo = item.caseInfo
        ? ` | ${i18n(lang, "Caso", "Case")}: ${item.caseInfo.caseNumber}`
        : "";
      return `${idx + 1}. ${start} - ${end} | ${owner}${caseInfo}`;
    })
    .join("\n");

  return {
    message: `
📅 **${i18n(lang, "Fecha", "Date")}:** ${data.date}
• **${i18n(lang, "Callbacks programados", "Scheduled callbacks")}:** ${data.total}

**${i18n(lang, "Hora y agente", "Time and agent")}:**
${lines}
`,
  };
}

function formatSentCasesByAgentRankingResult(data, lang = "en") {
  const records = data?.records || [];

  if (!records.length) {
    return {
      message: i18n(
        lang,
        `No encontré agentes con casos Sent para ${data?.scopeLabel || "la fecha solicitada"}.`,
        `I did not find agents with Sent cases for ${data?.scopeLabel || "the requested date"}.`,
      ),
    };
  }

  let scopeText =
    data.scopeLabel || i18n(lang, "la fecha solicitada", "the requested date");
  if (data.scopeLabel === "today") {
    scopeText = i18n(lang, "hoy", "today");
  } else if (data.scopeLabel === "yesterday") {
    scopeText = i18n(lang, "ayer", "yesterday");
  } else if (data.scopeLabel === "last_week") {
    scopeText = i18n(lang, "la ultima semana", "the last week");
  }

  const title =
    data.sort === "lowest"
      ? i18n(
          lang,
          "Agentes con menos casos Sent",
          "Agents with fewer Sent cases",
        )
      : i18n(lang, "Agentes con más casos Sent", "Agents with more Sent cases");

  const lines = records
    .slice(0, 20)
    .map((item, idx) => {
      const caseLabel = item.caseNumber
        ? ` | ${i18n(lang, "Caso", "Case")}: ${item.caseNumber}`
        : "";

      return `${idx + 1}. **${item.agentName || "N/A"}** | ${i18n(lang, "casos Sent", "Sent cases")}: ${item.totalSent}${caseLabel}`;
    })
    .join("\n");

  return {
    message: `
👤 **${title}**
• **${i18n(lang, "Fecha", "Date")}:** ${scopeText}
• **${i18n(lang, "Agentes listados", "Agents listed")}:** ${data.totalAgents}
• **${i18n(lang, "Casos Sent totales", "Total Sent cases")}:** ${data.totalSent}

**${i18n(lang, "Ranking", "Ranking")}:**
${lines}
`,
  };
}

function formatFakeLeadDQByVendorRankingResult(data, lang = "en") {
  const records = data?.records || [];

  if (!records.length) {
    return {
      message: i18n(
        lang,
        `No encontré casos DQ por Fake Lead para ${data?.scopeLabel || "la fecha solicitada"}.`,
        `I did not find DQ Fake Lead cases for ${data?.scopeLabel || "the requested date"}.`,
      ),
    };
  }

  let scopeText =
    data.scopeLabel || i18n(lang, "la fecha solicitada", "the requested date");
  if (data.scopeLabel === "today") {
    scopeText = i18n(lang, "hoy", "today");
  } else if (data.scopeLabel === "yesterday") {
    scopeText = i18n(lang, "ayer", "yesterday");
  } else if (data.scopeLabel === "last_week") {
    scopeText = i18n(lang, "la ultima semana", "the last week");
  }

  const lines = records
    .slice(0, 20)
    .map((item, idx) => {
      const cases = (item.caseNumbers || []).filter(Boolean).join(", ");
      const casesLabel = cases
        ? ` | ${i18n(lang, "Casos", "Cases")}: ${cases}`
        : "";

      return `${idx + 1}. **${item.vendorName || "N/A"}** | ${i18n(lang, "Fake Leads DQ", "DQ Fake Leads")}: ${item.totalFakeLead}${casesLabel}`;
    })
    .join("\n");

  return {
    message: `
🚩 **${i18n(lang, "Casos DQ por Fake Lead por vendor", "DQ Fake Lead cases by vendor")}**
• **${i18n(lang, "Fecha", "Date")}:** ${scopeText}
• **${i18n(lang, "Vendors listados", "Vendors listed")}:** ${data.totalVendors}
• **${i18n(lang, "Total Fake Lead DQ", "Total DQ Fake Leads")}:** ${data.totalFakeLead}

**${i18n(lang, "Ranking", "Ranking")}:**
${lines}
`,
  };
}

async function formatCasesStillInCallbackResult(data, lang = "en") {
  const records = data?.records || [];

  let scopeText =
    data?.scopeLabel || i18n(lang, "la fecha solicitada", "the requested date");
  if (data?.scopeLabel === "today") {
    scopeText = i18n(lang, "hoy", "today");
  } else if (data?.scopeLabel === "yesterday") {
    scopeText = i18n(lang, "ayer", "yesterday");
  } else if (data?.scopeLabel === "last_week") {
    scopeText = i18n(lang, "la ultima semana", "the last week");
  } else if (data?.scopeLabel === "last_7_days") {
    scopeText = i18n(lang, "los ultimos 7 dias", "the last 7 days");
  } else if (data?.scopeLabel === "last_30_days") {
    scopeText = i18n(lang, "los ultimos 30 dias", "the last 30 days");
  } else if (data?.scopeLabel === "last_month") {
    scopeText = i18n(lang, "el ultimo mes", "the last month");
  }

  if (!records.length) {
    return {
      message: i18n(
        lang,
        `No encontré casos que sigan en Callback para ${scopeText}.`,
        `I did not find cases still in Callback for ${scopeText}.`,
      ),
    };
  }

  const header = `📞 **${i18n(lang, "Casos que siguen en Callback", "Cases still in Callback")}**\n• **${i18n(lang, "Rango", "Scope")}:** ${scopeText}\n• **${i18n(lang, "Cantidad", "Total")}:** ${data.total}`;

  // More than 10 → Excel
  if (records.length > 10) {
    try {
      const excelFile = await Promise.resolve(
        excelService.generateCallbackCasesExcel(records),
      );

      return {
        message: `${header}\n\n${i18n(
          lang,
          "Son bastantes registros, te armé un Excel con el detalle completo para que los puedas revisar.",
          "There are many records, so I prepared an Excel file with full details for your review.",
        )}\n\n📥 **${i18n(lang, "Archivo", "File")}:** ${excelFile.fileName}`,
        excelFile,
      };
    } catch (error) {
      logger.error(`Error generating callback Excel: ${error.message}`);
    }
  }

  // Up to 10 → inline rich list
  const lines = records
    .map((item, idx) => {
      const reason = item.Reason_for_Callback__c || "N/A";
      const intaker = item.BPO_Intaker__c || "N/A";
      const owner = item.Owner?.Name || "N/A";
      return `${idx + 1}. **${item.CaseNumber || "?"}** | Owner: ${owner} | Intaker: ${intaker} | Motivo: ${reason}`;
    })
    .join("\n");

  return {
    message: `${header}\n\n**${i18n(lang, "Detalle", "Detail")}:**\n${lines}\n`,
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

      const emptyCaseLine = `   - ${i18n(lang, "Sin casos", "No cases")}`;
      return `${idx + 1}. **${vendorItem.vendor}** (${i18n(lang, "leads", "leads")}: ${vendorItem.totalLeads})\n${caseLines || emptyCaseLine}`;
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
${getAgentViewSummaryLine(data, lang)}

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
        : getHourlyFallbackText(row, lang);

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
${getAgentViewSummaryLine(data, lang)}

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

  const lines = [
    `📋 **${i18n(lang, "Case", "Case")} ${data.caseNumber}**`,
    `• **${i18n(lang, "Status", "Status")}:** ${data.status || "N/A"}`,
    `• **${i18n(lang, "Substatus", "Substatus")}:** ${data.substatus || "N/A"}`,
    ...(data.bpo
      ? [`• **${i18n(lang, "Call Center", "Call Center")}:** ${data.bpo}`]
      : []),
    ...(data.bpoIntaker
      ? [
          `• **${i18n(lang, "Intaker que descalificó", "Disqualifying intaker")}:** ${data.bpoIntaker}`,
        ]
      : []),
    ...(data.reasonForDQ
      ? [
          `• **${i18n(lang, "Razón de descalificación", "Reason for DQ")}:** ${data.reasonForDQ}`,
        ]
      : []),
    ...(data.reasonDoesntMeetCriteria
      ? [
          `• **${i18n(lang, "No cumple criterios", "Doesn't meet criteria")}:** ${data.reasonDoesntMeetCriteria}`,
        ]
      : []),
    ...(!data.reasonForDQ && !data.reasonDoesntMeetCriteria
      ? [
          i18n(
            lang,
            "Este caso está marcado como Descalificado pero no tiene razón registrada en Salesforce.",
            "This case is marked as Disqualified but has no reason recorded in Salesforce.",
          ),
        ]
      : []),
    ...(data.owner
      ? [`• **${i18n(lang, "Owner", "Owner")}:** ${data.owner}`]
      : []),
  ];

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

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
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

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}`,
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
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

  if (data.approvalRequired) {
    return {
      message: formatBardT2ApprovalPreviewMessage(data, lang),
    };
  }

  if (!data.sent) {
    const httpText = data.statusCode || "N/A";
    const salesforceSavedText = getSalesforceSavedText(
      data.salesforceUpdated,
      lang,
    );

    return {
      message: `${i18n(
        lang,
        `No se completó el envío de Bard Port T2 para el case ${data.caseNumber}. ${data.message || data.error || "Revisa la configuración del endpoint"}.`,
        `Bard Port T2 delivery for case ${data.caseNumber} was not completed. ${data.message || data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${httpText}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${salesforceSavedText}`,
    };
  }

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
  };
}

function formatPrepareDepoProveraT8PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de Depo Provera T8.`,
        `I couldn't find case ${data.caseNumber} to build the Depo Provera T8 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de Depo Provera T8 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build Depo Provera T8 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload Depo Provera T8 preparado", "Depo Provera T8 payload prepared")}**
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

function formatSendDepoProveraT8PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de Depo Provera T8.`,
        `I couldn't find case ${data.caseNumber}. I could not send the Depo Provera T8 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload de Depo Provera T8 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send Depo Provera T8 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
    };
  }

  if (!data.sent) {
    const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

    return {
      message: `${i18n(
        lang,
        `No se completó el envío de Depo Provera T8 para el case ${data.caseNumber}. ${data.message || data.error || "Revisa la configuración del endpoint"}.`,
        `Depo Provera T8 delivery for case ${data.caseNumber} was not completed. ${data.message || data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    };
  }

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
  };
}

function formatPrepareAdReachRidesharePayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de adReach Rideshare.`,
        `I couldn't find case ${data.caseNumber} to build the adReach Rideshare payload.`,
      ),
    };
  }

  if (data.invalidTier) {
    return {
      message: i18n(
        lang,
        "Necesito un tier válido para adReach Rideshare. Usa 12, 13 o 14.",
        "I need a valid adReach Rideshare tier. Use 12, 13, or 14.",
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de adReach Rideshare para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot build adReach Rideshare payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload adReach Rideshare preparado", "adReach Rideshare payload prepared")}**
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

function formatSendAdReachRidesharePayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de adReach Rideshare.`,
        `I couldn't find case ${data.caseNumber}. I could not send the adReach Rideshare payload.`,
      ),
    };
  }

  if (data.invalidTier) {
    return {
      message: i18n(
        lang,
        "Necesito un tier válido para enviar a adReach Rideshare. Usa 12, 13 o 14.",
        "I need a valid tier to send adReach Rideshare. Use 12, 13, or 14.",
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload de adReach Rideshare para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**. Verifica que el registro esté completo antes de continuar.`,
        `⚠️ Cannot send adReach Rideshare payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**. Please verify the record is complete before proceeding.`,
      ),
    };
  }

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
    };
  }

  if (!data.sent) {
    const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

    return {
      message: `${i18n(
        lang,
        `No se completó el envío de adReach Rideshare para el case ${data.caseNumber}. ${data.message || data.error || "Revisa la configuración del endpoint"}.`,
        `adReach Rideshare delivery for case ${data.caseNumber} was not completed. ${data.message || data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    };
  }

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}`,
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
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

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
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

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
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

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
    };
  }

  if (!data.sent) {
    const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

    return {
      message: `${i18n(
        lang,
        `No se completó el envío JDC T3 para el case ${data.caseNumber}. ${data.error || "Revisa la configuración del endpoint"}.`,
        `JDC T3 delivery for case ${data.caseNumber} was not completed. ${data.error || "Check endpoint configuration"}.`,
      )}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    };
  }

  const sfText = getSalesforceSavedText(data.salesforceUpdated, lang);

  return {
    message: buildApiSuccessMessage(data.caseNumber, lang, [
      `${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}`,
      `${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    ]),
  };
}

function formatPrepareWomensPrisonerAbuseT1PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber} para armar el payload de Women's Prisoner Abuse T1.`,
        `I couldn't find case ${data.caseNumber} to build the Women's Prisoner Abuse T1 payload.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede armar el payload de Women's Prisoner Abuse T1 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**.`,
        `⚠️ Cannot build Women's Prisoner Abuse T1 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**.`,
      ),
    };
  }

  return {
    message: `
🧩 **${i18n(lang, "Payload Women's Prisoner Abuse T1 preparado", "Women's Prisoner Abuse T1 payload prepared")}**
• **Case:** ${data.caseNumber}

${i18n(
  lang,
  "La estructura quedó lista para envío al endpoint de Pulaski y los campos vacíos fueron normalizados a NA.",
  "The structure is ready to be sent to the Pulaski endpoint and empty fields were normalized to NA.",
)}
`,
  };
}

function formatSendWomensPrisonerAbuseT1PayloadResult(data, lang = "en") {
  if (!data.found) {
    return {
      message: i18n(
        lang,
        `No encontré el case ${data.caseNumber}. No pude enviar el payload de Women's Prisoner Abuse T1.`,
        `I couldn't find case ${data.caseNumber}. I could not send the Women's Prisoner Abuse T1 payload.`,
      ),
    };
  }

  if (data.attachmentsRequired) {
    return {
      message: i18n(
        lang,
        `No se hizo el envío Women's Prisoner Abuse T1 del case ${data.caseNumber} porque los archivos son obligatorios. Vuelve a enviar tu mensaje del chatbot adjuntando los documentos en la misma solicitud usando el campo files, y luego pide el envío otra vez.`,
        `Women's Prisoner Abuse T1 delivery was not started for case ${data.caseNumber} because files are mandatory. Send your chatbot message again with the required documents attached in the same request using the files field, then ask to submit it again.`,
      ),
    };
  }

  if (!data.ready) {
    const fields = (data.missingFields || []).join(", ");
    return {
      message: i18n(
        lang,
        `⚠️ No se puede enviar el payload Women's Prisoner Abuse T1 para el case ${data.caseNumber}. Los siguientes campos están vacíos o no tienen datos en Salesforce: **${fields}**.`,
        `⚠️ Cannot send Women's Prisoner Abuse T1 payload for case ${data.caseNumber}. The following fields are empty or missing in Salesforce: **${fields}**.`,
      ),
    };
  }

  if (data.approvalRequired) {
    return {
      message: formatApiApprovalPreviewMessage(data, lang),
    };
  }

  if (!data.sent) {
    let sfText = "N/A";
    if (typeof data.salesforceUpdated === "boolean") {
      sfText = data.salesforceUpdated
        ? i18n(lang, "si", "yes")
        : i18n(lang, "no", "no");
    }

    const failureMessageEs = `No se completó el envío Women's Prisoner Abuse T1 para el case ${data.caseNumber}. ${data.error || "Revisa la configuración del endpoint"}.`;
    const failureMessageEn = `Women's Prisoner Abuse T1 delivery for case ${data.caseNumber} was not completed. ${data.error || "Check endpoint configuration"}.`;

    return {
      message: `${i18n(lang, failureMessageEs, failureMessageEn)}\n\n${i18n(lang, "HTTP", "HTTP")}: ${data.statusCode || "N/A"}\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
    };
  }

  let sfText = "N/A";
  if (typeof data.salesforceUpdated === "boolean") {
    sfText = data.salesforceUpdated
      ? i18n(lang, "si", "yes")
      : i18n(lang, "no", "no");
  }

  const successMessageEs = `Listo, envié correctamente el API del caso ${data.caseNumber}.`;
  const successMessageEn = `Done, I sent the API successfully for case ${data.caseNumber}.`;

  return {
    message: `${i18n(lang, successMessageEs, successMessageEn)}\n\n${i18n(lang, "Respuesta del cliente", "Client response")}: ${data.clientResponse || "N/A"}\n${i18n(lang, "Guardado en Salesforce", "Saved in Salesforce")}: ${sfText}`,
  };
}
