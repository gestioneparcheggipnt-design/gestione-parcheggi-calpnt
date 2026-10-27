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
// Elenco di partenza (statico); sostituito da config/magazzino appena arriva
// (listener in mobile.html → aggiornaReparti).
let _REPARTI_TUTTI = {
  "RICEVIMENTO": [..._range('PNT1', 1, 31)],
  "SPEDIZIONI":  [..._range('PNT1', 32, 61), ..._range('PNT1', 73, 81)],
  "CAPI APPESI": [..._range('PNT1', 62, 72)],
  "LAV MAN":     [..._range('PNT1', 82, 90)],
  "REVERSE":     [..._range('PNT2', 1, 18), ..._range('PNT2', 32, 33)],
  "ESTERO":      [..._range('PNT2', 19, 29)],
  "E-COMMERCE":  [..._range('PNT2', 30, 31), ..._range('PNT2', 34, 48)],
  "TGW":         [..._range('PNT2', 49, 49)],
};

// REPARTI = solo ribalte ATTIVE. È lo stesso oggetto per tutta la vita della
// pagina (aggiornato sul posto): chi lo importa o lo legge da window._REPARTI
// vede sempre la versione corrente.
const REPARTI = {};

/** Ricalcola REPARTI. `tutti` (opzionale) = nuovo elenco completo da config/magazzino. */
function aggiornaReparti(tutti) {
  if (tutti) _REPARTI_TUTTI = tutti;
  const C = window.ParcheggiCore;
  const filtrati = C && C.filtraReparti ? C.filtraReparti(_REPARTI_TUTTI) : _REPARTI_TUTTI;
  Object.keys(REPARTI).forEach(k => delete REPARTI[k]);
  Object.assign(REPARTI, filtrati);
}
function repartiTutti() { return _REPARTI_TUTTI; }
aggiornaReparti();

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
export { SPOT_DEFS, PATCHES, ZONES, REPARTI, getDestinazioniPerReparto, aggiornaReparti, repartiTutti };
