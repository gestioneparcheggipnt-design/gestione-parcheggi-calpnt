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
