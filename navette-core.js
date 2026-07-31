// ── navette-core.js ───────────────────────────────────────────────────────────
// Motore dei "navettaggi interni". Condiviso desktop + mobile.
//
// Desktop: usato via window.NavetteCore.*  (caricato da app-desktop.js)
// Mobile : usato via import ES             (caricato da mobile.html)
//
// Dipende solo da: firebase-config.js (window.db) e, per la derivazione del
// reparto, da window.REPARTI (desktop, da config/magazzino) oppure
// window._REPARTI (mobile, statico da spots-data-mobile.js).
//
// NON tocca mai la collezione `spots`: le navette si muovono solo ribalta→ribalta.

import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot,
  query, runTransaction, serverTimestamp, setDoc, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Stato locale ────────────────────────────────────────────────────────────────
let _navette = {};       // { NAV1: {nome, attiva, stato, posizione, vuotoDa, missioneId} }
let _unsubNav = null;
let _onChange = null;

const _db = () => window.db;

// ── Derivazioni edificio / reparto da un id ribalta ─────────────────────────────
function edificioDi(ribaltaId) {
  const m = String(ribaltaId || '').trim().toUpperCase().match(/^(PNT[12])-/);
  return m ? m[1] : null;
}

function _repartiSource() {
  // Desktop: window.REPARTI (config/magazzino). Mobile: window._REPARTI (statico).
  return window.REPARTI || window._REPARTI || {};
}

function repartoDi(ribaltaId) {
  const id = String(ribaltaId || '').trim().toUpperCase();
  if (!id) return null;
  const R = _repartiSource();
  for (const k of Object.keys(R)) {
    if ((R[k] || []).some(x => String(x).trim().toUpperCase() === id)) return k;
  }
  return null;
}

// ── Listener collezione `navette` ───────────────────────────────────────────────
function startNavetteListener(onChange) {
  if (onChange) _onChange = onChange;
  if (_unsubNav) return;
  _unsubNav = onSnapshot(collection(_db(), 'navette'), snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') { delete _navette[id]; return; }
      const d = ch.doc.data();
      _navette[id] = {
        nome:       d.nome || id,
        attiva:     d.attiva !== false,
        stato:      d.stato || 'vuoto',
        posizione:  d.posizione || null,
        vuotoDa:    d.vuotoDa?.toDate ? d.vuotoDa.toDate() : (d.vuotoDa || null),
        missioneId: d.missioneId || null,
      };
    });
    window.navette = _navette;
    if (_onChange) { try { _onChange(_navette); } catch (e) { /* noop */ } }
  }, err => console.error('Errore listener navette:', err));
}

function stopNavetteListener() {
  if (_unsubNav) { _unsubNav(); _unsubNav = null; }
}

function getNavette() { return _navette; }

// Navette attive e attualmente vuote (per l'indicatore "vuoti disponibili")
function navetteVuoteDisponibili() {
  return Object.values(_navette).filter(n => n.attiva && n.stato === 'vuoto');
}

// ── Logica A) richiesta → mezzo ─────────────────────────────────────────────────
// Dato il target (ribalta di destinazione), sceglie il vuoto migliore.
// Preferenze (non filtri): stesso edificio → stesso reparto → vuoto da più tempo.
function scegliVuotoPerTarget(targetRibalta) {
  const cand = navetteVuoteDisponibili();
  if (!cand.length) return null;
  const edT = edificioDi(targetRibalta);
  const repT = repartoDi(targetRibalta);
  cand.sort((a, b) => {
    const aEd = edificioDi(a.posizione) === edT ? 0 : 1;
    const bEd = edificioDi(b.posizione) === edT ? 0 : 1;
    if (aEd !== bEd) return aEd - bEd;
    const aRep = repartoDi(a.posizione) === repT ? 0 : 1;
    const bRep = repartoDi(b.posizione) === repT ? 0 : 1;
    if (aRep !== bRep) return aRep - bRep;
    const aV = a.vuotoDa ? a.vuotoDa.getTime() : Infinity; // vuoto da più tempo prima
    const bV = b.vuotoDa ? b.vuotoDa.getTime() : Infinity;
    return aV - bV;
  });
  return cand[0];
}

// ── Logica B) mezzo → richiesta ─────────────────────────────────────────────────
// Legge le richieste vuoto in attesa e le ordina: urgente → dataOra più vecchia.
async function _richiesteInAttesaOrdinate() {
  // Una sola equality su indice auto: filtro il resto lato client (volumi minimi).
  const qref = query(collection(_db(), 'prenotazioni'), where('tipoMissione', '==', 'navetta'));
  const snap = await getDocs(qref);
  const richieste = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.faseNavetta === 'vuoto' && p.stato === 'in_attesa');
  const ms = (p) => {
    const t = p.dataOra;
    if (!t) return Infinity;
    if (t.toDate) return t.toDate().getTime();
    const d = new Date(t); return isNaN(d) ? Infinity : d.getTime();
  };
  richieste.sort((a, b) => {
    const u = (a.urgente ? 0 : 1) - (b.urgente ? 0 : 1);
    if (u !== 0) return u;
    return ms(a) - ms(b);
  });
  return richieste;
}

// ── Abbinamento atomico (blocco mezzo + aggancio richiesta) ─────────────────────
// Transazione: garantisce mezzo ancora `vuoto` e richiesta ancora `in_attesa`.
// Il blocco del mezzo (stato→in_missione) evita doppie missioni concorrenti.
async function _abbina(navettaId, prenId, origine) {
  const navRef  = doc(_db(), 'navette', navettaId);
  const prenRef = doc(_db(), 'prenotazioni', prenId);
  await runTransaction(_db(), async (tx) => {
    const navSnap = await tx.get(navRef);
    if (!navSnap.exists()) throw new Error('navetta assente');
    if (navSnap.data().stato !== 'vuoto') throw new Error('navetta non più vuota');
    const prenSnap = await tx.get(prenRef);
    if (!prenSnap.exists()) throw new Error('richiesta assente');
    if (prenSnap.data().stato !== 'in_attesa') throw new Error('richiesta non più in attesa');
    tx.update(navRef,  { stato: 'in_missione', missioneId: prenId, vuotoDa: null });
    tx.update(prenRef, { stato: 'creata', navettaId, origine });
  });
}

// ── Operazione 1: creazione richiesta vuoto (amministrativo) ────────────────────
// Crea la richiesta `in_attesa` e tenta subito l'abbinamento (logica A).
async function creaRichiestaVuoto({ destinazione, urgente = false, user }) {
  const dest = String(destinazione || '').trim().toUpperCase();
  if (!dest) throw new Error('destinazione mancante');
  const ref = await addDoc(collection(_db(), 'prenotazioni'), {
    tipoMissione: 'navetta',
    faseNavetta:  'vuoto',
    stato:        'in_attesa',
    tipoMezzo:    'container',
    origine:      null,
    destinazione: dest,
    ribaltaArrivo: null,
    navettaId:    null,
    plate:        null,
    spotId:       null,
    urgente:      !!urgente,
    dataOra:      serverTimestamp(),
    utenteUid:    user?.uid || null,
    utenteEmail:  user?.email || null,
  });
  const nav = scegliVuotoPerTarget(dest);
  if (nav) {
    try {
      await _abbina(nav.nome, ref.id, nav.posizione);
      return { prenId: ref.id, abbinata: true, navettaId: nav.nome };
    } catch (e) { /* race: resta in_attesa */ }
  }
  return { prenId: ref.id, abbinata: false };
}

// ── Operazione 2: creazione missione pieno (operativo, "libera ribalta") ────────
// Precondizione: la navetta è `vuoto` alla ribalta di origine (appena caricata).
// urgente SEMPRE false. Blocco mezzo + creazione missione in un'unica transazione.
async function creaMissionePieno({ navettaId, origine, destinazione, user }) {
  const org  = String(origine || '').trim().toUpperCase();
  const dest = String(destinazione || '').trim().toUpperCase();
  if (!navettaId) throw new Error('navetta mancante');
  if (!dest) throw new Error('destinazione mancante');
  const navRef  = doc(_db(), 'navette', navettaId);
  const prenRef = doc(collection(_db(), 'prenotazioni')); // id generato prima della tx
  await runTransaction(_db(), async (tx) => {
    const navSnap = await tx.get(navRef);
    if (!navSnap.exists()) throw new Error('navetta assente');
    if (navSnap.data().stato !== 'vuoto') throw new Error('navetta non disponibile (non vuota)');
    tx.set(prenRef, {
      tipoMissione: 'navetta',
      faseNavetta:  'pieno',
      stato:        'creata',
      tipoMezzo:    'container',
      origine:      org,
      destinazione: dest,
      ribaltaArrivo: null,
      navettaId,
      plate:        null,
      spotId:       null,
      urgente:      false,
      dataOra:      serverTimestamp(),
      utenteUid:    user?.uid || null,
      utenteEmail:  user?.email || null,
    });
    tx.update(navRef, { stato: 'in_missione', missioneId: prenRef.id, vuotoDa: null });
  });
  return { prenId: prenRef.id, navettaId };
}

// ── Operazione 3: dichiarazione svuotata (operativo) ────────────────────────────
// Unica transizione senza missione: pieno→vuoto. Subito dopo tenta l'abbinamento
// con la coda (logica B). Se una richiesta è disponibile, genera la missione vuoto.
async function dichiaraVuoto({ navettaId }) {
  if (!navettaId) throw new Error('navetta mancante');
  const navRef = doc(_db(), 'navette', navettaId);
  const snap = await getDoc(navRef);
  if (!snap.exists()) throw new Error('navetta assente');
  const posizione = snap.data().posizione || null;
  await updateDoc(navRef, { stato: 'vuoto', vuotoDa: serverTimestamp() });
  // Tentativo abbinamento con la coda
  const richieste = await _richiesteInAttesaOrdinate();
  for (const r of richieste) {
    try {
      await _abbina(navettaId, r.id, posizione);
      return { abbinata: true, prenId: r.id, navettaId };
    } catch (e) { /* la richiesta o il mezzo è cambiato: prova la prossima */ }
  }
  return { abbinata: false };
}

// ── Operazione 4: completamento missione (autista) ──────────────────────────────
// L'autista dichiara SOLO la ribalta di arrivo. La navetta conserva il suo stato:
//   gamba pieno  → arriva `pieno`  @ ribaltaArrivo
//   gamba vuoto  → arriva `vuoto`  @ ribaltaArrivo (in attesa che il reparto la carichi)
// Nessun abbinamento automatico qui: l'abbinamento avviene solo alla dichiarazione
// di svuotamento (dichiaraVuoto) e alla creazione richiesta (creaRichiestaVuoto).
async function completaMissioneNavetta({ prenId, ribaltaArrivo }) {
  const arr = String(ribaltaArrivo || '').trim().toUpperCase();
  if (!prenId) throw new Error('prenotazione mancante');
  if (!arr) throw new Error('ribalta di arrivo mancante');
  const prenRef = doc(_db(), 'prenotazioni', prenId);
  const snap = await getDoc(prenRef);
  if (!snap.exists()) throw new Error('prenotazione assente');
  const p = snap.data();
  await updateDoc(prenRef, {
    stato:        'completata',
    ribaltaArrivo: arr,
    completataAt: serverTimestamp(),
    oraFine:      serverTimestamp(),
  });
  if (p.navettaId) {
    const nuovoStato = p.faseNavetta === 'pieno' ? 'pieno' : 'vuoto';
    await updateDoc(doc(_db(), 'navette', p.navettaId), {
      stato:      nuovoStato,
      posizione:  arr,
      missioneId: null,
      vuotoDa:    nuovoStato === 'vuoto' ? serverTimestamp() : null,
    });
  }
  return { faseNavetta: p.faseNavetta, navettaId: p.navettaId || null };
}

// ── CRUD navette (pannello impostazioni desktop) ────────────────────────────────
async function creaNavetta({ nome, posizione = null, stato = 'vuoto', attiva = true }) {
  const id = String(nome || '').trim().toUpperCase();
  if (!id) throw new Error('nome navetta mancante');
  const ref = doc(_db(), 'navette', id);
  const esiste = await getDoc(ref);
  if (esiste.exists()) throw new Error('navetta già esistente');
  await setDoc(ref, {
    nome: id,
    attiva: !!attiva,
    stato,
    posizione: posizione ? String(posizione).trim().toUpperCase() : null,
    vuotoDa: stato === 'vuoto' ? serverTimestamp() : null,
    missioneId: null,
  });
  return id;
}

async function aggiornaNavetta(nome, patch) {
  const id = String(nome || '').trim().toUpperCase();
  if (!id) throw new Error('nome navetta mancante');
  await updateDoc(doc(_db(), 'navette', id), patch || {});
}

async function setAttiva(nome, attiva) {
  return aggiornaNavetta(nome, { attiva: !!attiva });
}

// Imposta manualmente lo stato (pannello impostazioni): gestisce vuotoDa/missioneId.
async function setStatoManuale(nome, stato) {
  const patch = { stato };
  patch.vuotoDa = stato === 'vuoto' ? serverTimestamp() : null;
  if (stato !== 'in_missione') patch.missioneId = null;
  return aggiornaNavetta(nome, patch);
}

// ── Statistiche di utilizzo (derivate dalle prenotazioni completate) ────────────
// Nessun contatore nel documento navetta: unica fonte di verità = prenotazioni.
async function statisticheNavette() {
  const qref = query(collection(_db(), 'prenotazioni'), where('tipoMissione', '==', 'navetta'));
  const snap = await getDocs(qref);
  const acc = {};
  snap.docs.forEach(d => {
    const p = d.data();
    if (p.stato !== 'completata' || !p.navettaId) return;
    const k = p.navettaId;
    acc[k] = acc[k] || { navettaId: k, totale: 0, vuoto: 0, pieno: 0 };
    acc[k].totale++;
    if (p.faseNavetta === 'pieno') acc[k].pieno++; else acc[k].vuoto++;
  });
  return acc;
}

// ── Export ES (mobile) + esposizione window (desktop) ───────────────────────────
const NavetteCore = {
  startNavetteListener, stopNavetteListener, getNavette,
  navetteVuoteDisponibili, edificioDi, repartoDi,
  scegliVuotoPerTarget,
  creaRichiestaVuoto, creaMissionePieno, dichiaraVuoto, completaMissioneNavetta,
  creaNavetta, aggiornaNavetta, setAttiva, setStatoManuale, statisticheNavette,
};

if (typeof window !== 'undefined') window.NavetteCore = NavetteCore;

export {
  startNavetteListener, stopNavetteListener, getNavette,
  navetteVuoteDisponibili, edificioDi, repartoDi,
  scegliVuotoPerTarget,
  creaRichiestaVuoto, creaMissionePieno, dichiaraVuoto, completaMissioneNavetta,
  creaNavetta, aggiornaNavetta, setAttiva, setStatoManuale, statisticheNavette,
};
export default NavetteCore;
