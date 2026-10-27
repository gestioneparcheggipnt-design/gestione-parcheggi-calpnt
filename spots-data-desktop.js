// ── spots-data-desktop.js ────────────────────────────────────────────────────────
// I posti NON sono più definiti qui: la tabella unica è parcheggi-data.js e
// parcheggi-core.js (caricato prima di questo file) imposta window.SPOT_DEFS,
// window.ZONES, window.PATCHES, window.IMG_W / IMG_H.

// ── Mappa reparti → ribalte ───────────────────────────────────────────────────
function _range(prefix, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(prefix + '-' + String(i).padStart(2,'0'));
  return out;
}
window.REPARTI = {
  "RICEVIMENTO": [..._range('PNT1', 1, 31)],
  "SPEDIZIONI":  [..._range('PNT1', 32, 61), ..._range('PNT1', 73, 81)],
  "CAPI APPESI": [..._range('PNT1', 62, 72)],
  "LAV MAN":     [..._range('PNT1', 82, 90)],
  "REVERSE":     [..._range('PNT2', 1, 18), ..._range('PNT2', 32, 33)],
  "ESTERO":      [..._range('PNT2', 19, 29)],
  "E-COMMERCE":  [..._range('PNT2', 30, 31), ..._range('PNT2', 34, 48)],
  "TGW":         [..._range('PNT2', 49, 49)],
};
// REPARTI_TUTTI = elenco completo (config/magazzino); REPARTI = solo ribalte ATTIVE.
// impostazioni-desktop.js li ricalcola quando cambiano config o ribalte disattivate.
window.REPARTI_TUTTI = window.REPARTI;
window.REPARTI = window.ParcheggiCore.filtraReparti(window.REPARTI_TUTTI);

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
// ââ STATO LOCALE âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Solo posti attivi, vista normalizzata (vedi ParcheggiCore.vista).
// Riempita sul posto dal listener in firestore-listeners.js.
window.spots = window.ParcheggiCore.riempi({}, { date: true });

// ââ MODALITÃ CONTAINER / CASSA ââââââââââââââââââââââââââââââââââââââââââââââââ
// Ogni utente sceglie la propria vista (salvata in localStorage per UID)
window.currentMode = 'container'; // default

function loadMode(){
  const uid = window.currentUser ? window.currentUser.uid : 'guest';
  const saved = localStorage.getItem('parkMode_'+uid);
  window.currentMode = saved === 'cassa' ? 'cassa' : 'container';
  _applyModeUI();
  // Aggiorna la vista tab prenotazioni se già inizializzata
  if (typeof _aggiornaVistaPrenotazioni === 'function') if(window._aggiornaVistaPrenotazioni) window._aggiornaVistaPrenotazioni();
}

function setMode(mode){
  window.currentMode = mode;
  const uid = window.currentUser ? window.currentUser.uid : 'guest';
  localStorage.setItem('parkMode_'+uid, mode);
  _applyModeUI();
  if(window.renderMap) window.renderMap();
  selectSpot(window.selectedSpotId); // aggiorna pannello se c'è un posto selezionato
  // Aggiorna la vista tab prenotazioni se visibile
  if (typeof _aggiornaVistaPrenotazioni === 'function') if(window._aggiornaVistaPrenotazioni) window._aggiornaVistaPrenotazioni();
}

function _applyModeUI(){
  const btnC = document.getElementById('btnModeContainer');
  const btnK = document.getElementById('btnModeCassa');
  if(!btnC || !btnK) return;
  if(window.currentMode === 'container'){
    btnC.classList.add('active');
    btnK.classList.remove('active');
  } else {
    btnK.classList.add('active');
    btnC.classList.remove('active');
  }
}

function getModeLabel(){
  return window.currentMode === 'cassa' ? 'Cassa' : 'Container';
}

function getModeIcon(){
  return window.currentMode === 'cassa' ? '&#x1F4E6;' : '&#x1F69B;';
}

window.setMode = setMode;

window.loadMode = loadMode;
window.getModeLabel = getModeLabel;
window.getModeIcon  = getModeIcon;
window.getDestinazioniPerReparto = getDestinazioniPerReparto;
