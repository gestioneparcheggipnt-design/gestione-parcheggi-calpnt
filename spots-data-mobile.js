// ── POSTI ─────────────────────────────────────────────────────────────────────
// La tabella unica è parcheggi-data.js; parcheggi-core.js (importato da
// mobile.html PRIMA di questo file) imposta window.SPOT_DEFS / ZONES / PATCHES.
// Sono gli stessi oggetti, aggiornati sul posto quando cambiano i posti attivi.
const SPOT_DEFS = window.SPOT_DEFS;
const PATCHES   = window.PATCHES;
const ZONES     = window.ZONES;

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

// Export per ES Module (mobile) — ignorato dal bundle desktop (assemble.py)
export { SPOT_DEFS, PATCHES, ZONES, REPARTI, getDestinazioniPerReparto };
