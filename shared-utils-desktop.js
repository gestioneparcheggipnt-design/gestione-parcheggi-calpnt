import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

window.currentUser = null;   // { email, role, uid }

// ── SHARED-UTILS.JS ─────────────────────────────────────────────────────────
window.selectedSpotId = null;
window.unsubSpots = null;    // listener Firestore parcheggi
window.unsubHistory = null;  // listener Firestore storico
window.historyCache = [];    // cache locale storico

// ── IDENTIFICATIVI VEICOLO (punto unico di definizione, desktop) ─────────────
// Container: 4 lettere + 7 cifre (MSCU1234567) oppure
//            2 lettere + 3 cifre + (2 lettere | 1–3 cifre) (AB123CD · AB1234)
// Cassa:     3 cifre (042)
window.RE_CONTAINER = /^(?:[A-Z]{4}\d{7}|[A-Z]{2}\d{3}(?:[A-Z]{2}|\d{1,3}))$/;
window.RE_CASSA     = /^\d{3}$/;
window.FORMATO_CONTAINER_TXT = '4 lettere + 7 cifre oppure 2 lettere + 3 cifre + 2 lettere/1–3 cifre';
// Normalizza un identificativo digitato: maiuscolo, senza spazi/trattini/punti/slash
window.normalizzaId = function(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s\-./]+/g, '');
};
window.isContainerId = id => window.RE_CONTAINER.test(String(id ?? '').trim().toUpperCase());


// ââ PAN / ZOOM ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
window.scale=1; window.panX=0; window.panY=0; window.isPanning=false;
window.pSX=0; window.pSY=0; window.pSPX=0; window.pSPY=0;
window.MIN_S=0.3; window.MAX_S=5;

function applyT(){
  document.getElementById("mapCanvas").style.transform=`translate(${window.panX}px,${window.panY}px) scale(${window.scale})`;
  document.getElementById("mapCanvas").style.transformOrigin="0 0";
  document.getElementById("zoomLabel").textContent=Math.round(window.scale*100)+"%";
}
function clampP(){
  const vp=document.getElementById("mapViewport"),img=document.getElementById("mapImg");
  const vpW=vp.clientWidth,vpH=vp.clientHeight,iW=img.clientWidth*window.scale,iH=img.clientHeight*window.scale;
  window.panX=Math.max(Math.min(0,vpW-iW),Math.min(0,window.panX));
  window.panY=Math.max(Math.min(0,vpH-iH),Math.min(0,window.panY));
}
function zoom(delta,cx,cy){
  const vp=document.getElementById("mapViewport");
  if(!cx)cx=vp.clientWidth/2; if(!cy)cy=vp.clientHeight/2;
  const old=window.scale; window.scale=Math.max(window.MIN_S,Math.min(window.MAX_S,window.scale+delta));
  window.panX=cx-(cx-window.panX)*(window.scale/old); window.panY=cy-(cy-window.panY)*(window.scale/old);
  clampP(); applyT();
}

function resetZoom(){ window.scale=1; window.panX=0; window.panY=0; applyT(); }

window.zoom      = zoom;
window.resetZoom = resetZoom;
window.applyT  = applyT;
window.clampP  = clampP;

// ── LOG STORICO CENTRALIZZATO ────────────────────────────────────────────────
// Unico punto di scrittura su `history`. Riempie sempre ts (ora server),
// user/userName (SOLO nome dell'utente che esegue l'azione) e role.
// Qualsiasi campo extra passato (mode, origine, destinazione, richiedente…) viene incluso.
window.logHistory = function(entry = {}) {
  const u = window.currentUser || {};
  // solo il nome utente: mai l'email (fallback: parte prima della @)
  const nome = u.name || (u.email ? String(u.email).split('@')[0] : '—');
  const { spot = null, action = null, plate = null, ...rest } = entry;
  return addDoc(collection(window.db, 'history'), {
    ...rest,
    ts: serverTimestamp(),
    spot, action, plate,
    user: nome,
    userName: nome,
    role: u.role || null,
  });
};
