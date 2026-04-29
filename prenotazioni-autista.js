// ── prenotazioni-autista.js ───────────────────────────────────────────────────
// Gestione prenotazioni casse/container + missioni ribalta per autista (mobile)
// Dipende da: firebase-config.js, shared-utils.js

import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc, addDoc, serverTimestamp }
  from './firebase-config.js';
import { showToast, _esc, validateDestination, isValidSpot, isValidRibalta } from './shared-utils.js';

const RE_CASSA = /^\d{3}$/;

let _unsubPren   = null;
let _unsubSpots  = null;
let _prenotazioni = [];
let _spots        = {};   // cache posti per vista casse
let _getUser;
let _getMode;

// Tiene traccia di quale card ha il form di completamento aperto
let _openCompletaId = null;

export function initPrenotazioni({ getUser, getMode }) {
  _getUser = getUser;
  _getMode = getMode || (() => 'container');

  if (_unsubPren) _unsubPren();
  _unsubPren = onSnapshot(
    query(collection(db, 'prenotazioni'), orderBy('dataOra', 'desc')),
    snap => {
      _prenotazioni = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPrenotazioni();
    },
    err => console.error('Errore prenotazioni:', err)
  );

  // Listener spots per la vista casse (serve solo in modalità cassa ma lo teniamo attivo)
  if (_unsubSpots) _unsubSpots();
  _unsubSpots = onSnapshot(
    collection(db, 'spots'),
    snap => {
      _spots = {};
      snap.docs.forEach(d => { _spots[d.id] = { id: d.id, ...d.data() }; });
      renderPrenotazioni();
    },
    err => console.error('Errore spots:', err)
  );
}

export function stopPrenotazioni() {
  if (_unsubPren)  { _unsubPren();  _unsubPren  = null; }
  if (_unsubSpots) { _unsubSpots(); _unsubSpots = null; }
}

export function renderPrenotazioni() {
  const mode = _getMode ? _getMode() : 'container';
  const el   = document.getElementById('prenList');
  if (!el) return;

  // Missioni ribalta: mostrate sempre, in qualsiasi modalità
  const missioni = _prenotazioni.filter(p => p.tipoMissione === 'ribalta' && p.stato === 'creata');

  // ── MODALITÀ CASSA: mostra lista posti occupati da casse + eventuali missioni ─
  if (mode === 'cassa') {
    let html = '';
    if (missioni.length) {
      const sortFn = (a, b) => {
        if (a.urgente && !b.urgente) return -1;
        if (!a.urgente && b.urgente) return 1;
        return 0;
      };
      missioni.sort(sortFn);
      html += `<div class="prenGroupTitle" style="color:var(--orange)">🚛 Missioni ribalta (${missioni.length})</div>`;
      missioni.forEach(p => { html += _missioneCard(p); });
    }
    _renderCasse(el, html);
    return;
  }

  // ── MODALITÀ CONTAINER: mostra prenotazioni container + missioni ribalta ──
  const ordinarie = _prenotazioni.filter(p => p.tipoMissione !== 'ribalta' && (!p.tipoMezzo || p.tipoMezzo === 'container'));

  const sortFn = (a, b) => {
    if (a.urgente && !b.urgente) return -1;
    if (!a.urgente && b.urgente) return 1;
    const da  = a.dataOra?.toDate ? a.dataOra.toDate() : new Date(a.dataOra || 0);
    const db2 = b.dataOra?.toDate ? b.dataOra.toDate() : new Date(b.dataOra || 0);
    return da - db2;
  };

  ordinarie.sort(sortFn);
  missioni.sort(sortFn);

  const pendenti   = ordinarie.filter(p => p.stato === 'creata');
  const completate = ordinarie.filter(p => p.stato !== 'creata');

  if (!pendenti.length && !completate.length && !missioni.length) {
    el.innerHTML = '<div class="emptyState">Nessuna prenotazione container trovata.</div>';
    return;
  }

  const bloccoAttivo = Math.min(3, pendenti.length);
  let html = '';

  if (missioni.length) {
    html += `<div class="prenGroupTitle" style="color:var(--orange)">🚛 Missioni ribalta (${missioni.length})</div>`;
    missioni.forEach(p => { html += _missioneCard(p); });
  }
  if (pendenti.length) {
    html += `<div class="prenGroupTitle">Da movimentare (${pendenti.length})</div>`;
    pendenti.forEach((p, idx) => { html += _prenCard(p, idx < bloccoAttivo, idx); });
  }
  if (completate.length) {
    html += `<div class="prenGroupTitle" style="margin-top:14px">Completate (${completate.length})</div>`;
    completate.forEach(p => { html += _prenCard(p, false, -1); });
  }

  el.innerHTML = html;

  if (_openCompletaId) {
    const form = document.getElementById('completaForm_' + _openCompletaId);
    if (form) form.style.display = 'block';
  }
}

// ── VISTA CASSE ───────────────────────────────────────────────────────────────
function _renderCasse(el, htmlPrefix = '') {
  // Posti occupati da casse (plate = 3 cifre + full = true)
  const casseOccupate = Object.values(_spots).filter(s =>
    s.occupied && s.full && s.plate && RE_CASSA.test(s.plate.trim())
  );

  if (!casseOccupate.length) {
    el.innerHTML = htmlPrefix + '<div class="emptyState">Nessuna cassa piena al momento.</div>';
    return;
  }

  // Urgenti: prenotazioni attive con quella plate
  const idUrgenti = new Set(
    _prenotazioni.filter(p => p.urgente && p.stato === 'creata').map(p => p.plate)
  );

  // Ordine: urgenti prima, poi anzianità (since crescente)
  casseOccupate.sort((a, b) => {
    const aUrg = idUrgenti.has(a.plate) ? 0 : 1;
    const bUrg = idUrgenti.has(b.plate) ? 0 : 1;
    if (aUrg !== bUrg) return aUrg - bUrg;
    const aTs = _tsVal(a.since);
    const bTs = _tsVal(b.since);
    return aTs - bTs;
  });

  let html = htmlPrefix + `<div class="prenGroupTitle">Casse parcheggiate (${casseOccupate.length})</div>`;
  casseOccupate.forEach((s, idx) => {
    const urgente   = idUrgenti.has(s.plate);
    const sinceTs   = s.since ? (s.since.toDate ? s.since.toDate() : new Date(s.since)) : null;
    const anzianita = sinceTs ? _fmtAnzianita(sinceTs) : '—';
    const sinceStr  = sinceTs
      ? sinceTs.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';
    const rankClass = idx < 3 ? 'cassa-rank top' : 'cassa-rank';

    html += `
      <div class="casseCard${urgente ? ' urgente' : ''}">
        <div class="casseCardHeader">
          <span class="${rankClass}">${idx + 1}</span>
          <span class="casseCardPlate">${_esc(s.plate)}</span>
          <span class="casseCardPosto">${_esc(s.id)}</span>
          ${urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}
        </div>
        <div class="casseCardMeta" title="Entrata: ${sinceStr}">⏱ ${anzianita}</div>
      </div>`;
  });

  el.innerHTML = html;
}

function _tsVal(since) {
  if (!since) return 0;
  if (since.toDate) return since.toDate().getTime();
  return new Date(since).getTime();
}

function _fmtAnzianita(date) {
  const ms = Date.now() - date.getTime();
  const m  = Math.floor(ms / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'min';
  return Math.floor(h / 24) + 'g ' + (h % 24) + 'h';
}

// ── CARD MISSIONE RIBALTA ────────────────────────────────────────────────────
function _missioneCard(p) {
  const d = _parseDate(p.dataOra);
  const dataStr = d ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const statoVeicolo = p.fullAllaLibera ? '🟡 Piena' : '🟢 Vuota';

  return `
    <div class="missioneCard">
      <div class="missioneTitle">🚛 Sposta veicolo da ribalta ${_esc(p.spotId || '—')}</div>
      <div class="missioneBody">
        <strong>${_esc(p.plate || '—')}</strong> · ${statoVeicolo} · ${dataStr}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${_esc(p.note || '')}</div>
      <button class="btnCompleta" onclick="aprirCompletaMissione('${p.id}')" style="margin-top:10px">
        ✅ Completa missione
      </button>
      <div class="completaForm" id="completaForm_${p.id}" style="display:none">
        <div class="cfTitle">Dove hai posizionato il veicolo?</div>
        <label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">Posto parcheggio / Ribalta destinazione</label>
        <input class="cfInput" id="cfInput_${p.id}" type="text"
               placeholder="Es. A01 oppure R04"
               oninput="this.value=this.value.toUpperCase()">
        <div class="cfActions">
          <button class="btnCfConfirm" onclick="confermaMissione('${p.id}')">✓ Conferma</button>
          <button class="btnCfCancel"  onclick="chiudiCompletaForm('${p.id}')">Annulla</button>
        </div>
      </div>
    </div>`;
}

// ── CARD PRENOTAZIONE ORDINARIA ───────────────────────────────────────────────
function _prenCard(p, abilitato, idx) {
  const d = _parseDate(p.dataOra);
  const dataStr = d
    ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';
  const completata = p.stato !== 'creata';

  const bloccatoNote = (!completata && !abilitato && idx >= 3)
    ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic">🔒 Disponibile dopo il completamento delle prime 3</div>`
    : '';

  // Bottone urgente: visibile a tutti come badge, modificabile solo da amministrativi/amministratori
  const user = _getUser ? _getUser() : null;
  const canSetUrgent = user && ['amministrativo', 'amministratore'].includes(user.role);
  const urgenteHtml = p.urgente
    ? (canSetUrgent
        ? `<button class="urgBadge" style="cursor:pointer;border:none;background:#ef444413;border:1px solid #ef444430;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;color:var(--red);margin-bottom:6px;display:inline-block" onclick="toggleUrgentePrenotazione('${p.id}',false)">🚨 URGENTE · rimuovi</button>`
        : `<span class="urgBadge">🚨 URGENTE</span>`)
    : (canSetUrgent && !completata
        ? `<button style="cursor:pointer;border:1.5px solid var(--border);background:transparent;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;display:inline-block" onclick="toggleUrgentePrenotazione('${p.id}',true)">☆ Segna urgente</button>`
        : '');

  let btnHTML;
  if (completata) {
    const dove = p.postoFine ? `<div style="font-size:12px;color:var(--accent2);margin-top:4px">📍 ${_esc(p.postoFine)}</div>` : '';
    btnHTML = `<span class="prenBadge completata" style="margin-top:8px;display:inline-block">✅ Completata</span>${dove}`;
  } else if (abilitato) {
    btnHTML = `
      <button class="btnCompleta" onclick="aprirCompletaForm('${p.id}')" style="margin-top:8px">
        ✅ Completa
      </button>
      <div class="completaForm" id="completaForm_${p.id}" style="display:none">
        <div class="cfTitle">Dove hai posizionato il veicolo?</div>
        <label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">Posto parcheggio (es. A01) o ribalta (es. PNT1-07)</label>
        <input class="cfInput" id="cfInput_${p.id}" type="text"
               placeholder="Es. A01 oppure PNT1-07"
               oninput="this.value=this.value.toUpperCase()"
               onkeydown="if(event.key==='Enter')confermaCompletamento('${p.id}')">
        <div class="cfActions">
          <button class="btnCfConfirm" onclick="confermaCompletamento('${p.id}')">✓ Conferma</button>
          <button class="btnCfCancel"  onclick="chiudiCompletaForm('${p.id}')">Annulla</button>
        </div>
      </div>`;
  } else {
    btnHTML = `
      <button disabled style="width:100%;margin-top:8px;padding:11px 0;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;color:var(--muted);font-family:inherit;font-size:13px;font-weight:700;cursor:not-allowed;opacity:.6">
        🔒 In attesa
      </button>`;
  }

  return `
    <div class="prenCard${p.urgente ? ' urgente' : ''}">
      <div class="prenHeader">
        <span class="prenPlate">${_esc(p.plate || '—')}</span>
        ${p.stato === 'creata'
          ? '<span class="prenBadge creata">In attesa</span>'
          : '<span class="prenBadge completata">Completata</span>'}
      </div>
      ${urgenteHtml}
      <div class="prenDest">→ ${_esc(p.destinazione || '—')}</div>
      <div class="prenMeta">Posto: ${_esc(p.spotId || '—')} · ${dataStr}</div>
      ${bloccatoNote}
      ${btnHTML}
    </div>`;
}

// ── LOGICA FORM COMPLETAMENTO ─────────────────────────────────────────────────
window.aprirCompletaForm = function(id) {
  // Chiudi eventuale form già aperto
  if (_openCompletaId && _openCompletaId !== id) {
    chiudiCompletaForm(_openCompletaId);
  }
  _openCompletaId = id;
  const form = document.getElementById('completaForm_' + id);
  if (form) {
    form.style.display = 'block';
    setTimeout(() => document.getElementById('cfInput_' + id)?.focus(), 80);
  }
};

window.aprirCompletaMissione = window.aprirCompletaForm;

window.chiudiCompletaForm = function(id) {
  const form = document.getElementById('completaForm_' + id);
  if (form) form.style.display = 'none';
  if (_openCompletaId === id) _openCompletaId = null;
};

window.confermaCompletamento = async function(id) {
  const input = document.getElementById('cfInput_' + id);
  const posto = input?.value.trim().toUpperCase();
  if (!posto) { showToast('Inserisci il posto o la ribalta', 'error'); return; }
  await _completaConPosto(id, posto);
};

window.confermaMissione = window.confermaCompletamento;

async function _completaConPosto(id, postoFine) {
  // Validazione formato destinazione
  const destCheck = validateDestination(postoFine);
  if (!destCheck.ok) { showToast(destCheck.msg, 'error'); return; }

  const pren = _prenotazioni.find(p => p.id === id);

  try {
    const ops = [];

    // Aggiorna la prenotazione
    ops.push(updateDoc(doc(db, 'prenotazioni', id), {
      stato:        'completata',
      completataAt: serverTimestamp(),
      postoFine
    }));

    if (pren) {
      const origine = (pren.spotId || '').trim().toUpperCase();
      const dest    = postoFine.trim().toUpperCase();

      // Libera l'origine
      if (isValidSpot(origine)) {
        ops.push(setDoc(doc(db, 'spots', origine), {
          occupied: false, plate: null, since: null, user: null, full: false
        }, { merge: true }));
      } else if (isValidRibalta(origine)) {
        ops.push(setDoc(doc(db, 'ribalte', origine), {
          occupied: false, plate: null, since: null, user: null
        }, { merge: true }));
      }

      // Occupa la destinazione
      if (isValidSpot(dest)) {
        ops.push(setDoc(doc(db, 'spots', dest), {
          occupied: true,
          plate:    pren.plate || null,
          since:    serverTimestamp(),
          user:     pren.utenteEmail || null,
        }, { merge: true }));
      } else if (isValidRibalta(dest)) {
        ops.push(setDoc(doc(db, 'ribalte', dest), {
          occupied: true,
          plate:    pren.plate || null,
          since:    serverTimestamp(),
          user:     pren.utenteEmail || null,
        }, { merge: true }));
      }

      // Storico
      ops.push(addDoc(collection(db, 'history'), {
        ts:          serverTimestamp(),
        spot:        dest,
        action:      'Missione completata',
        plate:       pren.plate || null,
        user:        pren.utenteEmail || null,
        origine,
        destinazione: dest,
      }));
    }

    await Promise.all(ops);
    _openCompletaId = null;
    showToast(`Completato: ${pren?.spotId || '?'} → ${postoFine}`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

// Lasciato per compatibilità con eventuali chiamate dirette (es. completamente senza form)
export async function completaSingola(id) {
  window.aprirCompletaForm(id);
}

// ── TOGGLE URGENTE (solo amministrativi/amministratori) ───────────────────────
window.toggleUrgentePrenotazione = async function(id, newVal) {
  const user = _getUser ? _getUser() : null;
  if (!user || !['amministrativo', 'amministratore'].includes(user.role)) {
    showToast('Non hai i permessi per gestire le urgenze.', 'error');
    return;
  }
  try {
    await updateDoc(doc(db, 'prenotazioni', id), { urgente: newVal });
    showToast(newVal ? '⚡ Urgenza impostata.' : 'Urgenza rimossa.', 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

// ── UTILITY ───────────────────────────────────────────────────────────────────
function _parseDate(val) {
  if (!val) return null;
  if (val?.toDate) return val.toDate();
  return new Date(val);
}
