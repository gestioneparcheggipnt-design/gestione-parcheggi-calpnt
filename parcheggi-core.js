// ── parcheggi-core.js ─────────────────────────────────────────────────────────
// Motore dei parcheggi. Condiviso desktop + mobile (come navette-core.js).
//
// Desktop: caricato da app-desktop.js  → usato via window.ParcheggiCore
// Mobile : caricato da mobile.html     → usato via window.ParcheggiCore
// Gli altri moduli NON lo importano: usano sempre window.ParcheggiCore, così
// esiste una sola istanza (la cache-busting ?v= creerebbe copie distinte).
//
// Responsabilità:
//   1. Tabella posti → derivati: SPOT_DEFS, ZONES, criteri
//      Fonte: config/posti { righe:[...] } se esiste (modificabile da Impostazioni),
//      altrimenti parcheggi-data.js (valori di partenza). Al primo salvataggio
//      dall'app la tabella viene copiata su Firestore.
//   2. Posti e ribalte attivi           → config/parcheggi { disattivati:[], ribalteDisattivate:[] }
//   3. Occupazione a sotto-posti        → spots/<posto>.occupanti
//   4. Scritture SEMPRE in transazione  → assegna / libera / aggiorna / sposta
//
// ── Documento spots/<posto> ───────────────────────────────────────────────────
//   occupanti: {                       // chiave = primo sotto-posto occupato
//     "1": { slot:[1], tipo:'cassa', plate:'123', since, user, full, damaged,
//            unusable, urgente, urgentePlate, bloccoPlate },
//     "3": { slot:[3], ... }
//   }
//   targhe: ['123', ...]               // per query array-contains
//   inutilizzabile: false              // blocco TEMPORANEO del posto (dal campo):
//                                      // resta visibile ma non riceve mezzi.
//                                      // ≠ disattivato (config, solo admin) e
//                                      // ≠ unusable del singolo mezzo.
//
// Mappa (e non array) perché serverTimestamp() non è ammesso dentro gli array.
// I documenti nel vecchio formato (occupied/plate a livello posto) vengono
// letti correttamente e riscritti nel nuovo formato alla prima scrittura.

import { IMG_W, IMG_H, PARCHEGGI, PATCHES } from './parcheggi-data.js';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction,
  serverTimestamp, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const _db = () => window.db;
const RE_CASSA = /^\d{3}$/;
const CAMPI_MEZZO = ['full', 'damaged', 'unusable', 'urgente', 'urgentePlate', 'bloccoPlate'];

// ══════════════════════════════════════════════════════════════════════════════
// 1. TABELLA
// ══════════════════════════════════════════════════════════════════════════════
const _def = {};          // id → riga tabella
const _ordine = [];       // id in ordine di tabella
const _zoneOrdine = [];   // zone in ordine di prima apparizione
let _fonteTabella = 'codice';   // 'codice' (parcheggi-data.js) | 'firestore' (config/posti)

const RE_ID_POSTO = /^[A-Z0-9][A-Z0-9-]{0,9}$/;

/** Riga normalizzata (maiuscole, numeri, ammessi validi). Non valida. */
function _normRiga(p) {
  const ammessi = ['container', 'cassa'].filter(t => (p.ammessi || []).includes(t));
  const rect = Array.isArray(p.rect) ? p.rect.slice(0, 4).map(Number) : [];
  const slide = (p.slide === '' || p.slide === null || p.slide === undefined) ? null : Number(p.slide);
  return {
    id: String(p.id || '').trim().toUpperCase(),
    zona: String(p.zona || '').trim().toUpperCase(),
    ammessi,
    stato: p.stato,
    sotto: Number(p.sotto) || 1,
    slide: Number.isFinite(slide) ? slide : null,
    rect,
  };
}

/** Errori di una riga (vuoto = valida). */
function validaRiga(p) {
  const r = _normRiga(p), e = [];
  if (!RE_ID_POSTO.test(r.id)) e.push('ID non valido (lettere, numeri e trattino, max 10)');
  if (!r.zona) e.push('Zona mancante');
  if (!r.ammessi.length) e.push('Indica almeno un tipo ammesso');
  if (r.sotto < 1 || r.sotto > 3 || !Number.isInteger(r.sotto)) e.push('Sotto-posti tra 1 e 3');
  if (r.ammessi.length === 1 && r.ammessi[0] === 'container' && r.sotto !== 1)
    e.push('Posto solo container: sotto-posti deve essere 1');
  if (r.stato !== 'pieno' && r.stato !== 'vuoto') e.push("Stato deve essere 'pieno' o 'vuoto'");
  if (r.rect.length !== 4 || r.rect.some(n => !Number.isFinite(n) || n < 0)) e.push('Rettangolo: 4 numeri ≥ 0 (x, y, larghezza, altezza)');
  return e;
}

/** Ricarica la tabella SUL POSTO (stessi oggetti) da un elenco di righe. */
function _caricaTabella(righe) {
  Object.keys(_def).forEach(k => delete _def[k]);
  _ordine.length = 0; _zoneOrdine.length = 0;
  (righe || []).forEach(p => {
    const r = _normRiga(p);
    const err = (m) => console.error(`[parcheggi] ${r.id || '?'}: ${m}`);
    if (_def[r.id]) { err('ID duplicato, riga ignorata'); return; }
    validaRiga(r).forEach(err);
    if (!r.id) return;
    _def[r.id] = { id: r.id, zona: r.zona, ammessi: r.ammessi, stato: r.stato,
                   sotto: Math.min(3, Math.max(1, r.sotto)), slide: r.slide,
                   rect: r.rect.length === 4 ? r.rect : [0, 0, 0, 0] };
    _ordine.push(r.id);
    if (!_zoneOrdine.includes(r.zona)) _zoneOrdine.push(r.zona);
  });
}
_caricaTabella(PARCHEGGI);

/** Copia della tabella corrente (righe pronte per config/posti). */
function righeTabella() {
  return _ordine.map(id => { const d = _def[id];
    return { id: d.id, zona: d.zona, ammessi: d.ammessi.slice(), stato: d.stato, sotto: d.sotto, slide: d.slide, rect: d.rect.slice() }; });
}
function fonteTabella() { return _fonteTabella; }

function defPosto(id) { return _def[String(id || '').trim().toUpperCase()] || null; }
function esiste(id)    { return !!defPosto(id); }
function accetta(id, tipo) { const d = defPosto(id); return !!d && d.ammessi.includes(tipo); }
function zone() { return _zoneOrdine.slice(); }

/** Criterio del posto: { tipo, ammessi, stato, slide, zona, sotto }.
 *  `tipo` = primo ammesso (compatibilità con il vecchio SPOT_CRITERI). */
function criterio(id) {
  const d = defPosto(id);
  if (!d) return null;
  return { tipo: d.ammessi[0], ammessi: d.ammessi.slice(), stato: d.stato,
           slide: d.slide, zona: d.zona, sotto: d.sotto };
}

function tipoDaTarga(plate) {
  return RE_CASSA.test(String(plate || '').trim()) ? 'cassa' : 'container';
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. ATTIVI / DISATTIVATI  (config/parcheggi)
// ══════════════════════════════════════════════════════════════════════════════
let _disattivati = new Set();
let _configCaricata = false;

function isAttivo(id) { const d = defPosto(id); return !!d && !_disattivati.has(d.id); }
function idAttivi()   { return _ordine.filter(id => !_disattivati.has(id)); }
function idTutti()    { return _ordine.slice(); }
function disattivati(){ return [..._disattivati]; }

// Derivati MUTATI SUL POSTO (stesso oggetto/array): chi ne tiene un riferimento
// (es. import { SPOT_DEFS } nel mobile) vede sempre la versione aggiornata.
const SPOT_DEFS = [];   // [id, zona, x, y, w, h] — solo posti attivi
const ZONES = {};       // zona → [id] — solo posti attivi

// ── Ribalte disattivate (config/parcheggi.ribalteDisattivate) ────────────────
// L'ELENCO delle ribalte resta in config/magazzino (reparti → ribalte). Qui c'è
// solo quali sono spente: una ribalta disattivata resta nel suo reparto ma per
// il sistema non esiste. Desktop e mobile filtrano REPARTI con filtraReparti(),
// così tutti i picker e le validazioni la escludono senza modifiche locali.
let _ribDis = new Set();
const _normRib = (id) => String(id || '').trim().toUpperCase();

function ribaltaAttiva(id)    { const k = _normRib(id); return !!k && !_ribDis.has(k); }
function ribalteDisattivate() { return [..._ribDis].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }

/** Copia di { reparto: [ribalte] } senza le ribalte disattivate. */
function filtraReparti(reparti) {
  const out = {};
  Object.keys(reparti || {}).forEach(k => {
    out[k] = (reparti[k] || []).filter(r => !_ribDis.has(_normRib(r)));
  });
  return out;
}

function _ricostruisciDerivati() {
  SPOT_DEFS.length = 0;
  idAttivi().forEach(id => { const d = _def[id]; SPOT_DEFS.push([id, d.zona, ...d.rect]); });
  Object.keys(ZONES).forEach(k => delete ZONES[k]);
  _zoneOrdine.forEach(z => { ZONES[z] = idAttivi().filter(id => _def[id].zona === z); });
}
_ricostruisciDerivati();

// ══════════════════════════════════════════════════════════════════════════════
// 3. VISTA DI UN POSTO
// ══════════════════════════════════════════════════════════════════════════════
function _toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  return v instanceof Date ? v : new Date(v);
}

function _normPlate(p) { return String(p || '').trim().toUpperCase(); }

/** Occupanti grezzi dal documento, gestendo anche il vecchio formato. */
function _occupantiDaDoc(id, data) {
  const d = defPosto(id);
  if (!data) return [];
  if (data.occupanti && typeof data.occupanti === 'object') {
    return Object.values(data.occupanti)
      .filter(o => o && o.plate && Array.isArray(o.slot) && o.slot.length)
      .map(o => ({ ...o }));
  }
  // Vecchio formato: un solo mezzo a livello posto
  if (data.occupied && data.plate) {
    const tipo = tipoDaTarga(data.plate);
    const n = d ? d.sotto : 1;
    const slot = tipo === 'container' ? Array.from({ length: n }, (_, i) => i + 1) : [1];
    const o = { slot, tipo, plate: data.plate, since: data.since || null, user: data.user || null };
    CAMPI_MEZZO.forEach(k => { if (data[k] !== undefined) o[k] = data[k]; });
    return [o];
  }
  return [];
}

/**
 * Vista normalizzata di un posto.
 * Contiene i dati della tabella, l'elenco occupanti (ordinato per sotto-posto)
 * e — per compatibilità con il codice esistente — i campi del PRIMO occupante
 * a livello posto (occupied, plate, since, user, full, damaged, ...).
 * opts.date: converte i `since` in Date (desktop e mobile lo vogliono).
 */
function vista(id, data, opts = {}) {
  const d = defPosto(id);
  if (!d) return null;
  let occ = _occupantiDaDoc(d.id, data)
    .map(o => ({ ...o, slot: o.slot.map(Number).sort((a, b) => a - b) }))
    .sort((a, b) => a.slot[0] - b.slot[0]);
  if (opts.date) occ = occ.map(o => ({ ...o, since: _toDate(o.since) }));
  const usati = new Set(occ.flatMap(o => o.slot));
  const liberi = [];
  for (let i = 1; i <= d.sotto; i++) if (!usati.has(i)) liberi.push(i);
  const p = occ[0] || null;
  // Blocco del posto: campo nuovo, oppure vecchio formato (posto libero con unusable)
  const inutilizzabile = !!(data && (data.inutilizzabile ||
    (!data.occupanti && !data.occupied && data.unusable)));
  return {
    id: d.id, zone: d.zona, zona: d.zona,
    x: d.rect[0], y: d.rect[1], w: d.rect[2], h: d.rect[3],
    ammessi: d.ammessi, statoPosto: d.stato, sotto: d.sotto, slide: d.slide,
    attivo: isAttivo(d.id),
    inutilizzabile,
    occupanti: occ,
    slotLiberi: liberi,
    statoOcc: occ.length === 0 ? 'libero' : (liberi.length ? 'parziale' : 'pieno'),
    // ── compatibilità: primo occupante ──
    occupied: occ.length > 0,
    plate: p ? p.plate : null,
    since: p ? (p.since ?? null) : null,
    user: p ? (p.user ?? null) : null,
    full: p ? !!p.full : false,
    damaged: p ? !!p.damaged : false,
    unusable: p ? !!p.unusable : inutilizzabile,
    urgente: p ? !!p.urgente : false,
    urgentePlate: p ? (p.urgentePlate ?? null) : null,
    bloccoPlate: p ? (p.bloccoPlate ?? null) : null,
  };
}

function vistaVuota(id, opts) { return vista(id, null, opts); }

/** Il posto può ricevere un mezzo di questo tipo adesso? */
function disponibilePer(v, tipo) {
  if (!v || !v.attivo || v.inutilizzabile || !v.ammessi.includes(tipo)) return false;
  if (tipo === 'container') return v.occupanti.length === 0;
  return v.slotLiberi.length > 0;
}

/** Testo breve dello stato: 'libero' | '1/2' | 'pieno' */
function etichettaOcc(v) {
  if (!v) return '';
  if (v.statoOcc === 'libero') return 'libero';
  if (v.statoOcc === 'pieno') return 'pieno';
  return `${v.sotto - v.slotLiberi.length}/${v.sotto}`;
}

/** Trova il mezzo con questa targa in una mappa { id: vista }. */
function trovaMezzo(mappa, plate) {
  const t = _normPlate(plate);
  if (!t) return null;
  for (const v of Object.values(mappa || {})) {
    const o = (v.occupanti || []).find(x => _normPlate(x.plate) === t);
    if (o) return { posto: v.id, vista: v, mezzo: o };
  }
  return null;
}

/** Elenco piatto di tutti i mezzi parcheggiati: un elemento per mezzo,
 *  con i campi del mezzo + posto (id) e le info del posto. */
function mezzi(mappa) {
  const out = [];
  Object.values(mappa || {}).forEach(v => (v.occupanti || []).forEach(o => out.push({
    ...o, id: v.id, posto: v.id, zone: v.zone, zona: v.zona, occupied: true, vistaPosto: v,
  })));
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. CALCOLI PURI (usati dalle transazioni, testabili senza Firestore)
// ══════════════════════════════════════════════════════════════════════════════
function _err(msg, code) { const e = new Error(msg); e.code = code; return e; }

/**
 * Calcola i nuovi occupanti dopo aver assegnato `mezzo` al posto `v`.
 * Lancia un errore leggibile se non è possibile.
 * opts.ignoraAmmessi: consente un tipo non previsto dal posto (uso manuale admin)
 */
function calcolaAssegna(v, mezzo, opts = {}) {
  const plate = _normPlate(mezzo.plate);
  if (!plate) throw _err('Targa / identificativo mancante', 'targa');
  if (!v) throw _err('Posto inesistente', 'posto');
  if (!v.attivo) throw _err(`Il posto ${v.id} è disattivato`, 'disattivato');
  if (v.inutilizzabile) throw _err(`Il posto ${v.id} è segnato come inutilizzabile`, 'inutilizzabile');
  const tipo = mezzo.tipo || tipoDaTarga(plate);
  if (!opts.ignoraAmmessi && !v.ammessi.includes(tipo))
    throw _err(`Il posto ${v.id} non accetta ${tipo === 'cassa' ? 'casse' : 'container'}`, 'ammessi');
  if (v.occupanti.some(o => _normPlate(o.plate) === plate))
    throw _err(`${plate} è già sul posto ${v.id}`, 'duplicato');
  let slot;
  if (tipo === 'container') {
    if (v.occupanti.length) throw _err(`Il posto ${v.id} è occupato`, 'occupato');
    slot = Array.from({ length: v.sotto }, (_, i) => i + 1);
  } else {
    if (!v.slotLiberi.length) throw _err(`Il posto ${v.id} è pieno`, 'occupato');
    slot = [v.slotLiberi[0]];
  }
  const nuovo = { slot, tipo, plate };
  ['since', 'user', ...CAMPI_MEZZO].forEach(k => { if (mezzo[k] !== undefined) nuovo[k] = mezzo[k]; });
  return { occupanti: [...v.occupanti, nuovo], nuovo };
}

/** Rimuove il mezzo `plate` (o l'unico presente se plate è vuoto). */
function calcolaLibera(v, plate) {
  if (!v) return { occupanti: [], rimosso: null };
  const t = _normPlate(plate);
  let idx;
  if (t) idx = v.occupanti.findIndex(o => _normPlate(o.plate) === t);
  else if (v.occupanti.length === 1) idx = 0;
  else if (v.occupanti.length === 0) idx = -1;
  else throw _err(`Sul posto ${v.id} ci sono più mezzi: indicare quale liberare`, 'ambiguo');
  if (idx < 0) return { occupanti: v.occupanti.slice(), rimosso: null };
  const occ = v.occupanti.slice();
  const [rimosso] = occ.splice(idx, 1);
  return { occupanti: occ, rimosso };
}

/** Aggiorna i campi del mezzo `plate` (o dell'unico presente). */
function calcolaAggiorna(v, plate, patch) {
  if (!v) throw _err('Posto inesistente', 'posto');
  const t = _normPlate(plate);
  let idx;
  if (t) idx = v.occupanti.findIndex(o => _normPlate(o.plate) === t);
  else if (v.occupanti.length === 1) idx = 0;
  else idx = v.occupanti.length ? -2 : -1;
  if (idx === -2) throw _err(`Sul posto ${v.id} ci sono più mezzi: indicare quale`, 'ambiguo');
  if (idx < 0) throw _err(`Mezzo non presente sul posto ${v.id}`, 'assente');
  const occ = v.occupanti.slice();
  const p = {};
  CAMPI_MEZZO.forEach(k => { if (patch[k] !== undefined) p[k] = patch[k]; });
  occ[idx] = { ...occ[idx], ...p };
  return { occupanti: occ, mezzo: occ[idx] };
}

/** Documento Firestore da scrivere per un elenco di occupanti.
 *  posto: la vista attuale, per conservare i campi del posto (inutilizzabile). */
function docDaOccupanti(occupanti, posto = null) {
  const map = {};
  occupanti.forEach(o => {
    const r = { slot: o.slot, tipo: o.tipo || tipoDaTarga(o.plate), plate: o.plate,
                since: o.since ?? serverTimestamp(), user: o.user ?? null };
    CAMPI_MEZZO.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; });
    map[String(o.slot[0])] = r;
  });
  return { occupanti: map, targhe: occupanti.map(o => o.plate),
           inutilizzabile: !!(posto && posto.inutilizzabile), aggiornato: serverTimestamp() };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. TRANSAZIONI
// ══════════════════════════════════════════════════════════════════════════════
const _ref = (id) => doc(_db(), 'spots', defPosto(id)?.id || String(id));

/** Dentro una transazione esistente: legge e restituisce la vista del posto.
 *  (Firestore richiede tutte le letture prima delle scritture.) */
async function txLeggi(tx, id) {
  const snap = await tx.get(_ref(id));
  return vista(id, snap.exists() ? snap.data() : null);
}
/** Dentro una transazione esistente: scrive gli occupanti calcolati.
 *  v: la vista letta con txLeggi (conserva i campi del posto). */
function txScrivi(tx, id, occupanti, v) {
  tx.set(_ref(id), docDaOccupanti(occupanti, v));
}

/**
 * Assegna un mezzo a un posto. Restituisce { posto, slot }.
 * mezzo: { plate, tipo?, since?, user?, full?, damaged?, unusable?, urgente? }
 */
async function assegna(id, mezzo, opts = {}) {
  if (!esiste(id)) throw _err(`Il posto ${id} non esiste`, 'posto');
  return runTransaction(_db(), async tx => {
    const v = await txLeggi(tx, id);
    const r = calcolaAssegna(v, mezzo, opts);
    txScrivi(tx, id, r.occupanti, v);
    return { posto: v.id, slot: r.nuovo.slot };
  });
}

/** Libera un mezzo. Restituisce il mezzo rimosso (o null se non c'era). */
async function libera(id, plate = null) {
  if (!esiste(id)) return null;
  return runTransaction(_db(), async tx => {
    const v = await txLeggi(tx, id);
    const r = calcolaLibera(v, plate);
    if (r.rimosso) txScrivi(tx, id, r.occupanti, v);
    return r.rimosso;
  });
}

/** Aggiorna i campi di un mezzo (full, damaged, unusable, urgente, ...). */
async function aggiorna(id, plate, patch) {
  return runTransaction(_db(), async tx => {
    const v = await txLeggi(tx, id);
    const r = calcolaAggiorna(v, plate, patch);
    txScrivi(tx, id, r.occupanti, v);
    return r.mezzo;
  });
}

/** Sposta un mezzo da un posto all'altro (una sola transazione).
 *  Il mezzo porta con sé anzianità e flag. opts.patch: campi da cambiare. */
async function sposta(daId, aId, plate, opts = {}) {
  return runTransaction(_db(), async tx => {
    const da = await txLeggi(tx, daId);
    const a  = await txLeggi(tx, aId);
    const lib = calcolaLibera(da, plate);
    if (!lib.rimosso) throw _err(`${plate || 'Il mezzo'} non è più sul posto ${daId}`, 'assente');
    const m = { ...lib.rimosso, ...(opts.patch || {}) };
    delete m.slot;
    const ass = calcolaAssegna(a, m, opts);
    txScrivi(tx, daId, lib.occupanti, da);
    txScrivi(tx, aId, ass.occupanti, a);
    return { mezzo: lib.rimosso, slot: ass.nuovo.slot };
  });
}

/** Vista ricalcolata dopo una modifica agli occupanti (per calcoli in serie). */
function _vistaConOccupanti(id, occupanti, prima) {
  return vista(id, { occupanti: Object.fromEntries(occupanti.map(o => [String(o.slot[0]), o])),
                     inutilizzabile: !!(prima && prima.inutilizzabile) });
}

/**
 * Assegna più mezzi in UNA transazione: o tutti o nessuno.
 * lista: [{ posto, mezzo }, ...] — anche sullo stesso posto (es. 2 casse su
 * un posto da 2 sotto-posti). Restituisce [{ posto, slot }, ...].
 */
async function assegnaMolti(lista, opts = {}) {
  const ids = [];
  lista.forEach(x => {
    const d = defPosto(x.posto);
    if (!d) throw _err(`Il posto ${x.posto} non esiste`, 'posto');
    if (!ids.includes(d.id)) ids.push(d.id);
  });
  return runTransaction(_db(), async tx => {
    const viste = {};
    for (const id of ids) viste[id] = await txLeggi(tx, id);
    const res = [];
    for (const x of lista) {
      const id = defPosto(x.posto).id;
      const r = calcolaAssegna(viste[id], x.mezzo, opts);
      viste[id] = _vistaConOccupanti(id, r.occupanti, viste[id]);
      res.push({ posto: id, slot: r.nuovo.slot });
    }
    ids.forEach(id => txScrivi(tx, id, viste[id].occupanti, viste[id]));
    return res;
  });
}

/** Segna / toglie il blocco temporaneo del posto ("posto inutilizzabile").
 *  Si può bloccare solo un posto senza mezzi. */
async function impostaInutilizzabile(id, val) {
  if (!esiste(id)) throw _err(`Il posto ${id} non esiste`, 'posto');
  return runTransaction(_db(), async tx => {
    const v = await txLeggi(tx, id);
    if (val && v.occupanti.length) throw _err(`Sul posto ${v.id} ci sono mezzi: liberalo prima`, 'occupato');
    txScrivi(tx, id, v.occupanti, { ...v, inutilizzabile: !!val });
  });
}

/** Cerca su Firestore il posto dove si trova una targa (query diretta). */
async function cercaTarga(plate) {
  const t = _normPlate(plate);
  if (!t) return null;
  const snap = await getDocs(query(collection(_db(), 'spots'), where('targhe', 'array-contains', t)));
  for (const d of snap.docs) {
    const v = vista(d.id, d.data(), { date: true });
    const m = v && v.occupanti.find(o => _normPlate(o.plate) === t);
    if (m) return { posto: v.id, vista: v, mezzo: m };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. LISTENER (uno solo, condiviso fra tutti i moduli della pagina)
// ══════════════════════════════════════════════════════════════════════════════
let _docs = {};               // id → data grezza
let _unsubSpots = null, _unsubCfg = null, _unsubTab = null;
const _subs = new Set();      // callback(mappaRaw, mappaDate)

/** Mappa { id: vista } dei soli posti ATTIVI. */
function mappa(opts = {}) {
  const m = {};
  idAttivi().forEach(id => { m[id] = vista(id, _docs[id] || null, opts); });
  return m;
}

function _notifica() {
  _subs.forEach(cb => { try { cb(); } catch (e) { console.error('[ParcheggiCore] subscriber:', e); } });
}

function _avvia() {
  if (!_unsubTab) {
    _unsubTab = onSnapshot(doc(_db(), 'config', 'posti'), snap => {
      const righe = snap.exists() && Array.isArray(snap.data().righe) ? snap.data().righe : null;
      _fonteTabella = righe ? 'firestore' : 'codice';
      _caricaTabella(righe || PARCHEGGI);
      _ricostruisciDerivati();
      _notifica();
    }, err => console.error('[ParcheggiCore] config/posti:', err));
  }
  if (!_unsubCfg) {
    _unsubCfg = onSnapshot(doc(_db(), 'config', 'parcheggi'), snap => {
      const lista = (snap.exists() && Array.isArray(snap.data().disattivati)) ? snap.data().disattivati : [];
      _disattivati = new Set(lista.map(x => String(x).trim().toUpperCase()));
      const ribL = (snap.exists() && Array.isArray(snap.data().ribalteDisattivate)) ? snap.data().ribalteDisattivate : [];
      const nuove = new Set(ribL.map(_normRib));
      const ribCambiate = nuove.size !== _ribDis.size || [...nuove].some(x => !_ribDis.has(x));
      _ribDis = nuove;
      _configCaricata = true;
      _ricostruisciDerivati();
      // Prima gli elenchi ribalte (desktop/mobile ricalcolano REPARTI), poi i render
      if (ribCambiate && typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('calpnt:ribalte')); } catch (e) { console.error(e); }
      }
      _notifica();
    }, err => console.error('[ParcheggiCore] config/parcheggi:', err));
  }
  if (!_unsubSpots) {
    _unsubSpots = onSnapshot(collection(_db(), 'spots'), snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') delete _docs[ch.doc.id];
        else _docs[ch.doc.id] = ch.doc.data();
      });
      _notifica();
    }, err => console.error('[ParcheggiCore] spots:', err));
  }
}

/**
 * Si iscrive ai cambi di posti E di configurazione. Avvia i listener se serve.
 * cb() viene chiamata a ogni cambio; leggere i dati con mappa({date:true}).
 * Restituisce la funzione per disiscriversi (i listener si fermano quando
 * non resta nessun iscritto).
 */
function ascolta(cb) {
  _subs.add(cb);
  _avvia();
  if (Object.keys(_docs).length || _configCaricata) { try { cb(); } catch (e) { console.error(e); } }
  return () => {
    _subs.delete(cb);
    if (!_subs.size) {
      if (_unsubSpots) { _unsubSpots(); _unsubSpots = null; }
      if (_unsubCfg)   { _unsubCfg();   _unsubCfg   = null; }
      if (_unsubTab)   { _unsubTab();   _unsubTab   = null; }
      _docs = {};
    }
  };
}

/** Riempie `target` (oggetto esistente) con la mappa corrente, sul posto. */
function riempi(target, opts = {}) {
  const m = mappa(opts);
  Object.keys(target).forEach(k => { if (!m[k]) delete target[k]; });
  Object.assign(target, m);
  return target;
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. ATTIVAZIONE / DISATTIVAZIONE (solo amministratore)
// ══════════════════════════════════════════════════════════════════════════════
/** Motivo per cui un posto non può essere disattivato, oppure null. */
async function motivoBloccoDisattivazione(id) {
  const d = defPosto(id);
  if (!d) return 'Posto inesistente';
  const v = vista(d.id, _docs[d.id] || null);
  if (v.occupanti.length) return `Sul posto ci sono mezzi (${v.occupanti.map(o => o.plate).join(', ')}): liberalo prima`;
  const aperte = ['in_attesa', 'creata'];
  for (const campo of ['spotId', 'destinazione', 'origine']) {
    const s = await getDocs(query(collection(_db(), 'prenotazioni'), where(campo, '==', d.id)));
    if (s.docs.some(x => aperte.includes(x.data().stato)))
      return 'Il posto è coinvolto in una missione aperta: completala o annullala prima';
  }
  return null;
}

async function impostaAttivo(id, attivo, user) {
  const d = defPosto(id);
  if (!d) throw _err('Posto inesistente', 'posto');
  if (!attivo) {
    const m = await motivoBloccoDisattivazione(d.id);
    if (m) throw _err(m, 'bloccato');
  }
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  await runTransaction(_db(), async tx => {
    const spotSnap = await tx.get(_ref(d.id));
    const cfgSnap  = await tx.get(cfgRef);
    if (!attivo) {
      const v = vista(d.id, spotSnap.exists() ? spotSnap.data() : null);
      if (v.occupanti.length) throw _err('Nel frattempo è stato parcheggiato un mezzo: liberalo prima', 'bloccato');
    }
    const lista = new Set(((cfgSnap.exists() && cfgSnap.data().disattivati) || []).map(x => String(x).toUpperCase()));
    if (attivo) lista.delete(d.id); else lista.add(d.id);
    tx.set(cfgRef, {
      disattivati: [...lista].sort(),
      aggiornatoDa: user?.email || user?.name || null,
      aggiornatoIl: serverTimestamp(),
    }, { merge: true });
  });
  if (window.logHistory) {
    try { await window.logHistory({ spot: d.id, action: attivo ? 'Posto attivato' : 'Posto disattivato' }); } catch (e) {}
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. RIBALTE: ATTIVAZIONE / DISATTIVAZIONE (amministratore e amministrativo)
// ══════════════════════════════════════════════════════════════════════════════
const _APERTE = ['in_attesa', 'creata'];

/** Motivo per cui una ribalta non può essere disattivata, oppure null. */
async function motivoBloccoRibalta(id) {
  const k = _normRib(id);
  if (!k) return 'Ribalta non valida';
  const rs = await getDoc(doc(_db(), 'ribalte', k));
  const r = rs.exists() ? rs.data() : null;
  if (r && r.occupied) {
    if (r.inLiberazione) return `Ribalta in liberazione (${r.plate || 'mezzo'}): attendi il completamento dell'autista`;
    if (r.inSpostamento) return `Ribalta in spostamento (${r.plate || 'mezzo'}): completa o annulla lo spostamento`;
    return `Ribalta occupata da ${r.plate || 'un mezzo'}: liberala prima`;
  }
  const ns = await getDocs(query(collection(_db(), 'navette'), where('posizione', '==', k)));
  if (ns.docs.length) return `Navetta ${ns.docs[0].data().nome || ns.docs[0].id} in posizione: spostala prima`;
  for (const campo of ['destinazione', 'origine', 'spotId', 'ribaltaArrivo']) {
    const s = await getDocs(query(collection(_db(), 'prenotazioni'), where(campo, '==', k)));
    if (s.docs.some(x => _APERTE.includes(x.data().stato)))
      return 'La ribalta è coinvolta in una missione aperta: completala o annullala prima';
  }
  return null;
}

async function impostaRibaltaAttiva(id, attiva, user) {
  const k = _normRib(id);
  if (!k) throw _err('Ribalta non valida', 'ribalta');
  if (!attiva) {
    const m = await motivoBloccoRibalta(k);
    if (m) throw _err(m, 'bloccato');
  }
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  const ribRef = doc(_db(), 'ribalte', k);
  await runTransaction(_db(), async tx => {
    const ribSnap = await tx.get(ribRef);
    const cfgSnap = await tx.get(cfgRef);
    if (!attiva && ribSnap.exists() && ribSnap.data().occupied)
      throw _err('Nel frattempo la ribalta è stata occupata: liberala prima', 'bloccato');
    const lista = new Set(((cfgSnap.exists() && cfgSnap.data().ribalteDisattivate) || []).map(_normRib));
    if (attiva) lista.delete(k); else lista.add(k);
    // Solo questi tre campi: l'amministrativo non può toccare 'disattivati' (regole Firestore)
    tx.set(cfgRef, {
      ribalteDisattivate: [...lista].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      aggiornatoDa: user?.email || user?.name || null,
      aggiornatoIl: serverTimestamp(),
    }, { merge: true });
  });
  if (window.logHistory) {
    try { await window.logHistory({ spot: k, ribalta: k, action: attiva ? 'Ribalta attivata' : 'Ribalta disattivata' }); } catch (e) {}
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. MODIFICA / ELIMINAZIONE (solo amministratore, da Impostazioni)
// ══════════════════════════════════════════════════════════════════════════════
const _who = (u) => u?.email || u?.name || null;
const _sortId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** Crea (idOriginale vuoto) o modifica un posto. Struttura (ID, tipi, sotto-posti)
 *  modificabile solo se il posto è vuoto e senza missioni aperte. */
async function salvaPosto(riga, idOriginale, user) {
  const r = _normRiga(riga);
  const errs = validaRiga(r);
  if (errs.length) throw _err(errs.join(' · '), 'valida');
  const old = idOriginale ? defPosto(idOriginale) : null;
  if (idOriginale && !old) throw _err('Posto inesistente', 'posto');
  if ((!old || r.id !== old.id) && defPosto(r.id)) throw _err(`Esiste già un posto ${r.id}`, 'valida');
  const struttura = old && (r.id !== old.id || r.sotto !== old.sotto ||
    r.ammessi.join() !== old.ammessi.join());
  if (struttura) {
    const m = await motivoBloccoDisattivazione(old.id);
    if (m) throw _err('ID, tipi ammessi e sotto-posti si cambiano solo a posto vuoto. ' + m, 'bloccato');
  }
  const tabRef = doc(_db(), 'config', 'posti');
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  await runTransaction(_db(), async tx => {
    const tabSnap = await tx.get(tabRef);
    const cfgSnap = await tx.get(cfgRef);
    if (struttura) {
      const sp = await tx.get(_ref(old.id));
      if (vista(old.id, sp.exists() ? sp.data() : null).occupanti.length)
        throw _err('Nel frattempo è stato parcheggiato un mezzo: liberalo prima', 'bloccato');
    }
    const righe = (tabSnap.exists() && Array.isArray(tabSnap.data().righe)) ? tabSnap.data().righe.map(_normRiga) : righeTabella();
    if (righe.some(x => x.id === r.id && (!old || x.id !== old.id))) throw _err(`Esiste già un posto ${r.id}`, 'valida');
    const i = old ? righe.findIndex(x => x.id === old.id) : -1;
    if (i >= 0) righe[i] = r; else righe.push(r);
    tx.set(tabRef, { righe, aggiornatoDa: _who(user), aggiornatoIl: serverTimestamp() });
    // rinomina di un posto disattivato: la disattivazione segue il nuovo ID
    const dis = (cfgSnap.exists() && cfgSnap.data().disattivati) || [];
    if (old && r.id !== old.id && dis.includes(old.id))
      tx.set(cfgRef, { disattivati: dis.map(x => x === old.id ? r.id : x).sort(_sortId) }, { merge: true });
  });
  if (window.logHistory) {
    try { await window.logHistory({ spot: r.id, action: old ? 'Posto modificato' : 'Posto creato',
      ...(old && old.id !== r.id ? { idPrecedente: old.id } : {}) }); } catch (e) {}
  }
}

async function eliminaPosto(id, user) {
  const d = defPosto(id);
  if (!d) throw _err('Posto inesistente', 'posto');
  const m = await motivoBloccoDisattivazione(d.id);
  if (m) throw _err(m, 'bloccato');
  const tabRef = doc(_db(), 'config', 'posti');
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  await runTransaction(_db(), async tx => {
    const tabSnap = await tx.get(tabRef);
    const cfgSnap = await tx.get(cfgRef);
    const sp = await tx.get(_ref(d.id));
    if (vista(d.id, sp.exists() ? sp.data() : null).occupanti.length)
      throw _err('Nel frattempo è stato parcheggiato un mezzo: liberalo prima', 'bloccato');
    const righe = ((tabSnap.exists() && Array.isArray(tabSnap.data().righe)) ? tabSnap.data().righe.map(_normRiga) : righeTabella())
      .filter(x => x.id !== d.id);
    tx.set(tabRef, { righe, aggiornatoDa: _who(user), aggiornatoIl: serverTimestamp() });
    const dis = (cfgSnap.exists() && cfgSnap.data().disattivati) || [];
    if (dis.includes(d.id)) tx.set(cfgRef, { disattivati: dis.filter(x => x !== d.id) }, { merge: true });
    if (sp.exists()) tx.delete(_ref(d.id));
  });
  if (window.logHistory) { try { await window.logHistory({ spot: d.id, action: 'Posto eliminato' }); } catch (e) {} }
}

// ── Ribalte: rinomina / elimina (config/magazzino + config/parcheggi) ─────────
const RE_RIBALTA = /^PNT[12]-\d{2}$/;

function _ribalteInMagazzino(m) {
  const tutte = [];
  Object.values(m.reparti || {}).forEach(r => (r.ribalte || []).forEach(x => tutte.push(_normRib(x))));
  (m.nonAssegnate || []).forEach(x => tutte.push(_normRib(x)));
  return tutte;
}

async function rinominaRibalta(vecchio, nuovo, user) {
  const a = _normRib(vecchio), b = _normRib(nuovo);
  if (!RE_RIBALTA.test(b)) throw _err('Formato ribalta non valido (es. PNT1-05)', 'valida');
  if (a === b) return;
  const m0 = await motivoBloccoRibalta(a);
  if (m0) throw _err('Si rinomina solo una ribalta non in uso. ' + m0, 'bloccato');
  const magRef = doc(_db(), 'config', 'magazzino');
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  await runTransaction(_db(), async tx => {
    const magSnap = await tx.get(magRef);
    const cfgSnap = await tx.get(cfgRef);
    const ribSnap = await tx.get(doc(_db(), 'ribalte', a));
    if (!magSnap.exists()) throw _err('Configurazione magazzino assente', 'config');
    if (ribSnap.exists() && ribSnap.data().occupied) throw _err('Nel frattempo la ribalta è stata occupata', 'bloccato');
    const mag = magSnap.data();
    if (_ribalteInMagazzino(mag).includes(b)) throw _err(`Esiste già la ribalta ${b}`, 'valida');
    const reparti = {};
    Object.keys(mag.reparti || {}).forEach(k => {
      const rr = mag.reparti[k];
      reparti[k] = { ...rr, ribalte: (rr.ribalte || []).map(x => _normRib(x) === a ? b : x).sort(_sortId) };
    });
    const nonAssegnate = (mag.nonAssegnate || []).map(x => _normRib(x) === a ? b : x);
    tx.set(magRef, { reparti, nonAssegnate }, { merge: true });
    const dis = ((cfgSnap.exists() && cfgSnap.data().ribalteDisattivate) || []).map(_normRib);
    if (dis.includes(a)) tx.set(cfgRef, { ribalteDisattivate: dis.map(x => x === a ? b : x).sort(_sortId),
      aggiornatoDa: _who(user), aggiornatoIl: serverTimestamp() }, { merge: true });
    if (ribSnap.exists()) tx.delete(doc(_db(), 'ribalte', a));
  });
  if (window.logHistory) { try { await window.logHistory({ spot: b, ribalta: b, idPrecedente: a, action: 'Ribalta rinominata' }); } catch (e) {} }
}

async function eliminaRibalta(id, user) {
  const a = _normRib(id);
  const m0 = await motivoBloccoRibalta(a);
  if (m0) throw _err(m0, 'bloccato');
  const magRef = doc(_db(), 'config', 'magazzino');
  const cfgRef = doc(_db(), 'config', 'parcheggi');
  await runTransaction(_db(), async tx => {
    const magSnap = await tx.get(magRef);
    const cfgSnap = await tx.get(cfgRef);
    const ribSnap = await tx.get(doc(_db(), 'ribalte', a));
    if (!magSnap.exists()) throw _err('Configurazione magazzino assente', 'config');
    if (ribSnap.exists() && ribSnap.data().occupied) throw _err('Nel frattempo la ribalta è stata occupata', 'bloccato');
    const mag = magSnap.data();
    const reparti = {};
    Object.keys(mag.reparti || {}).forEach(k => {
      const rr = mag.reparti[k];
      reparti[k] = { ...rr, ribalte: (rr.ribalte || []).filter(x => _normRib(x) !== a) };
    });
    tx.set(magRef, { reparti, nonAssegnate: (mag.nonAssegnate || []).filter(x => _normRib(x) !== a) }, { merge: true });
    const dis = ((cfgSnap.exists() && cfgSnap.data().ribalteDisattivate) || []).map(_normRib);
    if (dis.includes(a)) tx.set(cfgRef, { ribalteDisattivate: dis.filter(x => x !== a),
      aggiornatoDa: _who(user), aggiornatoIl: serverTimestamp() }, { merge: true });
    if (ribSnap.exists()) tx.delete(doc(_db(), 'ribalte', a));
  });
  if (window.logHistory) { try { await window.logHistory({ spot: a, ribalta: a, action: 'Ribalta eliminata' }); } catch (e) {} }
}

// ══════════════════════════════════════════════════════════════════════════════
// ESPORTAZIONE
// ══════════════════════════════════════════════════════════════════════════════
const ParcheggiCore = {
  // tabella
  IMG_W, IMG_H, PATCHES, SPOT_DEFS, ZONES,
  defPosto, esiste, accetta, zone, criterio, tipoDaTarga,
  // attivi
  isAttivo, idAttivi, idTutti, disattivati, impostaAttivo, motivoBloccoDisattivazione,
  // ribalte attive
  ribaltaAttiva, ribalteDisattivate, filtraReparti, impostaRibaltaAttiva, motivoBloccoRibalta,
  // modifica tabella / ribalte (Impostazioni)
  righeTabella, fonteTabella, validaRiga, salvaPosto, eliminaPosto, rinominaRibalta, eliminaRibalta,
  // viste
  vista, vistaVuota, disponibilePer, etichettaOcc, trovaMezzo, mezzi, mappa, riempi,
  // calcoli puri
  calcolaAssegna, calcolaLibera, calcolaAggiorna, docDaOccupanti,
  // scritture
  assegna, assegnaMolti, libera, aggiorna, sposta, impostaInutilizzabile, txLeggi, txScrivi, cercaTarga,
  // listener
  ascolta,
};

if (typeof window !== 'undefined') {
  window.ParcheggiCore = ParcheggiCore;
  window.IMG_W = IMG_W; window.IMG_H = IMG_H;
  window.SPOT_DEFS = SPOT_DEFS;
  window.ZONES = ZONES;
  window.PATCHES = PATCHES;
}

export { ParcheggiCore, SPOT_DEFS, ZONES, PATCHES, IMG_W, IMG_H };
export default ParcheggiCore;
