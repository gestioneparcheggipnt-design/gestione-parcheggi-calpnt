// ── prenotazioni-autista.js ───────────────────────────────────────────────────

// Gestione prenotazioni casse/container + missioni ribalta per autista (mobile)

// Dipende da: firebase-config.js, shared-utils.js

import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc, addDoc, serverTimestamp, getDocs }

from './firebase-config.js';

import { getDestinazioniPerReparto } from './spots-data.js';

import { showToast, _esc, validateDestination, isValidSpot, isValidRibalta } from './shared-utils.js';

const RE_CASSA = /^\d{3}$/;

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

query(collection(db, 'prenotazioni'), orderBy('dataOra', 'desc')),

snap => {

_prenotazioni = snap.docs.map(d => ({ id: d.id, ...d.data() }));

renderPrenotazioni();

},

err => console.error('Errore prenotazioni:', err)

);

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

if (_unsubRibalte) _unsubRibalte();

_unsubRibalte = onSnapshot(

collection(db, 'ribalte'),

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

completaBtn = `<button class="btnCompletaOrange" onclick="apriPopupRibalte_cassa('${_esc(s.id)}','${_esc(s.plate)}')">✅ Completa missione</button>`;

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

? `<button class="btnCompleta" onclick="aprirCompletaMissione('${p.id}')" style="margin-top:10px">

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

<button class="btnCfCancel" onclick="chiudiCompletaForm('${p.id}')">Annulla</button>

</div>

</div>`

: `<button disabled style="width:100%;margin-top:8px;padding:11px 0;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;color:var(--muted);font-family:inherit;font-size:13px;font-weight:700;cursor:not-allowed;opacity:.6">

🔒 In attesa

</button>

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

<button class="btnCompletaOrange" onclick="aprirCompletaForm('${p.id}')">

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

<button class="btnCfCancel" onclick="chiudiCompletaForm('${p.id}')">Annulla</button>

</div>

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

ops.push(updateDoc(doc(db, 'prenotazioni', id), {

stato: 'completata',

completataAt: serverTimestamp(),

postoFine

}));

if (pren) {

const origine = (pren.spotId || '').trim().toUpperCase();

const dest = postoFine.trim().toUpperCase();

if (isValidSpot(origine)) {

ops.push(setDoc(doc(db, 'spots', origine), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

} else if (isValidRibalta(origine)) {

ops.push(setDoc(doc(db, 'ribalte', origine), {

occupied: false, plate: null, since: null, user: null

}, { merge: true }));

}

if (isValidSpot(dest)) {

ops.push(setDoc(doc(db, 'spots', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

}, { merge: true }));

} else if (isValidRibalta(dest)) {

ops.push(setDoc(doc(db, 'ribalte', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

}, { merge: true }));

}

ops.push(addDoc(collection(db, 'history'), {

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

const _destUtente = (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'amministratore')
  ? getDestinazioniPerReparto(currentUser.reparto)
  : null;

const ribalteLibere = Object.values(_ribalte)

.filter(r => !r.occupied && (!_destUtente || _destUtente.includes(r.id)))

.sort((a, b) => a.id.localeCompare(b.id));

const overlay = document.getElementById('popupRibalteOverlay');

const list = document.getElementById('popupRibalteList');

const title = document.getElementById('popupRibalteTitle');

if (!overlay || !list) return;

const pren = _prenotazioni.find(p => p.id === prenId);

if (title) title.textContent = `Seleziona ribalta per cassa ${pren?.plate || ''}`;

if (!ribalteLibere.length) {

list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera al momento</div>';

} else {

list.innerHTML = ribalteLibere.map(r => `

<div class="ribaltaItem" onclick="selezionaRibalta('${prenId}','${r.id}')">

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

window.apriPopupRibalte_cassa = function(spotId, plate) {

const _destUtente = (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'amministratore')
  ? getDestinazioniPerReparto(currentUser.reparto)
  : null;

const ribalteLibere = Object.values(_ribalte)

.filter(r => !r.occupied && (!_destUtente || _destUtente.includes(r.id)))

.sort((a, b) => a.id.localeCompare(b.id));

const overlay = document.getElementById('popupRibalteOverlay');

const list = document.getElementById('popupRibalteList');

const title = document.getElementById('popupRibalteTitle');

if (!overlay || !list) return;

if (title) title.textContent = `Seleziona ribalta per cassa ${plate}`;

if (!ribalteLibere.length) {

list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Nessuna ribalta libera al momento</div>';

} else {

list.innerHTML = ribalteLibere.map(r => `

<div class="ribaltaItem" onclick="selezionaRibalta_cassa('${spotId}','${plate}','${r.id}')">

<span class="ribaltaId">${_esc(r.id)}</span>

<span class="ribaltaLibera">🟢 Libera</span>

</div>`).join('');

}

overlay.classList.add('visible');

};

window.selezionaRibalta_cassa = async function(spotId, plate, ribaltaId) {

chiudiPopupRibalte();

const user = _getUser ? _getUser() : null;

try {

const ops = [];

ops.push(setDoc(doc(db, 'spots', spotId), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

ops.push(setDoc(doc(db, 'ribalte', ribaltaId), {

occupied: true, plate: plate || null, since: serverTimestamp(), user: user?.email || null, full: false,

}, { merge: true }));

ops.push(addDoc(collection(db, 'history'), {

ts: serverTimestamp(), spot: ribaltaId, action: 'Missione cassa completata',

plate: plate || null, user: user?.email || null, origine: spotId, destinazione: ribaltaId,

}));

await Promise.all(ops);

showToast(`✅ ${plate} → ${ribaltaId}`, 'success');

} catch (e) {

showToast('Errore: ' + e.message, 'error');

}

};

window.selezionaRibalta = async function(prenId, ribaltaId) {

chiudiPopupRibalte();

const pren = _prenotazioni.find(p => p.id === prenId);

if (!pren) { showToast('Prenotazione non trovata', 'error'); return; }

try {

const ops = [];

ops.push(updateDoc(doc(db, 'prenotazioni', prenId), {

stato: 'completata', destinazione: ribaltaId, completataAt: serverTimestamp(), postoFine: ribaltaId,

}));

const spotId = (pren.spotId || '').trim();

if (spotId) {

ops.push(setDoc(doc(db, 'spots', spotId), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

}

ops.push(setDoc(doc(db, 'ribalte', ribaltaId), {

occupied: true, plate: pren.plate || null, since: serverTimestamp(), user: pren.operatoreEmail || null, full: false,

}, { merge: true }));

ops.push(addDoc(collection(db, 'history'), {

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
