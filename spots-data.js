// ── MAP DATA (immutabile) ─────────────────────────────────────────────────────
// Nota: MAP_SRC (base64 JPEG della planimetria) è inline in index.html (riga 704)

const IMG_W = 3000, IMG_H = 2250;

const SPOT_DEFS=[
  ["A13","P VERDE",1291,351,29,87],
  ["A01","P VERDE",1291,441,29,87],
  ["A14","P VERDE",1320,351,24,87],
  ["A02","P VERDE",1320,441,24,87],
  ["A15","P VERDE",1344,351,24,87],
  ["A03","P VERDE",1344,441,24,87],
  ["A16","P VERDE",1368,351,24,87],
  ["A04","P VERDE",1368,441,24,87],
  ["A17","P VERDE",1392,351,25,87],
  ["A05","P VERDE",1392,441,25,87],
  ["A18","P VERDE",1417,351,23,87],
  ["A06","P VERDE",1417,441,23,87],
  ["A19","P VERDE",1440,351,24,87],
  ["A07","P VERDE",1440,441,24,87],
  ["A20","P VERDE",1464,351,24,87],
  ["A08","P VERDE",1464,441,24,87],
  ["A21","P VERDE",1488,351,24,87],
  ["A09","P VERDE",1488,441,24,87],
  ["A22","P VERDE",1512,351,24,87],
  ["A10","P VERDE",1512,441,24,87],
  ["A23","P VERDE",1536,351,24,87],
  ["A11","P VERDE",1536,441,24,87],
  ["A24","P VERDE",1560,351,29,87],
  ["A12","P VERDE",1560,441,29,87],
  ["B01","P BLU",1647,139,27,97],
  ["B02","P BLU",1674,139,26,97],
  ["B03","P BLU",1700,139,26,97],
  ["B04","P BLU",1726,139,26,97],
  ["B05","P BLU",1752,139,26,97],
  ["B06","P BLU",1778,139,26,97],
  ["B07","P BLU",1804,139,26,97],
  ["B08","P BLU",1830,139,26,97],
  ["B09","P BLU",1856,139,25,97],
  ["C01","ZONA C",324,1012,89,24],
  ["C02","ZONA C",324,1038,89,23],
  ["C03","ZONA C",324,1063,89,24],
  ["C04","ZONA C",324,1089,89,24],
  ["C05","ZONA C",324,1115,89,24],
  ["C06","ZONA C",324,1140,89,24],
  ["C07","ZONA C",324,1166,89,23],
  ["C08","ZONA C",324,1190,89,25],
  ["C09","ZONA C",324,1217,89,24],
  ["C10","ZONA C",324,1245,89,23],
  ["C11","ZONA C",324,1270,89,24],
  ["C12","ZONA C",324,1296,89,24],
  ["C13","ZONA C",324,1322,89,24],
  ["C14","ZONA C",324,1347,89,24],
  ["C15","ZONA C",324,1373,89,23],
  ["D01","ZONA D",324,1565,89,24],
  ["D02","ZONA D",324,1591,89,24],
  ["D03","ZONA D",324,1617,89,23],
  ["D04","ZONA D",324,1642,89,24],
  ["D05","ZONA D",324,1668,89,24],
  ["D06","ZONA D",324,1694,89,23],
  ["D07","ZONA D",324,1719,89,24],
  ["D08","ZONA D",324,1745,89,23],
  ["D09","ZONA D",324,1771,89,23],
  ["D10","ZONA D",324,1798,89,24],
  ["D11","ZONA D",324,1824,89,23],
  ["D12","ZONA D",324,1849,89,24],
  ["D13","ZONA D",324,1875,89,24],
  ["D14","ZONA D",324,1901,89,23],
  ["D15","ZONA D",324,1926,89,24]
];
const PATCHES=[
  [1291, 351, 302, 177],
  [1658, 139, 221, 97],
  [324, 1012, 89, 384],
  [348, 1002, 63, 13],
  [317, 1395, 96, 45],
  [413, 1010, 32, 388],
  [324, 1565, 89, 385],
  [317, 1470, 60, 100],
  [317, 1949, 65, 65],
  [413, 1563, 32, 388]
];

const ZONES = {
  "ZONA A": SPOT_DEFS.filter(s=>s[1]==="ZONA A").map(s=>s[0]),
  "ZONA B": SPOT_DEFS.filter(s=>s[1]==="ZONA B").map(s=>s[0]),
  "ZONA C": SPOT_DEFS.filter(s=>s[1]==="ZONA C").map(s=>s[0]),
  "ZONA D": SPOT_DEFS.filter(s=>s[1]==="ZONA D").map(s=>s[0]),
};

// ── Mappa reparti → ribalte ───────────────────────────────────────────────────
function _range(prefix, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(prefix + '-' + String(i).padStart(2,'0'));
  return out;
}
const REPARTI = {
  "RICEVIMENTO": [..._range('PNT1', 1, 31)],
  "SPEDIZIONI":  [..._range('PNT1', 32, 61), ..._range('PNT1', 73, 81)],
  "CAPI APPESI": [..._range('PNT1', 62, 72)],
  "LAV MAN":     [..._range('PNT1', 82, 90)],
  "REVERSE":     [..._range('PNT2', 1, 18), ..._range('PNT2', 32, 33)],
  "ESTERO":      [..._range('PNT2', 19, 29)],
  "E-COMMERCE":  [..._range('PNT2', 30, 31), ..._range('PNT2', 34, 48)],
  "TGW":         [..._range('PNT2', 49, 49)],
};

// Restituisce le destinazioni valide per un reparto.
// Se reparto è null/undefined (es. amministratore) restituisce tutte.
function getDestinazioniPerReparto(reparto) {
  if (!reparto || !REPARTI[reparto]) {
    // Tutte le destinazioni
    return Object.values(REPARTI).flat();
  }
  return REPARTI[reparto];
}
