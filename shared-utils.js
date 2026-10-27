// ── shared-utils.js (mobile) ─────────────────────────────────────────────────
import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── LOG STORICO CENTRALIZZATO ────────────────────────────────────────────────
// Unico punto di scrittura su `history`. Riempie sempre ts (ora server),
// user/userName (SOLO nome di chi esegue l'azione, letto da window.currentUser) e role.
// Campi extra (mode, origine, destinazione, richiedente…) vengono inclusi così come passati.
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

// ── Formattazione date ────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return '—';
  const dt = d.toDate ? d.toDate() : new Date(d);
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
    + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDur(since) {
  if (!since) return '—';
  const ms = Date.now() - (since.toDate ? since.toDate() : new Date(since)).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
export function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Validazione targa ─────────────────────────────────────────────────────────
// Container: 4 lettere + 7 cifre (MSCU1234567) oppure
//            2 lettere + 3 cifre + (2 lettere | 1–3 cifre) (AB123CD · AB1234)
export const RE_CONTAINER = /^(?:[A-Z]{4}\d{7}|[A-Z]{2}\d{3}(?:[A-Z]{2}|\d{1,3}))$/;
export const RE_CASSA     = /^\d{3}$/;

// Normalizza un identificativo digitato: maiuscolo, senza spazi/trattini/punti/slash
export function normalizzaId(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s\-./]+/g, '');
}
export function isContainerId(id) {
  return RE_CONTAINER.test(String(id ?? '').trim().toUpperCase());
}

export function validatePlate(raw, mode) {
  const plate = normalizzaId(raw);
  if (!plate) return { ok: false, msg: 'Inserisci un ID veicolo.' };
  if (mode === 'container' && !RE_CONTAINER.test(plate))
    return { ok: false, msg: 'Formato container non valido (es. ABCD1234567 o AB123CD).' };
  if (mode === 'cassa' && !RE_CASSA.test(plate))
    return { ok: false, msg: 'Formato cassa non valido (3 cifre, es. 042).' };
  return { ok: true, plate };
}

// ── Validazione destinazione ribalta ─────────────────────────────────────────
export function validateDestination(dest, validList) {
  return validList.includes((dest || '').trim().toUpperCase());
}

// ── Controllo duplicato veicolo ───────────────────────────────────────────────
// spots = mappa { id: vista } di ParcheggiCore (un posto può avere più mezzi)
export function checkVehicleNotDuplicate(plate, spots) {
  const hit = window.ParcheggiCore.trovaMezzo(spots, plate);
  if (hit) return { ok: false, msg: `Veicolo ${plate} già presente nel posto ${hit.posto}.` };
  return { ok: true };
}

// ── Controllo spazio sul posto per un tipo di mezzo ───────────────────────────
export function checkSpotFree(spotId, spots, tipo = 'container') {
  const sp = spots[spotId];
  if (!sp) return { ok: false, msg: `Posto ${spotId} non trovato o disattivato.` };
  if (!window.ParcheggiCore.disponibilePer(sp, tipo)) return { ok: false, msg: `Posto ${spotId} senza spazio per ${tipo === 'cassa' ? 'una cassa' : 'un container'}.` };
  return { ok: true };
}

// ── Validazione spot e ribalta ────────────────────────────────────────────────
export function isValidSpot(spotId) {
  return !!spotId && window.ParcheggiCore.isAttivo(spotId);
}

export function isValidRibalta(ribaltaId, validList) {
  return validList.includes(ribaltaId);
}
