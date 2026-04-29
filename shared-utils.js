// ── shared-utils.js ───────────────────────────────────────────────────────────
// Utilities condivise: formattazione date, toast, escape HTML

let _toastTimer = null;

/**
 * Formatta una data in DD/MM HH:MM
 * @param {Date|string|null} d
 */
export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Formatta la durata da una data di inizio a oggi (es. "2h 15m")
 * @param {Date|string|null} since
 */
export function fmtDur(since) {
  if (!since) return '';
  const m = Math.floor((Date.now() - new Date(since)) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

/**
 * Mostra un toast in sovrimpressione
 * @param {string} msg
 * @param {'success'|'error'} type
 */
export function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = (type === 'success' ? '✓ ' : '⚠ ') + msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/**
 * Escape HTML per prevenire XSS
 * @param {string} str
 */
export function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── VALIDATORI FORMATO ────────────────────────────────────────────────────────

/** Container: 4 lettere maiuscole + 7 cifre (es. ABCD1234567) */
export function isValidContainer(val) {
  return /^[A-Z]{4}\d{7}$/.test((val || '').trim().toUpperCase());
}

/** Cassa: esattamente 3 cifre (es. 042) */
export function isValidCassa(val) {
  return /^\d{3}$/.test((val || '').trim());
}

/** Spot parcheggio: lettera A-D + 2 cifre (es. A01, C15) */
export function isValidSpot(val) {
  return /^[A-D]\d{2}$/.test((val || '').trim().toUpperCase());
}

/** Destinazione ribalta: PNT1-XX o PNT2-XX (es. PNT1-07, PNT2-49) */
export function isValidRibalta(val) {
  return /^PNT[12]-\d{2}$/.test((val || '').trim().toUpperCase());
}

/**
 * Valida la targa/identificativo in base alla modalità.
 * @param {string} val
 * @param {'container'|'cassa'} mode
 * @returns {{ ok: boolean, msg: string }}
 */
export function validatePlate(val, mode) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return { ok: false, msg: 'Inserisci un identificativo.' };
  if (mode === 'container') {
    if (!isValidContainer(s))
      return { ok: false, msg: 'Container non valido. Formato: 4 lettere + 7 cifre (es. ABCD1234567).' };
  } else {
    if (!isValidCassa(s))
      return { ok: false, msg: 'Numero cassa non valido. Formato: 3 cifre (es. 042).' };
  }
  return { ok: true, msg: '' };
}

/**
 * Valida la destinazione finale (posto parcheggio o ribalta).
 * @param {string} val
 * @returns {{ ok: boolean, msg: string }}
 */
export function validateDestination(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return { ok: false, msg: 'Inserisci la destinazione.' };
  if (!isValidSpot(s) && !isValidRibalta(s))
    return { ok: false, msg: 'Destinazione non valida. Usa un posto (es. A01) o una ribalta (es. PNT1-07).' };
  return { ok: true, msg: '' };
}

// ── VERIFICA STATO POSTI ──────────────────────────────────────────────────────

/**
 * Verifica che la targa NON sia già presente in spots.
 * @param {object} spotsObj  — stato locale spots{}
 * @param {string} plate
 * @param {string|null} excludeSpotId  — posto da escludere (es. il posto corrente)
 * @returns {{ ok: boolean, msg: string }}
 */
export function checkVehicleNotDuplicate(spotsObj, plate, excludeSpotId = null) {
  const norm = (plate || '').trim().toUpperCase();
  for (const [id, data] of Object.entries(spotsObj)) {
    if (id === excludeSpotId) continue;
    if (data.occupied && data.plate && data.plate.toUpperCase() === norm) {
      return { ok: false, msg: `Il veicolo ${norm} è già al posto ${id}.` };
    }
  }
  return { ok: true, msg: '' };
}

/**
 * Verifica che un posto parcheggio sia libero.
 * @param {object} spotsObj
 * @param {string} spotId
 * @returns {{ ok: boolean, msg: string }}
 */
export function checkSpotFree(spotsObj, spotId) {
  const spot = spotsObj[spotId];
  if (!spot) return { ok: false, msg: `Posto ${spotId} non trovato.` };
  if (spot.occupied) return { ok: false, msg: `Il posto ${spotId} è già occupato da ${spot.plate || '?'}.` };
  return { ok: true, msg: '' };
}
