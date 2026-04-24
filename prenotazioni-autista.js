// ── prenotazioni-autista.js ───────────────────────────────────────────────────
// Gestione prenotazioni casse/container + missioni ribalta per autista (mobile)
// Dipende da: firebase-config.js, shared-utils.js

import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, where }
  from './firebase-config.js';
import { showToast, _esc, fmtDur } from './shared-utils.js';

let _unsubPren   = null;
let _unsubSpots  = null;
let _prenotazioni = [];
let _spots        = {};  // cache posti per vista casse
let _getUser;
let _getMode;

// Tiene traccia di quale card ha il form di completamento aperto
let _openCompletaId = null;

const RE_CASSA = /^\d{3}$/;

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

  // Listener posti per la vista casse
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

  // ── MODALITÀ CASSA: mostra posti occupati da casse piene ─────────────────
  if (mode === 'cassa') {
    _renderCasse(el);
    return;
  }

  // ── MODALITÀ CONTAINER: mostra prenotazioni container ────────────────────
  let lista = [..._prenotazioni];

  const missioni  = lista.filter(p => p.tipoMissione === 'ribalta' && p.stato === 'creata');
  const ordinarie = lista.filter(p => p.tipoMissione !== 'ribalta' && p.tipoMezzo === 'container');

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
    el.innerHTML = '<div class="emptyState">Nessuna prenotazione trovata.</div>';
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

// ── VISTA CASSE ──────────────────────────────────────────────────────────────
function _renderCasse(el) {
  const casseOccupate = Object.values(_spots).filter(s =>
    s.occupied && s.full && s.plate && RE_CASSA.test(s.plate.trim())
  );

  if (!casseOccupate.length) {
    el.innerHTML = '<div class="emptyState">Nessuna cassa piena al momento.</div>';
    return;
  }

  // Prenotazioni urgenti attive → set di plate
  const idUrgenti = new Set(
    _prenotazioni
      .filter(p => p.urgente && p.stato === 'creata')
      .map(p => p.plate)
  );

  // Ordine: urgenti prima, poi anzianità crescente
  casseOccupate.sort((a, b) => {
    const aUrg = idUrgenti.has(a.plate) ? 0 : 1;
    const bUrg = idUrgenti.has(b.plate) ? 0 : 1;
    if (aUrg !== bUrg) return aUrg - bUrg;
    const aTs = a.since ? (a.since.toDate ? a.since.toDate().getTime() : new Date(a.since).getTime()) : 0;
    const bTs = b.since ? (b.since.toDate ? b.since.toDate().getTime() : new Date(b.since).getTime()) : 0;
    return aTs - bTs;
  });

  let html = `<div class="prenGroupTitle">Casse piene (${casseOccupate.length})</div>`;

  casseOccupate.forEach((s, idx) => {
    const urgente  = idUrgenti.has(s.plate);
    const sinceTs  = s.since ? (s.since.toDate ? s.since.toDate() : new Date(s.since)) : null;
    const anzianita = sinceTs ? fmtDur(sinceTs) : '—';
    const sinceStr  = sinceTs
      ? sinceTs.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';

    html += `
      <div class="prenCard${urgente ? ' urgente' : ''}">
        <div class="prenHeader">
          <span class="prenPlate">${_esc(s.plate)}</span>
          <span style="font-size:12px;color:var(--muted);font-weight:600">#${idx + 1}</span>
        </div>
        ${urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}
        <div class="prenMeta">Posto: <strong>${_esc(s.id)}</strong> · ⏱ ${anzianita}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Entrata: ${sinceStr}</div>
        <div style="margin-top:6px">
          <span class="prenBadge creata">📦 Piena</span>
        </div>
      </div>`;
  });

  el.innerHTML = html;
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

  let btnHTML;
  if (completata) {
    // Mostra dove è stato posizionato il veicolo
    const dove = p.postoFine ? `<div style="font-size:12px;color:var(--accent2);margin-top:4px">📍 ${_esc(p.postoFine)}</div>` : '';
    btnHTML = `<span class="prenBadge completata" style="margin-top:8px;display:inline-block">✅ Completata</span>${dove}`;
  } else if (abilitato) {
    btnHTML = `
      <button class="btnCompleta" onclick="aprirCompletaForm('${p.id}')" style="margin-top:8px">
        ✅ Completa
      </button>
      <div class="completaForm" id="completaForm_${p.id}" style="display:none">
        <div class="cfTitle">Dove hai posizionato il veicolo?</div>
        <label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">Posto parcheggio o ribalta</label>
        <input class="cfInput" id="cfInput_${p.id}" type="text"
               placeholder="Es. A01 oppure R04"
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
      ${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}
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
  try {
    await updateDoc(doc(db, 'prenotazioni', id), {
      stato:        'completata',
      completataAt: serverTimestamp(),
      postoFine
    });
    _openCompletaId = null;
    showToast(`Completato → ${postoFine}`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

// Lasciato per compatibilità con eventuali chiamate dirette (es. completamente senza form)
export async function completaSingola(id) {
  window.aprirCompletaForm(id);
}

// ── UTILITY ───────────────────────────────────────────────────────────────────
function _parseDate(val) {
  if (!val) return null;
  if (val?.toDate) return val.toDate();
  return new Date(val);
}
