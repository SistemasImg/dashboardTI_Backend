const detectIntent = (text) => {
  const lower = text.toLowerCase();

  const caseMatch = text.match(/\b\d{6,}\b/);
  if (caseMatch) {
    return { type: "GET_CASE", caseNumber: caseMatch[0] };
  }

  if (lower.includes("oportunidades") && lower.includes("hoy")) {
    return { type: "GET_OPPORTUNITIES_TODAY" };
  }

  if (lower.includes("status")) {
    const statusMatch = text.match(/status\s+(\w+)/i);
    return { type: "GET_CASES_BY_STATUS", status: statusMatch?.[1] };
  }

  return { type: "GENERAL" };
};

module.exports = { detectIntent };
