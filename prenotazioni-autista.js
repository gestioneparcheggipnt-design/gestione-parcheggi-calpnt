import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── prenotazioni-autista.js ───────────────────────────────────────────────────

// Gestione prenotazioni casse/container + missioni ribalta per autista (mobile)

// Dipende da: firebase-config.js, shared-utils.js

// getDestinazioniPerReparto è esposta su window da mobile.html (importata da spots-data-mobile.js)
function getDestinazioniPerReparto(reparto) {
  return window.getDestinazioniPerReparto ? window.getDestinazioniPerReparto(reparto) : [];
}

import { showToast, _esc } from './shared-utils.js';

// ── Validazioni locali (le versioni in shared-utils.js richiedono 2 argomenti) ─
function _tutteRibalte() {
  return window._REPARTI
    ? Object.values(window._REPARTI).flat().map(r => String(r).trim().toUpperCase())
    : [];
}
function isValidRibalta(id) {
  if (!id) return false;
  return _tutteRibalte().includes(String(id).trim().toUpperCase());
}
function isValidSpot(id) {
  if (!id) return false;
  const k = String(id).trim().toUpperCase();
  if (_spots && _spots[k]) return true;
  return Array.isArray(window.SPOT_DEFS) &&
         window.SPOT_DEFS.some(d => String(d[0]).trim().toUpperCase() === k);
}
function validateDestination(dest) {
  const d = (dest || '').trim().toUpperCase();
  if (!d) return { ok: false, msg: 'Inserisci il posto o la ribalta.' };
  if (isValidSpot(d) || isValidRibalta(d)) return { ok: true, dest: d };
  return { ok: false, msg: `Destinazione "${d}" non valida.` };
}

const RE_CASSA = /^\d{3}$/;

// ── Helper ribalte libere ──────────────────────────────────────────────────────
// Restituisce ribalte libere filtrate per reparto (null = tutte).
// Esclude anche quelle impegnate in prenotazioni aperte.
function _ribalteLiberePerReparto(reparto, escludiPrenId = null) {
  // Ribalte fisicamente occupate in Firestore
  const occupate = new Set(
    Object.values(_ribalte).filter(r => r.occupied).map(r => r.id)
  );
  // Ribalte impegnate in prenotazioni aperte (esclusa quella corrente)
  _prenotazioni
    .filter(p => p.stato === 'creata' && p.destinazione && p.id !== escludiPrenId)
    .forEach(p => occupate.add(p.destinazione.trim().toUpperCase()));

  // Lista completa delle destinazioni (da _REPARTI, non da _ribalte)
  let tutte;
  if (reparto && window._REPARTI && window._REPARTI[reparto]) {
    tutte = window._REPARTI[reparto];
  } else if (!reparto) {
    tutte = window._REPARTI
      ? Object.values(window._REPARTI).flat()
      : [];
  } else {
    tutte = window._REPARTI ? Object.values(window._REPARTI).flat() : [];
  }

  return tutte
    .filter(id => !occupate.has(id))
    .map(id => ({ id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Stili inline condivisi
const _S = {
  ribaltaBtn: 'display:inline-block;margin:3px;padding:7px 13px;border-radius:8px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer',
  ribaltaBtnSel: 'display:inline-block;margin:3px;padding:7px 13px;border-radius:8px;border:1.5px solid var(--accent);background:var(--accent);color:#1C1F26;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer',
  navBtn: 'padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;margin:3px',
  navBtnSel: 'padding:6px 14px;border-radius:8px;border:2px solid var(--accent);background:var(--accent);color:#1C1F26;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin:3px',
  sectionLabel: 'font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 5px',
  undoBar: 'margin-top:10px;padding:10px 12px;background:var(--surface2);border-radius:9px;border:1px solid var(--border)',
};

let _unsubPren = null;

let _unsubSpots = null;

let _unsubRibalte = null;

let _prenotazioni = [];

let _spots = {};

let _ribalte = {}; // cache ribalte per popup selezione

let _getUser;

let _getMode;

let _openCompletaId = null;

export function initPrenotazioni({ getUser, getMode }) {

_getUser = getUser;

_getMode = getMode || (() => 'container');

if (_unsubPren) _unsubPren();

_unsubPren = onSnapshot(

query(collection(window.db, 'prenotazioni'), orderBy('dataOra', 'desc')),

snap => {

_prenotazioni = snap.docs.map(d => ({ id: d.id, ...d.data() }));

renderPrenotazioni();

},

err => console.error('Errore prenotazioni:', err)

);

if (_unsubSpots) _unsubSpots();

_unsubSpots = onSnapshot(

collection(window.db, 'spots'),

snap => {

_spots = {};

snap.docs.forEach(d => { _spots[d.id] = { id: d.id, ...d.data() }; });

renderPrenotazioni();

},

err => console.error('Errore spots:', err)

);

if (_unsubRibalte) _unsubRibalte();

_unsubRibalte = onSnapshot(

collection(window.db, 'ribalte'),

snap => {

_ribalte = {};

snap.docs.forEach(d => { _ribalte[d.id] = { id: d.id, ...d.data() }; });

},

err => console.error('Errore ribalte:', err)

);

}

export function stopPrenotazioni() {

if (_unsubPren) { _unsubPren(); _unsubPren = null; }

if (_unsubSpots) { _unsubSpots(); _unsubSpots = null; }

if (_unsubRibalte) { _unsubRibalte(); _unsubRibalte = null; }

}

export function renderPrenotazioni() {

const mode = _getMode ? _getMode() : 'container';

const el = document.getElementById('prenList');

if (!el) return;

// Missioni ribalta: mostrate sempre, in qualsiasi modalità

const missioni = _prenotazioni.filter(p => p.tipoMissione === 'ribalta' && p.stato === 'creata');

// ── MODALITÀ CASSA ────────────────────────────────────────────────────────────

if (mode === 'cassa') {

let html = '';

if (missioni.length) {

const sortFn = (a, b) => {

if (a.urgente && !b.urgente) return -1;

if (!a.urgente && b.urgente) return 1;

const da = a.dataOra?.toDate ? a.dataOra.toDate() : new Date(a.dataOra || 0);

const db2 = b.dataOra?.toDate ? b.dataOra.toDate() : new Date(b.dataOra || 0);

return da - db2;

};

missioni.sort(sortFn);

html += `<div class="prenGroupTitle" style="color:var(--orange)">🚛 Missioni ribalta (${missioni.length})</div>`;

missioni.forEach((p, idx) => { html += _missioneCard(p, idx < 3); });

}

_renderCasse(el, html);

return;

}

// ── MODALITÀ CONTAINER ────────────────────────────────────────────────────────

const ordinarie = _prenotazioni.filter(p => p.tipoMissione !== 'ribalta' && (!p.tipoMezzo || p.tipoMezzo === 'container'));

const sortFn = (a, b) => {

if (a.urgente && !b.urgente) return -1;

if (!a.urgente && b.urgente) return 1;

const da = a.dataOra?.toDate ? a.dataOra.toDate() : new Date(a.dataOra || 0);

const db2 = b.dataOra?.toDate ? b.dataOra.toDate() : new Date(b.dataOra || 0);

return da - db2;

};

ordinarie.sort(sortFn);

missioni.sort(sortFn);

const pendenti = ordinarie.filter(p => p.stato === 'creata');

// Completate: solo quelle delle ultime 2 ore (basato su completataAt)

const due_ore_fa = Date.now() - 2 * 60 * 60 * 1000;

const completate = ordinarie.filter(p => {

if (p.stato === 'creata') return false;

const completataAt = p.completataAt?.toDate

? p.completataAt.toDate()

: (p.completataAt ? new Date(p.completataAt) : null);

if (!completataAt) return false;

return completataAt.getTime() >= due_ore_fa;

});

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

html += `<div class="prenGroupTitle">DA MOVIMENTARE (${pendenti.length})</div>`;

pendenti.forEach((p, idx) => { html += _prenCard(p, idx < bloccoAttivo, idx); });

}

if (completate.length) {

html += `<div class="prenGroupTitle" style="margin-top:14px">COMPLETATE (${completate.length})</div>`;

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

const casseOccupate = Object.values(_spots).filter(s =>

s.occupied && s.full && s.plate && RE_CASSA.test(s.plate.trim())

);

if (!casseOccupate.length) {

el.innerHTML = htmlPrefix + '<div class="emptyState">Nessuna cassa piena al momento.</div>';

return;

}

casseOccupate.sort((a, b) => _tsVal(a.since) - _tsVal(b.since));

const BLOCCO = 3;

let html = htmlPrefix + `<div class="prenGroupTitle">Casse parcheggiate (${casseOccupate.length})</div>`;

casseOccupate.forEach((s, idx) => {

const sinceTs = s.since ? (s.since.toDate ? s.since.toDate() : new Date(s.since)) : null;

const anzianita = sinceTs ? _fmtAnzianita(sinceTs) : '—';

const sinceStr = sinceTs

? sinceTs.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })

: '—';

const rankClass = idx < BLOCCO ? 'cassa-rank top' : 'cassa-rank';

const abilitato = idx < BLOCCO;

let completaBtn = '';

if (abilitato) {

completaBtn = `<button class="btnCompletaOrange" onclick="aprirCompletaCassa('${_esc(s.id)}','${_esc(s.plate)}','cassa_${_esc(s.id)}')">✅ Completa missione</button>
<div id="cfCassa_cassa_${_esc(s.id)}" style="display:none"></div>
<div id="cfCassaUndo_cassa_${_esc(s.id)}" style="display:none"></div>`;

} else {

completaBtn = `<button disabled class="btnBlocco">🔒 In attesa</button>`;

}

const cardClass = abilitato ? 'casseCard pendente' : 'casseCard bloccata';

html += `

<div class="${cardClass}">

<div class="casseCardTop">

<span class="${rankClass}">${idx + 1}</span>

<span class="casseCardPlate">${_esc(s.plate)}</span>

</div>

<div class="casseCardRoute">

<span class="casseCardPosto">${_esc(s.id)}</span>

<span class="casseCardArrow">→</span>

<span class="casseCardDest">Ribalta</span>

</div>

<div class="casseCardMeta" title="Entrata: ${sinceStr}">⏱ ${anzianita}</div>

${completaBtn}

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

const m = Math.floor(ms / 60000);

if (m < 60) return m + ' min';

const h = Math.floor(m / 60);

if (h < 24) return h + 'h ' + (m % 60) + 'min';

return Math.floor(h / 24) + 'g ' + (h % 24) + 'h';

}

// ── CARD MISSIONE RIBALTA ────────────────────────────────────────────────────

function _missioneCard(p, abilitato = true) {

const d = _parseDate(p.dataOra);

const dataStr = d ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

const statoVeicolo = p.fullAllaLibera ? '🟡 Piena' : '🟢 Vuota';

const btnHTML = abilitato
? `<button class="btnCompleta" onclick="aprirCompletaMissione('${p.id}')" style="margin-top:10px">✅ Completa missione</button>
<div class="completaForm" id="completaForm_${p.id}" style="display:none">
  <div data-step="picker" id="cfStep_${p.id}">
    ${_buildContainerPicker(p)}
  </div>
  <div data-step="undo" id="cfUndo_${p.id}" style="display:none"></div>
</div>`
: `<button disabled style="width:100%;margin-top:8px;padding:11px 0;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;color:var(--muted);font-family:inherit;font-size:13px;font-weight:700;cursor:not-allowed;opacity:.6">🔒 In attesa</button>
<div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">Disponibile dopo il completamento delle prime 3</div>`;

return `

<div class="missioneCard">

<div class="missioneTitle">🚛 Sposta veicolo da ribalta ${_esc(p.spotId || '—')}</div>

<div class="missioneBody">

<strong>${_esc(p.plate || '—')}</strong> · ${statoVeicolo} · ${dataStr}

</div>

<div style="font-size:12px;color:var(--muted);margin-top:4px">${_esc(p.note || '')}</div>

${btnHTML}

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

const dove = p.postoFine ? `<div class="pcmDove">📍 ${_esc(p.postoFine)}</div>` : '';

btnHTML = `${dove}`;

} else if (abilitato) {

btnHTML = `
<button class="btnCompletaOrange" onclick="aprirCompletaForm('${p.id}')">✅ Completa</button>
<div class="completaForm" id="completaForm_${p.id}" style="display:none">
  <div data-step="picker" id="cfStep_${p.id}">
    ${_buildContainerPicker(p)}
  </div>
  <div data-step="undo" id="cfUndo_${p.id}" style="display:none"></div>
</div>`;

} else {

btnHTML = `

<button disabled class="btnBlocco">

🔒 In attesa

</button>`;

}

const cardClass = completata

? 'prenCardMissione completata'

: (p.urgente ? 'prenCardMissione pendente urgente' : 'prenCardMissione pendente');

return `

<div class="${cardClass}">

<div class="pcmHeader">

<span class="pcmPlate">${_esc(p.plate || '—')}</span>

${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}

<span class="pcmStatoBadge ${completata ? 'completata' : 'creata'}">${completata ? '✅ Completata' : 'In attesa'}</span>

</div>

${urgenteHtml && !p.urgente ? urgenteHtml : ''}

<div class="pcmRoute">

<span class="pcmSpot">${_esc(p.spotId || '—')}</span>

<span class="pcmArrow">→</span>

<span class="pcmDest">${_esc(p.destinazione || '—')}</span>

</div>

<div class="pcmMeta">${dataStr}</div>

${bloccatoNote}

${btnHTML}

</div>`;

}

// ── BUILD PICKER CONTAINER ────────────────────────────────────────────────────

function _buildContainerPicker(p) {
  const destSuggerita = (p.destinazione || '').trim().toUpperCase();
  const reparto = p.utenteReparto || null;
  const ribalteLibere = _ribalteLiberePerReparto(reparto, p.id);
  const isSuggeritaLibera = destSuggerita && ribalteLibere.some(r => r.id === destSuggerita);

  let html = `<div style="${_S.sectionLabel}">Ribalta destinazione</div>`;

  if (destSuggerita) {
    const style = isSuggeritaLibera ? _S.ribaltaBtn : 'display:inline-block;margin:3px;padding:7px 13px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--muted);font-family:inherit;font-size:13px;font-weight:700;cursor:not-allowed;text-decoration:line-through';
    const label = isSuggeritaLibera ? `📍 ${destSuggerita}` : `📍 ${destSuggerita} (non disponibile)`;
    const onclick = isSuggeritaLibera ? `onclick="confermaPicker('${p.id}','${destSuggerita}')"` : '';
    html += `<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">Ribalta richiesta:</div>
      <button style="${style}" ${onclick}>${label}</button></div>`;
  }

  html += `<div><button style="${_S.navBtn}" onclick="_espandiAltreRibalte('${p.id}','${reparto || ''}')">🔀 Altra ribalta</button></div>`;
  html += `<div id="altreRibalte_${p.id}" style="display:none"></div>`;
  html += `<button style="margin-top:8px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:12px;cursor:pointer" onclick="chiudiCompletaForm('${p.id}')">Annulla</button>`;
  return html;
}

window._espandiAltreRibalte = function(prenId, reparto) {
  const wrap = document.getElementById('altreRibalte_' + prenId);
  if (!wrap) return;
  const rep = reparto || null;
  const libere = _ribalteLiberePerReparto(rep);
  if (!libere.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-top:6px">Nessuna ribalta libera disponibile</div>';
  } else {
    // Raggruppa per edificio
    const pnt1 = libere.filter(r => r.id.startsWith('PNT1-'));
    const pnt2 = libere.filter(r => r.id.startsWith('PNT2-'));
    let h = `<div style="${_S.sectionLabel};margin-top:10px">Seleziona edificio:</div>`;
    if (pnt1.length) h += `<button style="${_S.navBtn}" onclick="_mostraRibalteEdificio('${prenId}','PNT1','${rep || ''}')">🏭 PNT1 (${pnt1.length})</button>`;
    if (pnt2.length) h += `<button style="${_S.navBtn}" onclick="_mostraRibalteEdificio('${prenId}','PNT2','${rep || ''}')">🏭 PNT2 (${pnt2.length})</button>`;
    h += `<div id="altreRibalteList_${prenId}"></div>`;
    wrap.innerHTML = h;
  }
  wrap.style.display = 'block';
};

window._mostraRibalteEdificio = function(prenId, edificio, reparto) {
  const wrap = document.getElementById('altreRibalteList_' + prenId);
  if (!wrap) return;
  const rep = reparto || null;
  const libere = _ribalteLiberePerReparto(rep).filter(r => r.id.startsWith(edificio + '-'));

  // Raggruppa per reparto usando window._REPARTI
  const repartiMap = {};
  libere.forEach(r => {
    let found = 'Altro';
    if (window._REPARTI) {
      for (const [nome, ids] of Object.entries(window._REPARTI)) {
        if (ids.includes(r.id)) { found = nome; break; }
      }
    }
    if (!repartiMap[found]) repartiMap[found] = [];
    repartiMap[found].push(r);
  });

  let h = `<div style="${_S.sectionLabel}">Reparto — ${edificio}:</div>`;
  Object.entries(repartiMap).forEach(([nome, rs]) => {
    h += `<button style="${_S.navBtn}" onclick="_mostraRibalteReparto('${prenId}','${nome}','${edificio}','${rep || ''}')">
      ${nome} (${rs.length})</button>`;
  });
  wrap.innerHTML = h;
};

window._mostraRibalteReparto = function(prenId, repartoNome, edificio, repartoFiltro) {
  const wrap = document.getElementById('altreRibalteList_' + prenId);
  if (!wrap) return;
  const rep = repartoFiltro || null;
  const libere = _ribalteLiberePerReparto(rep)
    .filter(r => r.id.startsWith(edificio + '-'))
    .filter(r => {
      if (!window._REPARTI || !window._REPARTI[repartoNome]) return true;
      return window._REPARTI[repartoNome].includes(r.id);
    });

  let h = `<button style="${_S.navBtn}" onclick="_mostraRibalteEdificio('${prenId}','${edificio}','${rep || ''}')" >← Indietro</button>`;
  h += `<div style="${_S.sectionLabel}">${repartoNome}:</div>`;
  h += `<div style="display:flex;flex-wrap:wrap">`;
  libere.forEach(r => {
    h += `<button style="${_S.ribaltaBtn}" onclick="confermaPicker('${prenId}','${r.id}')">${r.id}</button>`;
  });
  h += '</div>';
  wrap.innerHTML = h;
};

// ── BUILD PICKER CASSE (inline, edificio > reparto > ribalte) ─────────────────

window.aprirCompletaCassa = function(spotId, plate, key) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  wrap.style.display = 'block';
  _renderCassaEdifici(spotId, plate, key);
};

function _renderCassaEdifici(spotId, plate, key) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  const libere = _ribalteLiberePerReparto(null);
  const pnt1 = libere.filter(r => r.id.startsWith('PNT1-'));
  const pnt2 = libere.filter(r => r.id.startsWith('PNT2-'));

  let h = `<div style="${_S.sectionLabel}">Seleziona edificio:</div>`;
  if (pnt1.length) h += `<button style="${_S.navBtn}" onclick="_renderCassaReparti('${spotId}','${plate}','${key}','PNT1')">🏭 PNT1 (${pnt1.length})</button>`;
  if (pnt2.length) h += `<button style="${_S.navBtn}" onclick="_renderCassaReparti('${spotId}','${plate}','${key}','PNT2')">🏭 PNT2 (${pnt2.length})</button>`;
  if (!pnt1.length && !pnt2.length) h += '<div style="font-size:12px;color:var(--muted);margin-top:6px">Nessuna ribalta libera</div>';
  wrap.innerHTML = h;
}

window._renderCassaReparti = function(spotId, plate, key, edificio) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  const libere = _ribalteLiberePerReparto(null).filter(r => r.id.startsWith(edificio + '-'));

  const repartiMap = {};
  libere.forEach(r => {
    let found = 'Altro';
    if (window._REPARTI) {
      for (const [nome, ids] of Object.entries(window._REPARTI)) {
        if (ids.includes(r.id)) { found = nome; break; }
      }
    }
    if (!repartiMap[found]) repartiMap[found] = [];
    repartiMap[found].push(r);
  });

  let h = `<button style="${_S.navBtn}" onclick="_renderCassaEdifici('${spotId}','${plate}','${key}')">← Indietro</button>`;
  h += `<div style="${_S.sectionLabel}">Reparto — ${edificio}:</div>`;
  Object.entries(repartiMap).forEach(([nome, rs]) => {
    h += `<button style="${_S.navBtn}" onclick="_renderCassaRibalte('${spotId}','${plate}','${key}','${nome}','${edificio}')">
      ${nome} (${rs.length})</button>`;
  });
  wrap.innerHTML = h;
};

window._renderCassaRibalte = function(spotId, plate, key, repartoNome, edificio) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  const libere = _ribalteLiberePerReparto(null)
    .filter(r => r.id.startsWith(edificio + '-'))
    .filter(r => !window._REPARTI || !window._REPARTI[repartoNome] || window._REPARTI[repartoNome].includes(r.id));

  let h = `<button style="${_S.navBtn}" onclick="_renderCassaReparti('${spotId}','${plate}','${key}','${edificio}')">← Indietro</button>`;
  h += `<div style="${_S.sectionLabel}">${repartoNome}:</div>`;
  h += '<div style="display:flex;flex-wrap:wrap">';
  libere.forEach(r => {
    h += `<button style="${_S.ribaltaBtn}" onclick="confermaCassaPicker('${spotId}','${plate}','${key}','${r.id}')">${r.id}</button>`;
  });
  h += '</div>';
  wrap.innerHTML = h;
};

// ── UNDO TIMER ─────────────────────────────────────────────────────────────────
const _undoTimers = {}; // { [key]: timeoutId }

// Mostra barra undo (4 sec) poi esegue l'azione
function _avviaUndo(key, ribaltaId, labelBox, eseguiCb) {
  if (_undoTimers[key]) clearTimeout(_undoTimers[key]);

  const undoEl = document.getElementById(key.startsWith('cassa_') ? 'cfCassaUndo_' + key : 'cfUndo_' + key);
  if (!undoEl) { eseguiCb(); return; }

  // Nascondi picker
  const pickerEl = document.getElementById(key.startsWith('cassa_') ? 'cfCassa_' + key : 'cfStep_' + key);
  if (pickerEl) pickerEl.style.display = 'none';

  undoEl.style.display = 'block';
  let sec = 4;
  const render = () => {
    undoEl.innerHTML = `<div style="${_S.undoBar}">
      <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:6px">✅ ${ribaltaId} selezionata</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Conferma automatica tra ${sec}s…</div>
      <button style="padding:7px 16px;border-radius:8px;border:1.5px solid var(--red);background:transparent;color:var(--red);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer"
        onclick="_annullaUndo('${key}','${labelBox}')">✏️ Modifica</button>
    </div>`;
  };
  render();
  const tick = setInterval(() => { sec--; if (sec > 0) render(); else clearInterval(tick); }, 1000);
  _undoTimers[key] = setTimeout(() => {
    clearInterval(tick);
    undoEl.innerHTML = '';
    undoEl.style.display = 'none';
    eseguiCb();
  }, 4000);
  // salva tick per poterlo cancellare
  _undoTimers[key + '_tick'] = tick;
}

window._annullaUndo = function(key, labelBox) {
  if (_undoTimers[key]) { clearTimeout(_undoTimers[key]); delete _undoTimers[key]; }
  if (_undoTimers[key + '_tick']) { clearInterval(_undoTimers[key + '_tick']); }
  const undoEl = document.getElementById(key.startsWith('cassa_') ? 'cfCassaUndo_' + key : 'cfUndo_' + key);
  if (undoEl) { undoEl.style.display = 'none'; undoEl.innerHTML = ''; }
  // Ri-mostra il picker
  if (key.startsWith('cassa_')) {
    const cfEl = document.getElementById('cfCassa_' + key);
    if (cfEl) cfEl.style.display = 'block';
  } else {
    const stepEl = document.getElementById('cfStep_' + key);
    if (stepEl) stepEl.style.display = 'block';
  }
};

// Click ribalta container → undo → _completaConPosto
window.confermaPicker = function(prenId, ribaltaId) {
  _avviaUndo(prenId, ribaltaId, ribaltaId, () => _completaConPosto(prenId, ribaltaId));
};

// Click ribalta cassa → undo → selezionaRibalta_cassa
window.confermaCassaPicker = function(spotId, plate, key, ribaltaId) {
  _avviaUndo(key, ribaltaId, ribaltaId, () => {
    const user = _getUser ? _getUser() : null;
    selezionaRibalta_cassa_exec(spotId, plate, ribaltaId, user);
  });
};

// ── LOGICA FORM COMPLETAMENTO ─────────────────────────────────────────────────

window.aprirCompletaForm = function(id) {

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

const destCheck = validateDestination(postoFine);

if (!destCheck.ok) { showToast(destCheck.msg, 'error'); return; }

const pren = _prenotazioni.find(p => p.id === id);

try {

const ops = [];

ops.push(updateDoc(doc(window.db, 'prenotazioni', id), {

stato: 'completata',

completataAt: serverTimestamp(),

postoFine

}));

if (pren) {

const origine = (pren.spotId || '').trim().toUpperCase();

const dest = postoFine.trim().toUpperCase();

if (isValidSpot(origine)) {

ops.push(setDoc(doc(window.db, 'spots', origine), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

} else if (isValidRibalta(origine)) {

ops.push(setDoc(doc(window.db, 'ribalte', origine), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

}

if (isValidSpot(dest)) {

ops.push(setDoc(doc(window.db, 'spots', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

}, { merge: true }));

} else if (isValidRibalta(dest)) {

ops.push(setDoc(doc(window.db, 'ribalte', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

full: pren.fullAllaLibera || false,

}, { merge: true }));

}

ops.push(addDoc(collection(window.db, 'history'), {

ts: serverTimestamp(),

spot: dest,

action: 'Missione completata',

plate: pren.plate || null,

user: pren.utenteEmail || null,

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

// ── POPUP SELEZIONE RIBALTA ───────────────────────────────────────────────────

window.apriPopupRibalte = function(prenId) {

const overlay = document.getElementById('popupRibalteOverlay');
const list    = document.getElementById('popupRibalteList');
const title   = document.getElementById('popupRibalteTitle');
if (!overlay || !list) return;

const pren = _prenotazioni.find(p => p.id === prenId);
const user = _getUser ? _getUser() : null;

// Ruoli senza filtro reparto → vedono tutte le ribalte
const noFilter = !user || ['autista', 'amministratore'].includes(user.role);

// Per le prenotazioni container si usa il reparto di chi ha creato la prenotazione
const repartoFiltro = noFilter ? null : (pren?.utenteReparto || null);

const destConsentite = repartoFiltro
  ? getDestinazioniPerReparto(repartoFiltro)
  : null; // null = tutte

const ribalteLibere = Object.values(_ribalte)
  .filter(r => !r.occupied && (!destConsentite || destConsentite.includes(r.id)))
  .sort((a, b) => a.id.localeCompare(b.id));

if (title) title.textContent = `Seleziona ribalta per ${pren?.plate || ''}`;

if (!ribalteLibere.length) {
  list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera al momento</div>';
} else {
  list.innerHTML = ribalteLibere.map(r => `
<div class="ribaltaItem" onclick="selezionaRibalta('${prenId}','${_esc(r.id)}')">
  <span class="ribaltaId">${_esc(r.id)}</span>
  <span class="ribaltaLibera">🟢 Libera</span>
</div>`).join('');
}

overlay.classList.add('visible');
overlay.dataset.prenId = prenId;

};

window.chiudiPopupRibalte = function() {

const overlay = document.getElementById('popupRibalteOverlay');

if (overlay) overlay.classList.remove('visible');

};

// ── POPUP CASSE: stato navigazione gerarchica ─────────────────────────────────
let _cassaPopupCtx = { spotId: null, plate: null, edificio: null, reparto: null };

window.apriPopupRibalte_cassa = function(spotId, plate) {
  const user = _getUser ? _getUser() : null;
  // Ruoli senza filtro: vedono tutte le ribalte senza navigazione gerarchica
  const noFilter = !user || ['autista', 'amministratore'].includes(user.role);

  _cassaPopupCtx = { spotId, plate, edificio: null, reparto: null };

  const overlay = document.getElementById('popupRibalteOverlay');
  const title   = document.getElementById('popupRibalteTitle');
  if (!overlay) return;

  if (title) title.textContent = `Seleziona ribalta per cassa ${plate}`;

  if (noFilter) {
    // Mostra direttamente tutte le ribalte libere
    _popupCassaMostraRibalte(null);
  } else {
    // Inizia dal livello edificio
    _popupCassaMostraEdifici();
  }

  overlay.classList.add('visible');
};

function _popupCassaMostraEdifici() {
  const list  = document.getElementById('popupRibalteList');
  const title = document.getElementById('popupRibalteTitle');
  if (!list) return;
  if (title) title.textContent = `Cassa ${_cassaPopupCtx.plate} — Scegli edificio`;

  // Edifici distinti presenti nelle ribalte libere
  const repartiConLibere = new Set();
  Object.values(_ribalte).filter(r => !r.occupied).forEach(r => {
    Object.entries(window._REPARTI || {}).forEach(([rep, ids]) => {
      if (ids.includes(r.id)) repartiConLibere.add(rep);
    });
  });

  // Raggruppa reparti per edificio (PNT1 / PNT2)
  const edificiDisponibili = new Set();
  repartiConLibere.forEach(rep => {
    const ids = (window._REPARTI || {})[rep] || [];
    if (ids.some(id => id.startsWith('PNT1-'))) edificiDisponibili.add('PNT1');
    if (ids.some(id => id.startsWith('PNT2-'))) edificiDisponibili.add('PNT2');
  });

  if (!edificiDisponibili.size) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera al momento</div>';
    return;
  }

  list.innerHTML = [...edificiDisponibili].sort().map(ed => `
<div class="ribaltaItem" onclick="_popupCassaSelEdificio('${ed}')">
  <span class="ribaltaId">🏭 ${_esc(ed)}</span>
  <span class="ribaltaLibera">›</span>
</div>`).join('');
}

window._popupCassaSelEdificio = function(edificio) {
  const list  = document.getElementById('popupRibalteList');
  const title = document.getElementById('popupRibalteTitle');
  if (!list) return;
  _cassaPopupCtx.edificio = edificio;
  if (title) title.textContent = `${edificio} — Scegli reparto`;

  // Reparti di questo edificio che hanno almeno una ribalta libera
  const repartiDisp = [];
  Object.entries(window._REPARTI || {}).forEach(([rep, ids]) => {
    const libereDelReparto = ids.filter(id =>
      id.startsWith(edificio + '-') && _ribalte[id] && !_ribalte[id].occupied
    );
    if (libereDelReparto.length) repartiDisp.push({ rep, count: libereDelReparto.length });
  });

  if (!repartiDisp.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera in questo edificio</div>';
    return;
  }

  list.innerHTML =
    `<div class="ribaltaItem ribaltaBack" onclick="_popupCassaMostraEdifici()">
       <span class="ribaltaId">← Indietro</span>
     </div>` +
    repartiDisp.map(({ rep, count }) => `
<div class="ribaltaItem" onclick="_popupCassaSelReparto('${_esc(rep)}')">
  <span class="ribaltaId">${_esc(rep)}</span>
  <span class="ribaltaLibera">${count} libere</span>
</div>`).join('');
};

window._popupCassaSelReparto = function(reparto) {
  _cassaPopupCtx.reparto = reparto;
  _popupCassaMostraRibalte(reparto);
};

function _popupCassaMostraRibalte(reparto) {
  const list  = document.getElementById('popupRibalteList');
  const title = document.getElementById('popupRibalteTitle');
  if (!list) return;

  const edificio = _cassaPopupCtx.edificio;

  let ribalteLibere;
  if (reparto) {
    const ids = (window._REPARTI || {})[reparto] || [];
    ribalteLibere = Object.values(_ribalte)
      .filter(r => !r.occupied && ids.includes(r.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (title) title.textContent = `${reparto} — Scegli ribalta`;
  } else {
    ribalteLibere = Object.values(_ribalte)
      .filter(r => !r.occupied)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (title) title.textContent = `Seleziona ribalta per cassa ${_cassaPopupCtx.plate}`;
  }

  const { spotId, plate } = _cassaPopupCtx;

  const backBtn = reparto
    ? `<div class="ribaltaItem ribaltaBack" onclick="_popupCassaSelEdificio('${_esc(edificio)}')">
         <span class="ribaltaId">← Indietro</span>
       </div>`
    : '';

  if (!ribalteLibere.length) {
    list.innerHTML = backBtn + '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera</div>';
    return;
  }

  list.innerHTML = backBtn + ribalteLibere.map(r => `
<div class="ribaltaItem" onclick="selezionaRibalta_cassa('${_esc(spotId)}','${_esc(plate)}','${_esc(r.id)}')">
  <span class="ribaltaId">${_esc(r.id)}</span>
  <span class="ribaltaLibera">🟢 Libera</span>
</div>`).join('');
}

// Logica esecutiva separata (usata sia dal vecchio popup che dal nuovo picker)
async function selezionaRibalta_cassa_exec(spotId, plate, ribaltaId, user) {
  try {
    const ops = [];
    ops.push(setDoc(doc(window.db, 'spots', spotId), {
      occupied: false, plate: null, since: null, user: null, full: false
    }, { merge: true }));
    ops.push(setDoc(doc(window.db, 'ribalte', ribaltaId), {
      occupied: true, plate: plate || null, since: serverTimestamp(), user: user?.email || null, full: false,
    }, { merge: true }));
    ops.push(addDoc(collection(window.db, 'history'), {
      ts: serverTimestamp(), spot: ribaltaId, action: 'Missione cassa completata',
      plate: plate || null, user: user?.email || null, origine: spotId, destinazione: ribaltaId,
    }));
    await Promise.all(ops);
    showToast(`✅ ${plate} → ${ribaltaId}`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

window.selezionaRibalta_cassa = async function(spotId, plate, ribaltaId) {
  chiudiPopupRibalte();
  const user = _getUser ? _getUser() : null;
  await selezionaRibalta_cassa_exec(spotId, plate, ribaltaId, user);
};

window.selezionaRibalta = async function(prenId, ribaltaId) {

chiudiPopupRibalte();

const pren = _prenotazioni.find(p => p.id === prenId);

if (!pren) { showToast('Prenotazione non trovata', 'error'); return; }

try {

const ops = [];

ops.push(updateDoc(doc(window.db, 'prenotazioni', prenId), {

stato: 'completata', destinazione: ribaltaId, completataAt: serverTimestamp(), postoFine: ribaltaId,

}));

const spotId = (pren.spotId || '').trim();

if (spotId) {

ops.push(setDoc(doc(window.db, 'spots', spotId), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

}

ops.push(setDoc(doc(window.db, 'ribalte', ribaltaId), {

occupied: true, plate: pren.plate || null, since: serverTimestamp(), user: pren.operatoreEmail || null, full: false,

}, { merge: true }));

ops.push(addDoc(collection(window.db, 'history'), {

ts: serverTimestamp(), spot: ribaltaId, action: 'Missione cassa completata',

plate: pren.plate || null, user: pren.operatoreEmail || null, origine: spotId, destinazione: ribaltaId,

}));

await Promise.all(ops);

showToast(`✅ ${pren.plate} → ${ribaltaId}`, 'success');

} catch (e) {

showToast('Errore: ' + e.message, 'error');

}

};

export async function completaSingola(id) {

window.aprirCompletaForm(id);

}

// ── TOGGLE URGENTE ────────────────────────────────────────────────────────────

window.toggleUrgentePrenotazione = async function(id, newVal) {

const user = _getUser ? _getUser() : null;

if (!user || !['amministrativo', 'amministratore'].includes(user.role)) {

showToast('Non hai i permessi per gestire le urgenze.', 'error');

return;

}

try {

await updateDoc(doc(window.db, 'prenotazioni', id), { urgente: newVal });

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
