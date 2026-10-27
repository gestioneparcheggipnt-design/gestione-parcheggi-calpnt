// ── parcheggi-data.js ─────────────────────────────────────────────────────────
// TABELLA UNICA DEI PARCHEGGI — unica fonte, condivisa desktop + mobile.
// Si importa SOLO da parcheggi-core.js: tutti gli altri file usano
// window.ParcheggiCore (o i window.* che il core imposta).
//
// Per ogni posto:
//   id       nome visibile del posto (es. 'A01')
//   zona     raggruppamento (le zone si ricavano da qui)
//   ammessi  ['container'] | ['cassa'] | ['container','cassa']
//   stato    'pieno' | 'vuoto'  → criterio di destinazione (mezzi pieni / vuoti)
//   sotto    numero di sotto-posti (1–3). Un container li occupa TUTTI,
//            una cassa ne occupa UNO (il libero con numero più basso).
//            Se ammessi = solo container, sotto deve essere 1.
//   slide    mappa percorso stampata dalla portineria (1–5)
//   rect     [x, y, w, h] in pixel sulla planimetria IMG_W × IMG_H
//
// Aggiungere un posto = aggiungere una riga qui. Nient'altro.

export const IMG_W = 3000, IMG_H = 2250;

export const PARCHEGGI = [
  { id:'A13', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1291,351,29,87] },
  { id:'A01', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1291,441,29,87] },
  { id:'A14', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1320,351,24,87] },
  { id:'A02', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1320,441,24,87] },
  { id:'A15', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1344,351,24,87] },
  { id:'A03', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1344,441,24,87] },
  { id:'A16', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1368,351,24,87] },
  { id:'A04', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1368,441,24,87] },
  { id:'A17', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1392,351,25,87] },
  { id:'A05', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1392,441,25,87] },
  { id:'A18', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1417,351,23,87] },
  { id:'A06', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1417,441,23,87] },
  { id:'A19', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1440,351,24,87] },
  { id:'A07', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1440,441,24,87] },
  { id:'A20', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1464,351,24,87] },
  { id:'A08', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1464,441,24,87] },
  { id:'A21', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1488,351,24,87] },
  { id:'A09', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1488,441,24,87] },
  { id:'A22', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1512,351,24,87] },
  { id:'A10', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1512,441,24,87] },
  { id:'A23', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1536,351,24,87] },
  { id:'A11', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1536,441,24,87] },
  { id:'A24', zona:'ZONA A', ammessi:['container'], stato:'vuoto', sotto:1, slide:3, rect:[1560,351,29,87] },
  { id:'A12', zona:'ZONA A', ammessi:['container'], stato:'pieno', sotto:1, slide:2, rect:[1560,441,29,87] },
  { id:'B01', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1647,139,27,97] },
  { id:'B02', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1674,139,26,97] },
  { id:'B03', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1700,139,26,97] },
  { id:'B04', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1726,139,26,97] },
  { id:'B05', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1752,139,26,97] },
  { id:'B06', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1778,139,26,97] },
  { id:'B07', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1804,139,26,97] },
  { id:'B08', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1830,139,26,97] },
  { id:'B09', zona:'ZONA B', ammessi:['cassa'],     stato:'pieno', sotto:1, slide:1, rect:[1856,139,25,97] },
  { id:'C01', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1012,89,24] },
  { id:'C02', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1038,89,23] },
  { id:'C03', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1063,89,24] },
  { id:'C04', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1089,89,24] },
  { id:'C05', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1115,89,24] },
  { id:'C06', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1140,89,24] },
  { id:'C07', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1166,89,23] },
  { id:'C08', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1190,89,25] },
  { id:'C09', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1217,89,24] },
  { id:'C10', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1245,89,23] },
  { id:'C11', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1270,89,24] },
  { id:'C12', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1296,89,24] },
  { id:'C13', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1322,89,24] },
  { id:'C14', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1347,89,24] },
  { id:'C15', zona:'ZONA C', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:4, rect:[324,1373,89,23] },
  { id:'D01', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1565,89,24] },
  { id:'D02', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1591,89,24] },
  { id:'D03', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1617,89,23] },
  { id:'D04', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1642,89,24] },
  { id:'D05', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1668,89,24] },
  { id:'D06', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1694,89,23] },
  { id:'D07', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1719,89,24] },
  { id:'D08', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1745,89,23] },
  { id:'D09', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1771,89,23] },
  { id:'D10', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1798,89,24] },
  { id:'D11', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1824,89,23] },
  { id:'D12', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1849,89,24] },
  { id:'D13', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1875,89,24] },
  { id:'D14', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1901,89,23] },
  { id:'D15', zona:'ZONA D', ammessi:['cassa'],     stato:'vuoto', sotto:1, slide:5, rect:[324,1926,89,24] },
];

// Rettangoli che coprono segni della planimetria (disegnati sotto i posti)
export const PATCHES = [
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
