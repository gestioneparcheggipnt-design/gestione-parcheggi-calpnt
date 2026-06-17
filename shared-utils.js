// ── shared-utils.js (mobile) ─────────────────────────────────────────────────

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
const RE_CONTAINER = /^[A-Z]{4}\d{7}$/;
const RE_CASSA     = /^\d{3}$/;

export function validatePlate(raw, mode) {
  const plate = (raw || '').trim().toUpperCase();
  if (!plate) return { ok: false, msg: 'Inserisci un ID veicolo.' };
  if (mode === 'container' && !RE_CONTAINER.test(plate))
    return { ok: false, msg: 'Formato container non valido (es. ABCD1234567).' };
  if (mode === 'cassa' && !RE_CASSA.test(plate))
    return { ok: false, msg: 'Formato cassa non valido (3 cifre, es. 042).' };
  return { ok: true, plate };
}

// ── Validazione destinazione ribalta ─────────────────────────────────────────
export function validateDestination(dest, validList) {
  return validList.includes((dest || '').trim().toUpperCase());
}

// ── Controllo duplicato veicolo ───────────────────────────────────────────────
export async function checkVehicleNotDuplicate(plate, spots) {
  const occupied = Object.values(spots).find(
    s => s.occupied && s.plate === plate
  );
  if (occupied) return { ok: false, msg: `Veicolo ${plate} già presente nel posto ${occupied.id}.` };
  return { ok: true };
}

// ── Controllo posto libero ────────────────────────────────────────────────────
export function checkSpotFree(spotId, spots) {
  const sp = spots[spotId];
  if (!sp) return { ok: false, msg: `Posto ${spotId} non trovato.` };
  if (sp.occupied) return { ok: false, msg: `Posto ${spotId} già occupato da ${sp.plate}.` };
  return { ok: true };
}

// ── Validazione spot e ribalta ────────────────────────────────────────────────
export function isValidSpot(spotId, spots) {
  return spotId && spots[spotId] !== undefined;
}

export function isValidRibalta(ribaltaId, validList) {
  return validList.includes(ribaltaId);
}
