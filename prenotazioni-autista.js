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
const RE_CONTAINER = /^[A-Z]{4}\d{7}$/;

// Tipo veicolo dedotto dalla targa (fallback: container)
function _tipoDaPlate(plate) {
  const k = (plate || '').trim().toUpperCase();
  if (RE_CASSA.test(k)) return 'cassa';
  if (RE_CONTAINER.test(k)) return 'container';
  return 'container';
}

// ── Criteri parcheggi ─────────────────────────────────────────────────────────
// A01–A12 container pieno · A13–A24 container vuoto
// B01–B09 cassa pieno · C** / D** cassa vuoto
function _spotCriterio(id) {
  const m = String(id || '').trim().toUpperCase().match(/^([A-D])(\d{2})$/);
  if (!m) return null;
  const zona = m[1], n = parseInt(m[2], 10);
  if (zona === 'A') return { tipo: 'container', stato: n <= 12 ? 'pieno' : 'vuoto' };
  if (zona === 'B') return { tipo: 'cassa', stato: 'pieno' };
  return { tipo: 'cassa', stato: 'vuoto' };
}

// Parcheggi liberi compatibili con tipo (+ eventuale stato)
function _postiLiberiPerTipo(tipo, stato = null) {
  const ids = Array.isArray(window.SPOT_DEFS) && window.SPOT_DEFS.length
    ? window.SPOT_DEFS.map(d => String(d[0]).trim().toUpperCase())
    : Object.keys(_spots);
  return ids.filter(id => {
    const c = _spotCriterio(id);
    if (!c || c.tipo !== tipo) return false;
    if (stato && c.stato !== stato) return false;
    const s = _spots[id];
    if (s && (s.occupied || s.unusable)) return false;
    return true;
  }).sort();
}

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

// ── Filtro ribalte per reparto (ruolo `operativo`) ────────────────────────────
// L'utente `operativo` deve vedere/liberare solo le ribalte del proprio reparto.
// Trova la chiave reale in window._REPARTI ignorando case e spazi.
function _repartoKeyDaNome(nome) {
  if (!nome || !window._REPARTI) return null;
  const target = String(nome).trim().toUpperCase();
  return Object.keys(window._REPARTI)
    .find(k => String(k).trim().toUpperCase() === target) || null;
}

// Set delle ribalte visibili all'utente corrente.
// Ritorna null quando non va applicato alcun filtro (tutti gli altri ruoli).
function _ribalteConsentiteUtente() {
  const user = _getUser ? _getUser() : null;
  if (!user || user.role !== 'operativo') return null;
  const key = _repartoKeyDaNome(user.reparto);
  if (!key) return new Set(); // operativo senza reparto valido → nessuna ribalta
  const ids = (window._REPARTI || {})[key] || [];
  return new Set(ids.map(id => String(id).trim().toUpperCase()));
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

// ── BLOCCO DI 3 A GRUPPI FISSI ────────────────────────────────────────
// Le missioni si sbloccano a gruppi di 3: il gruppo successivo si attiva solo
// quando TUTTE e 3 le missioni del gruppo corrente sono state completate.
// Lo stato del gruppo è condiviso fra tutti i dispositivi tramite Firestore:
//   - prenotazioni → campo `bloccoAt` (timestamp di apertura del gruppo)
//   - spots (casse) → campo `bloccoPlate` (targa al momento dell'apertura)
//     Il confronto bloccoPlate === plate rende il campo auto-invalidante:
//     se il posto viene riusato da un'altra cassa, il vecchio marcatore decade.
const BLOCCO_SIZE = 3;
const _bloccoInFlight = new Set();

async function _apriBloccoPren(lista) {
  const nuovi = lista.filter(p => !_bloccoInFlight.has('p:' + p.id));
  if (!nuovi.length) return;
  nuovi.forEach(p => _bloccoInFlight.add('p:' + p.id));
  try {
    await Promise.all(nuovi.map(p =>
      updateDoc(doc(window.db, 'prenotazioni', p.id), { bloccoAt: serverTimestamp() })
    ));
  } catch (e) {
    console.error('Errore apertura blocco prenotazioni:', e);
  } finally {
    nuovi.forEach(p => _bloccoInFlight.delete('p:' + p.id));
  }
}

// Lista casse piene, ordinata dalla più vecchia alla più recente.
function _casseOccupateOrdinate() {
  return Object.values(_spots)
    .filter(s => s.occupied && s.full && s.plate && RE_CASSA.test(s.plate.trim()))
    .sort((a, b) => _tsVal(a.since) - _tsVal(b.since));
}

// ── SEQUENZA PIENO / VUOTO ALTERNATA ──────────────────────────────────────────
// L'autista lavora con un solo rimorchio: porta un pieno alla ribalta e riporta
// via un vuoto, così non fa mai un viaggio a motrice scarica. L'elenco quindi
// alterna pieno ↔ vuoto (container o casse, missioni ribalta comprese).
//  - Urgenti: sempre in cima e sempre sbloccati (fuori dal gruppo di 3).
//  - Gruppo di 3: resta. Essendo dispari, a ogni gruppo la parità si invertirebbe
//    (P-V-P | P-V-P → due pieni di fila). Per evitarlo il tipo dell'ultimo
//    elemento del gruppo aperto è salvato su Firestore (stato/sequenzaAutista),
//    e il gruppo successivo parte dal tipo opposto (P-V-P | V-P-V).
let _unsubSeq = null;
let _seqUltimo = {}; // { container: 'pieno'|'vuoto', cassa: 'pieno'|'vuoto' }

const _opposto = t => (t === 'pieno' ? 'vuoto' : (t === 'vuoto' ? 'pieno' : null));
const _tipoItem = i => (i && i.pieno ? 'pieno' : 'vuoto');

// Interleave di pieni e vuoti, ciascuna coda ordinata per anzianità.
// start null → parte dal tipo più numeroso (a parità: dal più vecchio).
function _alterna(items, start) {
  const byTs = (a, b) => a.ts - b.ts;
  const P = items.filter(i => i.pieno).sort(byTs);
  const V = items.filter(i => !i.pieno).sort(byTs);
  let next = start;
  if (next !== 'pieno' && next !== 'vuoto') {
    if (P.length !== V.length) next = P.length > V.length ? 'pieno' : 'vuoto';
    else next = (P[0] && V[0] && V[0].ts < P[0].ts) ? 'vuoto' : 'pieno';
  }
  const out = [];
  while (P.length || V.length) {
    const q = next === 'pieno' ? (P.length ? P : V) : (V.length ? V : P);
    const it = q.shift();
    out.push(it);
    next = _opposto(_tipoItem(it));
  }
  return out;
}

function _apriGruppo(gruppoOrd, mode) {
  const prens = gruppoOrd.filter(i => i.pren).map(i => i.pren);
  const spots = gruppoOrd.filter(i => i.spot).map(i => i.spot);
  if (prens.length) _apriBloccoPren(prens);
  if (spots.length) _apriBloccoCasse(spots);
  const ultimo = _tipoItem(gruppoOrd[gruppoOrd.length - 1]);
  if (_seqUltimo[mode] !== ultimo) {
    _seqUltimo[mode] = ultimo;
    setDoc(doc(window.db, 'stato', 'sequenzaAutista'), { [mode]: ultimo }, { merge: true })
      .catch(e => console.error('Errore salvataggio sequenza:', e));
  }
}

// items: [{ key, pieno, urg, ts, marcato, pren?|spot? }]
// → { ordinati:[item], abilitati:Set<key> }
function _calcolaSequenza(items, mode) {
  const urgenti = items.filter(i => i.urg).sort((a, b) => a.ts - b.ts);
  const normali = items.filter(i => !i.urg);
  const lastUrg = urgenti.length ? _tipoItem(urgenti[urgenti.length - 1]) : null;

  let gruppo = normali.filter(i => i.marcato);
  let gruppoOrd;
  if (!items.some(i => i.marcato)) {
    // Nessun gruppo aperto → se ne apre uno nuovo, dal tipo opposto all'ultimo.
    const start = lastUrg ? _opposto(lastUrg) : _opposto(_seqUltimo[mode]);
    gruppoOrd = _alterna(normali, start).slice(0, BLOCCO_SIZE);
    gruppo = gruppoOrd;
    if (gruppoOrd.length) _apriGruppo(gruppoOrd, mode);
  } else {
    gruppoOrd = _alterna(gruppo, lastUrg ? _opposto(lastUrg) : null);
  }

  const gKeys = new Set(gruppo.map(i => i.key));
  const prima = gruppoOrd.length ? gruppoOrd[gruppoOrd.length - 1] : urgenti[urgenti.length - 1];
  const resto = _alterna(normali.filter(i => !gKeys.has(i.key)), prima ? _opposto(_tipoItem(prima)) : null);

  const abilitati = new Set([...urgenti.map(i => i.key), ...gKeys]);
  return { ordinati: urgenti.concat(gruppoOrd, resto), abilitati };
}

// Timestamp ordinamento prenotazione (dataOra)
function _tsPren(p) {
  const d = _parseDate(p.dataOra);
  return d && !isNaN(d.getTime()) ? d.getTime() : Date.now();
}

// Pieno/vuoto del veicolo da movimentare
function _isPienoPren(p) {
  if (p.tipoMissione === 'ribalta') return !!p.fullAllaLibera;
  if (p.tipoMissione === 'navetta') return p.faseNavetta === 'pieno';
  return true; // prenotazione container ordinaria: si prenotano solo container pieni
}

// Urgenza su cassa parcheggiata (impostata da amministrativo REVERSE).
// urgentePlate rende il flag auto-invalidante se il posto passa a un'altra cassa.
function _cassaUrgente(s) {
  return s.urgente === true && !!s.plate && s.urgentePlate === s.plate;
}

async function _apriBloccoCasse(lista) {
  const nuove = lista.filter(s => !_bloccoInFlight.has('s:' + s.id));
  if (!nuove.length) return;
  nuove.forEach(s => _bloccoInFlight.add('s:' + s.id));
  try {
    await Promise.all(nuove.map(s =>
      setDoc(doc(window.db, 'spots', s.id), { bloccoPlate: s.plate || null }, { merge: true })
    ));
  } catch (e) {
    console.error('Errore apertura blocco casse:', e);
  } finally {
    nuove.forEach(s => _bloccoInFlight.delete('s:' + s.id));
  }
}

export function initPrenotazioni({ getUser, getMode }) {

_getUser = getUser;

_getMode = getMode || (() => 'container');

if (window.NavetteCore) window.NavetteCore.startNavetteListener(() => renderPrenotazioni());

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

if (_unsubSeq) _unsubSeq();

_unsubSeq = onSnapshot(
  doc(window.db, 'stato', 'sequenzaAutista'),
  snap => { _seqUltimo = snap.exists() ? (snap.data() || {}) : {}; },
  err => console.error('Errore sequenza autista:', err)
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

if (_unsubSeq) { _unsubSeq(); _unsubSeq = null; }

if (window.NavetteCore) window.NavetteCore.stopNavetteListener();

}

export function renderPrenotazioni() {

const mode = _getMode ? _getMode() : 'container';

const el = document.getElementById('prenList');

if (!el) return;

// ── MODALITÀ CASSA ────────────────────────────────────────────────────────────
// Un'unica lista: missioni ribalta su casse (vuote o piene) + casse piene
// parcheggiate, alternate pieno/vuoto. Le urgenti stanno in cima.
if (mode === 'cassa') {

const missioniCasse = _prenotazioni
  .filter(p => p.tipoMissione === 'ribalta' && p.stato === 'creata' && _tipoDaPlate(p.plate) === 'cassa');

const casseOccupate = _casseOccupateOrdinate();

const items = [
  ...missioniCasse.map(p => ({ key: 'p:' + p.id, pren: p, pieno: _isPienoPren(p), urg: !!p.urgente, ts: _tsPren(p), marcato: !!p.bloccoAt })),
  ...casseOccupate.map(s => ({ key: 's:' + s.id, spot: s, pieno: true, urg: _cassaUrgente(s), ts: _tsVal(s.since), marcato: !!(s.bloccoPlate && s.bloccoPlate === s.plate) })),
];

if (!items.length) {
  el.innerHTML = '<div class="emptyState">Nessuna cassa da movimentare al momento.</div>';
  return;
}

const seq = _calcolaSequenza(items, 'cassa');

let html = `<div class="prenGroupTitle">DA MOVIMENTARE (${seq.ordinati.length})</div>`;
seq.ordinati.forEach((it, idx) => {
  const ab = seq.abilitati.has(it.key);
  html += it.pren ? _missioneCard(it.pren, ab) : _cassaCard(it.spot, idx, ab, it.urg);
});
el.innerHTML = html;

if (_openCompletaId) {
  const form = document.getElementById('completaForm_' + _openCompletaId);
  if (form) form.style.display = 'block';
}

return;

}

// ── MODALITÀ CONTAINER ────────────────────────────────────────────────────────
// Missioni ribalta + prenotazioni + navettaggi in un'unica lista alternata
// pieno/vuoto. Urgenti in cima.
// Ruolo `operativo`: solo le ribalte del reparto associato all'utente.
const _ribConsentite = _ribalteConsentiteUtente();

const missioni = _prenotazioni.filter(p =>
  p.tipoMissione === 'ribalta' && p.stato === 'creata' && _tipoDaPlate(p.plate) === 'container' &&
  (!_ribConsentite || _ribConsentite.has(String(p.spotId || '').trim().toUpperCase()))
);

const ordinarie = _prenotazioni.filter(p => p.tipoMissione !== 'ribalta' && p.tipoMissione !== 'navetta' && (!p.tipoMezzo || p.tipoMezzo === 'container'));

// Missioni navettaggio interno visibili all'autista: solo quelle già abbinate
// (stato 'creata'); le richieste 'in_attesa' non hanno ancora un mezzo/origine.
const navetteMissioni = _prenotazioni.filter(p => p.tipoMissione === 'navetta' && p.stato === 'creata');

const pendenti = ordinarie.filter(p => p.stato === 'creata');

const attiviRaw = missioni.concat(pendenti).concat(navetteMissioni);

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

// Navette completate nelle ultime 2 ore
const navetteCompletate = _prenotazioni.filter(p => {
  if (p.tipoMissione !== 'navetta' || p.stato === 'creata' || p.stato === 'in_attesa') return false;
  const c = p.completataAt?.toDate ? p.completataAt.toDate() : (p.completataAt ? new Date(p.completataAt) : null);
  return c && c.getTime() >= due_ore_fa;
});

if (!attiviRaw.length && !completate.length && !navetteCompletate.length) {
  el.innerHTML = '<div class="emptyState">Nessuna prenotazione container trovata.</div>';
  return;
}

const seq = _calcolaSequenza(
  attiviRaw.map(p => ({ key: 'p:' + p.id, pren: p, pieno: _isPienoPren(p), urg: !!p.urgente, ts: _tsPren(p), marcato: !!p.bloccoAt })),
  'container'
);
const attivi = seq.ordinati.map(i => i.pren);
const bloccoIds = seq.abilitati;

let html = '';

if (attivi.length) {
  html += `<div class="prenGroupTitle">DA MOVIMENTARE (${attivi.length})</div>`;
  attivi.forEach((p, idx) => {
    const ab = bloccoIds.has('p:' + p.id);
    html += (p.tipoMissione === 'ribalta')
      ? _missioneCard(p, ab)
      : (p.tipoMissione === 'navetta')
        ? _navettaCard(p, ab)
        : _prenCard(p, ab, idx);
  });
}

const completateAll = completate.concat(navetteCompletate);

if (completateAll.length) {
  html += `<div class="prenGroupTitle" style="margin-top:14px">COMPLETATE (${completateAll.length})</div>`;
  completateAll.forEach(p => { html += (p.tipoMissione === 'navetta') ? _navettaCard(p, false) : _prenCard(p, false, -1); });
}

el.innerHTML = html;

if (_openCompletaId) {
  const form = document.getElementById('completaForm_' + _openCompletaId);
  if (form) form.style.display = 'block';
}

}

// ── CARD CASSA PARCHEGGIATA (piena, parcheggio → ribalta) ─────────────────────
function _cassaCard(s, idx, abilitato, urgente) {
  const sinceTs = s.since ? (s.since.toDate ? s.since.toDate() : new Date(s.since)) : null;
  const anzianita = sinceTs ? _fmtAnzianita(sinceTs) : '—';
  const sinceStr = sinceTs
    ? sinceTs.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';
  const rankClass = abilitato ? 'cassa-rank top' : 'cassa-rank';
  const completaBtn = abilitato
    ? `<div id="nfRow_s_${_esc(s.id)}" style="display:flex;gap:8px;align-items:stretch">
  <button class="btnCompletaOrange" style="flex:2;margin:0" onclick="aprirCompletaCassa('${_esc(s.id)}','${_esc(s.plate)}','cassa_${_esc(s.id)}')">✅ Completa missione</button>
  ${_btnNonTrovato(`nonTrovatoSpot('${_esc(s.id)}')`)}
</div>
<div id="nfConf_s_${_esc(s.id)}" style="display:none"></div>
<div id="cfCassa_cassa_${_esc(s.id)}" style="display:none"></div>
<div id="cfCassaUndo_cassa_${_esc(s.id)}" style="display:none"></div>`
    : `<button disabled class="btnBlocco">🔒 In attesa</button>`;
  const cardClass = abilitato ? 'casseCard pendente' : 'casseCard bloccata';
  const urgStyle = urgente ? ' style="border:2px solid var(--red,#ef4444)"' : '';
  return `
<div class="${cardClass}"${urgStyle}>
  <div class="casseCardTop">
    <span class="${rankClass}">${idx + 1}</span>
    <span class="casseCardPlate">${_esc(s.plate)}</span>
    ${urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}
  </div>
  <div class="casseCardRoute">
    <span class="casseCardPosto">${_esc(s.id)}</span>
    <span class="casseCardArrow">→</span>
    <span class="casseCardDest">Ribalta</span>
  </div>
  <div class="casseCardMeta" title="Entrata: ${sinceStr}">🟡 Piena · ⏱ ${anzianita}</div>
  ${completaBtn}
</div>`;
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
? `<div id="nfRow_${p.id}" style="display:flex;gap:8px;align-items:stretch;margin-top:10px">
  <button class="btnCompleta" style="flex:2;margin:0" onclick="aprirCompletaMissione('${p.id}')">✅ Completa missione</button>
  ${_btnNonTrovato(`nonTrovatoPren('${p.id}')`)}
</div>
<div id="nfConf_${p.id}" style="display:none"></div>
<div class="completaForm" id="completaForm_${p.id}" style="display:none">
  <div data-step="picker" id="cfStep_${p.id}">
    ${_buildPostiPicker(p)}
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

const _rich = (p.destinazione && p.destinazione !== '—') ? String(p.destinazione).trim().toUpperCase() : '';
const _eff  = p.postoFine ? String(p.postoFine).trim().toUpperCase() : '';
const dove = _eff
  ? `<div class="pcmDove">📍 ${_esc(_eff)}${_rich && _rich !== _eff ? ` <span style="font-size:11px;color:var(--muted)">(richiesta ${_esc(_rich)})</span>` : ''}</div>`
  : '';

btnHTML = `${dove}`;

} else if (abilitato) {

btnHTML = `
<div id="nfRow_${p.id}" style="display:flex;gap:8px;align-items:stretch">
  <button class="btnCompletaOrange" style="flex:2;margin:0" onclick="aprirCompletaForm('${p.id}')">✅ Completa</button>
  ${_btnNonTrovato(`nonTrovatoPren('${p.id}')`)}
</div>
<div id="nfConf_${p.id}" style="display:none"></div>
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

<div class="pcmMeta">${completata ? '' : '🟡 Pieno · '}${dataStr}</div>

${bloccatoNote}

${btnHTML}

</div>`;

}

// ── CARD NAVETTAGGIO INTERNO ──────────────────────────────────────────────────
// plate/spotId sono null: l'identificativo è navettaId, il movimento è origine→destinazione.
// Il completamento dichiara SOLO la ribalta di arrivo (non tocca spots/ribalte).
function _navettaCard(p, abilitato = true) {
  const d = _parseDate(p.dataOra);
  const dataStr = d ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const completata = p.stato !== 'creata';
  const nav = _esc(p.navettaId || 'NAV');
  const statoVeicolo = p.faseNavetta === 'pieno' ? '🟡 Pieno' : '🟢 Vuoto';
  const badge = p.faseNavetta === 'pieno' ? '🚚 NAVETTA · PIENO' : '🚚 NAVETTA · VUOTO';

  let btnHTML;
  if (completata) {
    btnHTML = p.ribaltaArrivo
      ? `<div class="pcmDove">📍 ${_esc(p.ribaltaArrivo)}${p.destinazione && p.destinazione !== p.ribaltaArrivo ? ` <span style="font-size:11px;color:var(--muted)">(richiesta ${_esc(p.destinazione)})</span>` : ''}</div>`
      : '';
  } else if (abilitato) {
    const def = _esc(p.destinazione || '');
    btnHTML = `
<button class="btnCompleta" onclick="aprirCompletaMissione('${p.id}')" style="margin-top:10px">✅ Completa navettaggio</button>
<div class="completaForm" id="completaForm_${p.id}" style="display:none">
  <div style="${_S.sectionLabel}">Ribalta di arrivo</div>
  <input id="cfInput_${p.id}" class="inputField" value="${def}" spellcheck="false"
    style="text-transform:uppercase" placeholder="es. PNT1-03"
    onkeydown="if(event.key==='Enter')confermaNavetta('${p.id}')">
  <button class="btnCompleta" style="margin-top:8px" onclick="confermaNavetta('${p.id}')">Conferma ribalta</button>
</div>`;
  } else {
    btnHTML = `<button disabled class="btnBlocco">🔒 In attesa</button>
<div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">Disponibile dopo il completamento delle prime 3</div>`;
  }

  const cardClass = completata
    ? 'prenCardMissione completata'
    : (p.urgente ? 'prenCardMissione pendente urgente' : 'prenCardMissione pendente');

  return `
<div class="${cardClass}">
  <div class="pcmHeader">
    <span class="pcmPlate">${nav}</span>
    ${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : ''}
    <span class="pcmStatoBadge ${completata ? 'completata' : 'creata'}">${completata ? '✅ Completata' : badge}</span>
  </div>
  <div class="pcmRoute">
    <span class="pcmSpot">${_esc(p.origine || '—')}</span>
    <span class="pcmArrow">→</span>
    <span class="pcmDest">${_esc(p.destinazione || '—')}</span>
  </div>
  <div class="pcmMeta">${statoVeicolo} · ${dataStr}</div>
  ${btnHTML}
</div>`;
}

// ── VEICOLO NON TROVATO ───────────────────────────────────────────────────────
// L'autista arriva sul posto e il veicolo non c'è. Il luogo di partenza
// (parcheggio o ribalta) viene liberato e la missione annullata.
// Ogni dichiarazione finisce sia in `history` sia nella collection dedicata
// `veicoliNonTrovati`, che alimenta le statistiche desktop.

// Pulsante stretto (1/3) accanto al pulsante di conferma (2/3)
function _btnNonTrovato(onclick) {
  return `<button onclick="${onclick}"
    style="flex:1;margin:0;padding:8px 6px;border-radius:9px;border:1.5px solid var(--red,#ef4444);
           background:transparent;color:var(--red,#ef4444);font-family:inherit;font-size:12px;
           font-weight:700;line-height:1.25;cursor:pointer">❓ Veicolo<br>non trovato</button>`;
}

function _nfChiedi(key, titolo, testo, onYes) {
  const row  = document.getElementById('nfRow_' + key);
  const conf = document.getElementById('nfConf_' + key);
  if (!conf) return;
  if (row) row.style.display = 'none';
  conf.style.display = 'block';
  conf.innerHTML = `
<div style="padding:12px;border-radius:10px;border:2px solid var(--red,#ef4444);background:var(--surface2);margin-top:8px">
  <div style="font-size:14px;font-weight:800;margin-bottom:6px">❓ ${titolo}</div>
  <div style="font-size:13px;line-height:1.45;margin-bottom:12px">${testo}</div>
  <div style="display:flex;gap:8px">
    <button onclick="nfAnnulla('${key}')"
            style="flex:1;padding:11px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
      ✕ No
    </button>
    <button id="nfSi_${key}" onclick="${onYes}"
            style="flex:1;padding:11px;border-radius:8px;border:none;background:var(--red,#ef4444);color:#fff;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer">
      ✓ Sì, non c'è
    </button>
  </div>
</div>`;
}

window.nfAnnulla = function(key) {
  const row  = document.getElementById('nfRow_' + key);
  const conf = document.getElementById('nfConf_' + key);
  if (conf) { conf.style.display = 'none'; conf.innerHTML = ''; }
  if (row) row.style.display = 'flex';
};

const _nfInCorso = new Set();

// Registra la dichiarazione (storico + collection statistiche)
async function _nfRegistra({ plate, luogo, tipoLuogo, prenId, tipoMissione }) {
  const user = _getUser ? _getUser() : null;
  const tipo = _tipoDaPlate(plate);
  await window.logHistory({
    spot: luogo, action: 'Veicolo non trovato', plate: plate || null, tipo,
    origine: luogo, luogoTipo: tipoLuogo,
  });
  await addDoc(collection(window.db, 'veicoliNonTrovati'), {
    ts: serverTimestamp(),
    plate: plate || null,
    tipo,
    luogo,
    luogoTipo: tipoLuogo,
    prenId: prenId || null,
    tipoMissione: tipoMissione || null,
    utenteUid:   user?.uid   || null,
    utenteNome:  user?.name  || user?.email || null,
    utenteEmail: user?.email || null,
  });
}

// Missione / prenotazione: libera l'origine e annulla la missione
window.nonTrovatoPren = function(id) {
  const p = _prenotazioni.find(x => x.id === id);
  if (!p) { showToast('Missione non trovata', 'error'); return; }
  const luogo = String(p.spotId || '').trim().toUpperCase();
  const tipoLuogo = isValidRibalta(luogo) ? 'ribalta' : 'parcheggio';
  _nfChiedi(id, 'Il veicolo non è sul posto?',
    `<strong>${_esc(p.plate || '—')}</strong> risulta ${tipoLuogo === 'ribalta' ? 'alla ribalta' : 'al parcheggio'} <strong>${_esc(luogo || '—')}</strong>.<br>
     Confermando, ${tipoLuogo === 'ribalta' ? 'la ribalta' : 'il parcheggio'} viene liberato e la missione annullata.`,
    `nonTrovatoPrenExec('${id}')`);
};

window.nonTrovatoPrenExec = async function(id) {
  if (_nfInCorso.has(id)) return;
  const p = _prenotazioni.find(x => x.id === id);
  if (!p) { showToast('Missione non trovata', 'error'); return; }
  _nfInCorso.add(id);
  const btn = document.getElementById('nfSi_' + id);
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  const luogo = String(p.spotId || '').trim().toUpperCase();
  const user  = _getUser ? _getUser() : null;
  try {
    const ops = [];
    ops.push(updateDoc(doc(window.db, 'prenotazioni', id), {
      stato: 'annullata',
      motivoAnnullamento: 'veicolo_non_trovato',
      annullataAt: serverTimestamp(),
      annullataDaUid:  user?.uid  || null,
      annullataDaNome: user?.name || user?.email || null,
    }));
    if (isValidSpot(luogo)) {
      ops.push(setDoc(doc(window.db, 'spots', luogo), {
        occupied: false, plate: null, since: null, user: null, full: false,
        bloccoPlate: null, urgente: false, urgentePlate: null,
      }, { merge: true }));
    } else if (isValidRibalta(luogo)) {
      ops.push(setDoc(doc(window.db, 'ribalte', luogo), {
        occupied: false, plate: null, since: null, user: null, full: false,
        inUscita: false, ribaltaRichiesta: null,
      }, { merge: true }));
    }
    ops.push(_nfRegistra({
      plate: p.plate, luogo,
      tipoLuogo: isValidRibalta(luogo) ? 'ribalta' : 'parcheggio',
      prenId: id, tipoMissione: p.tipoMissione || 'prenotazione',
    }));
    await Promise.all(ops);
    _openCompletaId = null;
    showToast(`Segnalato: ${p.plate || '—'} non trovato — ${luogo} liberato`, 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = "✓ Sì, non c'è"; }
  } finally {
    _nfInCorso.delete(id);
  }
};

// Cassa parcheggiata (nessuna prenotazione): libera solo il posto
window.nonTrovatoSpot = function(spotId) {
  const s = _spots[spotId];
  if (!s) { showToast('Posto non trovato', 'error'); return; }
  _nfChiedi('s_' + spotId, 'Il veicolo non è sul posto?',
    `<strong>${_esc(s.plate || '—')}</strong> risulta al parcheggio <strong>${_esc(spotId)}</strong>.<br>
     Confermando, il parcheggio viene liberato.`,
    `nonTrovatoSpotExec('${spotId}')`);
};

window.nonTrovatoSpotExec = async function(spotId) {
  const key = 's_' + spotId;
  if (_nfInCorso.has(key)) return;
  const s = _spots[spotId];
  if (!s) { showToast('Posto non trovato', 'error'); return; }
  _nfInCorso.add(key);
  const btn = document.getElementById('nfSi_' + key);
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  const plate = s.plate;
  try {
    await Promise.all([
      setDoc(doc(window.db, 'spots', spotId), {
        occupied: false, plate: null, since: null, user: null, full: false,
        bloccoPlate: null, urgente: false, urgentePlate: null,
      }, { merge: true }),
      _nfRegistra({ plate, luogo: spotId, tipoLuogo: 'parcheggio', prenId: null, tipoMissione: 'cassa_parcheggiata' }),
    ]);
    showToast(`Segnalato: ${plate || '—'} non trovato — ${spotId} liberato`, 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = "✓ Sì, non c'è"; }
  } finally {
    _nfInCorso.delete(key);
  }
};

// ── BUILD PICKER PARCHEGGI (missioni: liberare una ribalta) ───────────────────

function _buildPostiPicker(p) {
  const tipo = _tipoDaPlate(p.plate);
  // Lo stato dichiarato dall'operativo alla liberazione della ribalta decide
  // la famiglia di parcheggi: pieno → A01–A12 / B01–B09, vuoto → A13–A24 / C–D.
  const stato = p.fullAllaLibera ? 'pieno' : 'vuoto';
  const liberi = _postiLiberiPerTipo(tipo, stato);

  const etichetta = `${tipo === 'cassa' ? 'casse' : 'container'} ${stato === 'pieno' ? 'piene' : 'vuote'}`
    .replace('container piene', 'container pieni').replace('container vuote', 'container vuoti');
  let html = `<div style="${_S.sectionLabel}">Parcheggio destinazione — ${etichetta}</div>`;

  if (!liberi.length) {
    html += '<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">Nessun parcheggio libero compatibile</div>';
  } else {
    html += '<div style="display:flex;flex-wrap:wrap">';
    liberi.forEach(id => {
      html += `<button style="${_S.ribaltaBtn}" onclick="confermaPicker('${p.id}','${id}')">${id}</button>`;
    });
    html += '</div>';
  }

  html += `<button style="margin-top:8px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:12px;cursor:pointer" onclick="chiudiCompletaForm('${p.id}')">Annulla</button>`;
  return html;
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

// Trova la chiave del reparto REVERSE in window._REPARTI (case/spazi-insensitive)
function _keyReverse() {
  if (!window._REPARTI) return null;
  return Object.keys(window._REPARTI)
    .find(k => String(k).trim().toUpperCase().replace(/\s+/g, '') === 'REVERSE') || null;
}

window.aprirCompletaCassa = function(spotId, plate, key) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  wrap.style.display = 'block';
  _renderCassaDefault(spotId, plate, key);
};

// Vista di default: ribalte libere del reparto REVERSE come pulsanti diretti
function _renderCassaDefault(spotId, plate, key) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;

  const kRev = _keyReverse();
  const libere = kRev ? _ribalteLiberePerReparto(kRev) : [];

  let h = `<div style="${_S.sectionLabel}">Ribalte libere REVERSE:</div>`;
  if (libere.length) {
    h += '<div style="display:flex;flex-wrap:wrap">';
    libere.forEach(r => {
      h += `<button style="${_S.ribaltaBtn}" onclick="confermaCassaPicker('${spotId}','${plate}','${key}','${r.id}')">${r.id}</button>`;
    });
    h += '</div>';
  } else {
    h += '<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">Nessuna ribalta REVERSE libera</div>';
  }

  h += `<div style="margin-top:8px"><button style="${_S.navBtn}" onclick="_renderCassaEdifici('${spotId}','${plate}','${key}')">🔀 Altra ribalta</button></div>`;
  wrap.innerHTML = h;
}
window._renderCassaDefault = _renderCassaDefault;

function _renderCassaEdifici(spotId, plate, key) {
  const wrap = document.getElementById('cfCassa_' + key);
  if (!wrap) return;
  const libere = _ribalteLiberePerReparto(null);
  const pnt1 = libere.filter(r => r.id.startsWith('PNT1-'));
  const pnt2 = libere.filter(r => r.id.startsWith('PNT2-'));

  let h = `<button style="${_S.navBtn}" onclick="_renderCassaDefault('${spotId}','${plate}','${key}')">← Indietro</button>`;
  h += `<div style="${_S.sectionLabel}">Seleziona edificio:</div>`;
  if (pnt1.length) h += `<button style="${_S.navBtn}" onclick="_renderCassaReparti('${spotId}','${plate}','${key}','PNT1')">🏭 PNT1 (${pnt1.length})</button>`;
  if (pnt2.length) h += `<button style="${_S.navBtn}" onclick="_renderCassaReparti('${spotId}','${plate}','${key}','PNT2')">🏭 PNT2 (${pnt2.length})</button>`;
  if (!pnt1.length && !pnt2.length) h += '<div style="font-size:12px;color:var(--muted);margin-top:6px">Nessuna ribalta libera</div>';
  wrap.innerHTML = h;
}
window._renderCassaEdifici = _renderCassaEdifici;

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

// Completamento navettaggio: l'autista dichiara SOLO la ribalta di arrivo.
window.confermaNavetta = async function(id) {
  const input = document.getElementById('cfInput_' + id);
  const arr = (input?.value || '').trim().toUpperCase();
  if (!arr) { showToast('Inserisci la ribalta di arrivo', 'error'); return; }
  if (!isValidRibalta(arr)) { showToast(`Ribalta "${arr}" non valida.`, 'error'); return; }
  if (!window.NavetteCore) { showToast('Modulo navette non caricato', 'error'); return; }
  try {
    const pren = _prenotazioni.find(p => p.id === id);
    await window.NavetteCore.completaMissioneNavetta({ prenId: id, ribaltaArrivo: arr });
    try {
      await window.logHistory({
        spot: arr, action: 'Missione completata', tipo: 'container',
        plate: pren?.navettaId || null, origine: pren?.origine || null,
        destinazione: arr, ribaltaRichiesta: pren?.destinazione || null,
        navettaId: pren?.navettaId || null,
      });
    } catch (e) { console.error('Errore storico navetta:', e); }
    chiudiCompletaForm(id);
    showToast('Navettaggio completato', 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  }
};

async function _completaConPosto(id, postoFine) {

const destCheck = validateDestination(postoFine);

if (!destCheck.ok) { showToast(destCheck.msg, 'error'); return; }

const pren = _prenotazioni.find(p => p.id === id);

// Ribalta richiesta (da prenotazione) vs effettiva (postoFine): tracciate entrambe.
const ribaltaRichiesta = (pren && isValidRibalta(pren.destinazione))
  ? String(pren.destinazione).trim().toUpperCase() : null;

try {

const ops = [];

ops.push(updateDoc(doc(window.db, 'prenotazioni', id), {

stato: 'completata',

completataAt: serverTimestamp(),

postoFine,

ribaltaRichiesta

}));

if (pren) {

const origine = (pren.spotId || '').trim().toUpperCase();

const dest = postoFine.trim().toUpperCase();

// Stato del veicolo in transito:
// - missione ribalta → dichiarazione dell'operativo in `fullAllaLibera`
// - prenotazione ordinaria → flag `full` del posto d'origine, letto prima di liberarlo
const statoPieno = (pren.tipoMissione === 'ribalta')
  ? !!pren.fullAllaLibera
  : !!(_spots[origine] && _spots[origine].full);

if (isValidSpot(origine)) {

ops.push(setDoc(doc(window.db, 'spots', origine), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

} else if (isValidRibalta(origine)) {

ops.push(setDoc(doc(window.db, 'ribalte', origine), {

occupied: false, plate: null, since: null, user: null, full: false, inUscita: false, ribaltaRichiesta: null

}, { merge: true }));

}

if (isValidSpot(dest)) {

ops.push(setDoc(doc(window.db, 'spots', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

full: statoPieno,

}, { merge: true }));

} else if (isValidRibalta(dest)) {

ops.push(setDoc(doc(window.db, 'ribalte', dest), {

occupied: true,

plate: pren.plate || null,

since: serverTimestamp(),

user: pren.utenteEmail || null,

full: statoPieno,

inUscita: false,

ribaltaRichiesta,

}, { merge: true }));

}

ops.push(window.logHistory({

spot: dest,

action: 'Missione completata',

tipo: _tipoDaPlate(pren.plate),

plate: pren.plate || null,

origine,

destinazione: dest,

ribaltaRichiesta,

richiedente: pren.operatoreNome || pren.utenteNome || pren.operatoreEmail || pren.utenteEmail || null,

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

window._popupCassaMostraEdifici = _popupCassaMostraEdifici;
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
    // Stato del veicolo letto PRIMA di liberare il posto: se partiva pieno,
    // resta pieno finché l'operativo non dichiara la ribalta vuota.
    const eraPieno = !!(_spots[spotId] && _spots[spotId].full);
    const ops = [];
    ops.push(setDoc(doc(window.db, 'spots', spotId), {
      occupied: false, plate: null, since: null, user: null, full: false, bloccoPlate: null,
      urgente: false, urgentePlate: null
    }, { merge: true }));
    ops.push(setDoc(doc(window.db, 'ribalte', ribaltaId), {
      occupied: true, plate: plate || null, since: serverTimestamp(), user: user?.email || null, full: eraPieno,
      inUscita: false, ribaltaRichiesta: null,
    }, { merge: true }));
    ops.push(window.logHistory({
      spot: ribaltaId, action: 'Missione completata', tipo: 'cassa',
      plate: plate || null, origine: spotId, destinazione: ribaltaId,
      ribaltaRichiesta: null,
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

stato: 'completata', completataAt: serverTimestamp(), postoFine: ribaltaId,
ribaltaRichiesta: isValidRibalta(pren.destinazione) ? String(pren.destinazione).trim().toUpperCase() : null,

}));

const spotId = (pren.spotId || '').trim();

// Stato del veicolo letto PRIMA di liberare il posto d'origine.
const eraPieno = !!(spotId && _spots[spotId] && _spots[spotId].full);

if (spotId) {

ops.push(setDoc(doc(window.db, 'spots', spotId), {

occupied: false, plate: null, since: null, user: null, full: false

}, { merge: true }));

}

ops.push(setDoc(doc(window.db, 'ribalte', ribaltaId), {

occupied: true, plate: pren.plate || null, since: serverTimestamp(), user: pren.operatoreEmail || null, full: eraPieno,
inUscita: false,
ribaltaRichiesta: isValidRibalta(pren.destinazione) ? String(pren.destinazione).trim().toUpperCase() : null,

}, { merge: true }));

ops.push(window.logHistory({

spot: ribaltaId, action: 'Missione completata', tipo: 'cassa',

plate: pren.plate || null, origine: spotId, destinazione: ribaltaId,

ribaltaRichiesta: isValidRibalta(pren.destinazione) ? String(pren.destinazione).trim().toUpperCase() : null,

richiedente: pren.operatoreNome || pren.operatoreEmail || null,

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
