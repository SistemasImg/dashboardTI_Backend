require("dotenv").config();

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULT_ACTIVE_VICIDIAL_USERS = [
  "ABC_amartinez",
  "ABC_Avivas",
  "ABC_Ecarillo",
  "ABC_Ecab",
  "ABC_emejia",
  "ABC_Fsosa",
  "ABC_hgonzalez",
  "ABC_jlliego",
  "ABC_ksuazo",
  "ABC_mthompson",
  "ABC_rdzul",
  "Op1ntViX1al",
  "Supre0viX",
  "ABC_anovelo",
  "agonzalez",
  "Callpurity",
  "COMERCIAL",
  "CZX_abeltran",
  "CZX_jmaciel",
  "CZX_jandere",
  "CZX_jcartas",
  "dparedes",
  "avaldivia",
  "aayala",
  "APIIMG",
  "asotelo",
  "agarcia",
  "cruiz",
  "jsairitupac",
  "jcabello",
  "jruiz",
  "khidalgo",
  "lzavala",
  "mchero",
  "rtorres",
  "SISTEMAS",
  "UserTestIMG",
  "njaimes",
  "OPERACIONES",
  "OPERACIONES2",
  "TEST555",
  "TEST777",
  "VDM_agente04",
  "VDM_supervisor2",
  "VDM_agente03",
  "VDM_supervisor",
  "VDM_agente02",
  "VDM_agente01",
  "VDM_agente05",
];

const DEFAULT_EXCLUDED_VICIDIAL_USER_STATS_USERS = [
  "Op1ntViX1al",
  "Supre0viX",
  "Callpurity",
  "COMERCIAL",
  "avaldivia",
  "aayala",
  "APIIMG",
  "asotelo",
  "agarcia",
  "cruiz",
  "jsairitupac",
  "jruiz",
  "khidalgo",
  "mchero",
  "rtorres",
  "SISTEMAS",
  "UserTestIMG",
  "OPERACIONES",
  "OPERACIONES2",
  "TEST555",
  "TEST777",
  "VDM_supervisor2",
  "VDM_supervisor",
];

const ACTIVE_VICIDIAL_USERS =
  parseCsvList(process.env.VICIDIAL_USER_STATS_USERS).length > 0
    ? parseCsvList(process.env.VICIDIAL_USER_STATS_USERS)
    : DEFAULT_ACTIVE_VICIDIAL_USERS;

const EXCLUDED_VICIDIAL_USER_STATS_USERS = new Set(
  parseCsvList(process.env.VICIDIAL_USER_STATS_EXCLUDED_USERS).length > 0
    ? parseCsvList(process.env.VICIDIAL_USER_STATS_EXCLUDED_USERS)
    : DEFAULT_EXCLUDED_VICIDIAL_USER_STATS_USERS,
);

const INCLUDED_VICIDIAL_USER_STATS_USERS = ACTIVE_VICIDIAL_USERS.filter(
  (user) => !EXCLUDED_VICIDIAL_USER_STATS_USERS.has(user),
);

module.exports = {
  ACTIVE_VICIDIAL_USERS,
  EXCLUDED_VICIDIAL_USER_STATS_USERS,
  INCLUDED_VICIDIAL_USER_STATS_USERS,
};
