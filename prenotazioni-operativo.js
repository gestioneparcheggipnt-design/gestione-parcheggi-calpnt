import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── prenotazioni-operativo.js ────────────────────────────────────────────────
// Tab "Prenota" dell'utente operativo (mobile).
//  · Modalità CONTAINER: prenotazioni container (stesso modello del desktop
//    amministrativo) + navettaggi interni (richiesta vuoto), uno sotto l'altro.
//  · Modalità CASSA: richiesta di una cassa vuota da posizionare in ribalta.
// L'operativo vede tutte le prenotazioni ma annulla solo le proprie.
//
// Dipende da: firebase-config.js (window.db), shared-utils.js,
//             ribalte-operativo.js (disponibilità ribalte + picker), navette-core.js

import { _esc, showToast } from './shared-utils.js';
import * as _SU from './shared-utils.js';
// RE_CONTAINER letto dal namespace: se il browser servisse per qualche minuto una
// copia in cache di shared-utils.js senza il nuovo export, il modulo non si rompe.
const RE_CONTAINER = _SU.RE_CONTAINER || /^(?:[A-Z]{4}\d{7}|[A-Z]{2}\d{3}(?:[A-Z]{2}|\d{1,3}))$/;
const normalizzaId = _SU.normalizzaId || (r => String(r ?? '').toUpperCase().replace(/[\s\-./]+/g, ''));
// NB: ribalte-operativo.js va usato tramite window.RibalteOp e NON importato:
// mobile.html lo carica con ?v=<hash> (cache busting), un import senza ?v
// creerebbe una seconda istanza del modulo con stato separato (vuoto).
const _R = () => window.RibalteOp || {};
const pickerRibaltaHTML        = (...a) => _R().pickerRibaltaHTML ? _R().pickerRibaltaHTML(...a) : '';
const resetPicker              = (...a) => _R().resetPicker && _R().resetPicker(...a);
const statoRibaltaDestinazione = (...a) => _R().statoRibaltaDestinazione ? _R().statoRibaltaDestinazione(...a) : 'occupata';
const getRibalteData           = () => (_R().getRibalteData ? _R().getRibalteData() : {});
const repartoDiRibalta         = (...a) => (_R().repartoDiRibalta ? _R().repartoDiRibalta(...a) : null);

let _getUser  = () => null;
let _getMode  = () => 'container';
let _getSpots = () => ({});
let _unsub    = null;
let _pren     = [];          // tutte le prenotazioni (dataOra desc)
let _skeleton = null;        // modalità per cui è stato costruito lo scheletro HTML

// Stato form (sopravvive ai re-render)
const _sel = { dest: null, navDest: null, cassaDest: null };
let _mezzo = null;           // { spotId, plate } container selezionato
let _filtroStato = 'aperte'; // 'aperte' | 'completata' | 'annullata' | 'tutte'
let _filtroTarga = '';
const _inCorso = new Set();

// ── INIT ─────────────────────────────────────────────────────────────────────
export function initPrenotaOp({ getUser, getMode, getSpots }) {
  _getUser  = getUser  || _getUser;
  _getMode  = getMode  || _getMode;
  _getSpots = getSpots || _getSpots;
  if (_unsub) return;
  _unsub = onSnapshot(
    query(collection(window.db, 'prenotazioni'), orderBy('dataOra', 'desc')),
    snap => { _pren = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPrenotaOp(); },
    err => console.error('Errore prenotazioni (operativo):', err)
  );
}

export function stopPrenotaOp() {
  if (_unsub) { _unsub(); _unsub = null; }
  _skeleton = null;
}

// ── UTILITY ──────────────────────────────────────────────────────────────────
function _user() { return _getUser ? _getUser() : null; }
function _repKey() {
  const u = _user();
  if (!u?.reparto || !window._REPARTI) return null;
  const t = String(u.reparto).trim().toUpperCase();
  return Object.keys(window._REPARTI).find(k => String(k).trim().toUpperCase() === t) || null;
}
function _d(v) { if (!v) return null; if (v.toDate) return v.toDate(); const d = new Date(v); return isNaN(d) ? null : d; }
function _fmt(v) {
  const d = _d(v);
  return d ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
}
function _statoBadge(stato) {
  const m = {
    creata:     ['creata', 'Aperta'],
    in_attesa:  ['creata', 'In attesa'],
    completata: ['completata', '✅ Completata'],
    annullata:  ['completata', '✕ Annullata'],
  }[stato] || ['creata', stato || '—'];
  return `<span class="prenBadge ${m[0]}" ${stato === 'annullata' ? 'style="opacity:.6"' : ''}>${m[1]}</span>`;
}
const _S = {
  sec:   'font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:6px 0',
  btn:   'width:100%;margin-top:10px;padding:12px;border-radius:9px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer',
  btnX:  'padding:6px 10px;border-radius:8px;border:1.5px solid var(--red,#ef4444);background:transparent;color:var(--red,#ef4444);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer',
  chk:   'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:14px;font-weight:600;cursor:pointer',
  card:  'margin-bottom:12px',
};

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderPrenotaOp() {
  const el = document.getElementById('prenotaOpBody');
  if (!el) return;
  const mode = _getMode ? _getMode() : 'container';
  if (_skeleton !== mode) {
    el.innerHTML = mode === 'cassa' ? _skeletonCassa() : _skeletonContainer();
    _skeleton = mode;
    const sub = document.getElementById('prenotaSubtitle');
    if (sub) sub.textContent = mode === 'cassa'
      ? 'Richiedi una cassa vuota da posizionare in ribalta'
      : 'Prenotazioni container e navettaggi interni';
  }
  if (mode === 'cassa') {
    _renderPickerCassa();
    _renderListaCassa();
  } else {
    _renderPickerDest();
    _renderListaContainer();
    _renderNavStatus();
    _renderPickerNav();
    _renderListaNav();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODALITÀ CONTAINER
// ════════════════════════════════════════════════════════════════════════════
function _skeletonContainer() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const nowStr = now.toISOString().slice(0, 16);
  return `
  <div class="prenGroupTitle">🚛 CONTAINER</div>
  <div class="prenCard" style="${_S.card}">
    <div style="${_S.sec}">Nuova prenotazione</div>
    <div style="position:relative">
      <input id="pOpTarga" class="inputField" spellcheck="false" autocomplete="off" maxlength="15"
             placeholder="Identificativo container (es. ABCD1234567 / AB123CD)" style="text-transform:uppercase"
             oninput="pOpSuggerisci()" onfocus="pOpSuggerisci()">
      <div id="pOpSugg" style="display:none;margin-top:4px;max-height:220px;overflow-y:auto;border:1.5px solid var(--border);border-radius:9px;background:var(--surface)"></div>
    </div>
    <div id="pOpMezzo" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--surface2);font-size:13px"></div>
    <div id="pOpFeedback" style="font-size:12px;margin-top:6px"></div>
    <div style="${_S.sec};margin-top:12px">Ribalta di destinazione</div>
    <div id="pOpDestPicker"></div>
    <div style="${_S.sec};margin-top:12px">Data e ora spostamento</div>
    <input id="pOpData" type="datetime-local" class="inputField" value="${nowStr}">
    <label style="${_S.chk}"><input type="checkbox" id="pOpUrgente" style="width:18px;height:18px"> 🚨 Urgente</label>
    <button id="pOpSalva" onclick="pOpSalva()" style="${_S.btn}">💾 Salva prenotazione</button>
  </div>

  <div class="prenCard" style="${_S.card}">
    <div style="display:flex;gap:8px;align-items:center">
      <select id="pOpFiltroStato" class="inputField" style="flex:1" onchange="pOpFiltra()">
        <option value="aperte">Aperte</option>
        <option value="completata">Completate</option>
        <option value="annullata">Annullate</option>
        <option value="tutte">Tutte</option>
      </select>
      <input id="pOpFiltroTarga" class="inputField" style="flex:1;text-transform:uppercase" placeholder="🔍 Targa" oninput="pOpFiltra()">
    </div>
  </div>
  <div id="pOpLista"></div>

  <div class="prenGroupTitle" style="margin-top:18px">🚚 NAVETTAGGI INTERNI</div>
  <div class="prenCard" style="${_S.card}">
    <div id="pOpNavStatus"></div>
    <div style="${_S.sec};margin-top:10px">Nuova richiesta vuoto — ribalta dove serve</div>
    <div id="pOpNavPicker"></div>
    <label style="${_S.chk}"><input type="checkbox" id="pOpNavUrgente" style="width:18px;height:18px"> 🚨 Urgente</label>
    <button id="pOpNavBtn" onclick="pOpRichiestaVuoto()" style="${_S.btn}">+ Richiesta vuoto</button>
  </div>
  <div id="pOpNavLista"></div>`;
}

// ── Autocomplete container prenotabili (stessi controlli del desktop) ────────
function _containerPrenotabili(q) {
  const inPren = new Set(_pren.filter(p => p.stato === 'creata' && p.plate).map(p => String(p.plate).toUpperCase()));
  const allaRib = new Set(Object.values(getRibalteData()).filter(r => r.occupied && r.plate).map(r => String(r.plate).toUpperCase()));
  return Object.values(_getSpots() || {})
    .filter(s => {
      if (!s.occupied || !s.full || !s.plate || s.unusable) return false;
      const p = String(s.plate).trim().toUpperCase();
      if (!RE_CONTAINER.test(p)) return false;
      if (inPren.has(p) || allaRib.has(p)) return false;
      return !q || p.includes(q);
    })
    .sort((a, b) => String(a.plate).localeCompare(String(b.plate)))
    .slice(0, 40);
}

window.pOpSuggerisci = function() {
  const inp = document.getElementById('pOpTarga');
  const box = document.getElementById('pOpSugg');
  if (!inp || !box) return;
  const q = normalizzaId(inp.value);
  if (_mezzo && _mezzo.plate !== q) _selezionaMezzo(null);
  if (q.length < 2) { box.style.display = 'none'; return; }
  const l = _containerPrenotabili(q);
  box.innerHTML = l.length
    ? l.map(s => `<div onclick="pOpScegli('${_esc(s.id)}')"
        style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer">
        <strong>${_esc(s.plate)}</strong><span style="color:var(--muted)">${_esc(s.id)} · 🟡 pieno</span></div>`).join('')
    : `<div style="padding:10px 12px;color:var(--muted);font-size:13px">Nessun container prenotabile trovato.<br>
        <small>Prenotabili: parcheggiati, pieni, non già in ribalta né prenotati.</small></div>`;
  box.style.display = 'block';
};

window.pOpScegli = function(spotId) {
  const s = (_getSpots() || {})[spotId];
  if (!s) return;
  _selezionaMezzo({ spotId, plate: s.plate });
  const inp = document.getElementById('pOpTarga'); if (inp) inp.value = s.plate;
  const box = document.getElementById('pOpSugg'); if (box) box.style.display = 'none';
};

function _selezionaMezzo(m) {
  _mezzo = m;
  const box = document.getElementById('pOpMezzo');
  const fb  = document.getElementById('pOpFeedback');
  if (box) {
    box.style.display = m ? 'block' : 'none';
    box.innerHTML = m ? `✔ <strong>${_esc(m.plate)}</strong> al parcheggio <strong>${_esc(m.spotId)}</strong> · 🟡 pieno` : '';
  }
  if (fb) fb.textContent = '';
}

function _renderPickerDest() {
  const el = document.getElementById('pOpDestPicker');
  if (!el) return;
  el.innerHTML = pickerRibaltaHTML('pOpDest', '_pOpSelDest', { repartoUtente: _repKey(), selezionata: _sel.dest });
}
window._pOpSelDest = function(_k, id) { _sel.dest = id; _renderPickerDest(); };

window.pOpSalva = async function() {
  const user = _user();
  const fb = document.getElementById('pOpFeedback');
  const err = (m) => { if (fb) { fb.textContent = '⚠️ ' + m; fb.style.color = 'var(--red,#ef4444)'; } showToast(m, 'error'); };
  // Se l'utente ha digitato l'ID completo senza toccare il suggerimento
  if (!_mezzo) {
    const q = normalizzaId(document.getElementById('pOpTarga')?.value || '');
    const hit = _containerPrenotabili(q).find(s => String(s.plate).toUpperCase() === q);
    if (hit) _selezionaMezzo({ spotId: hit.id, plate: hit.plate });
  }
  if (!_mezzo) return err('Seleziona un container prenotabile dall\'elenco.');
  const dest = _sel.dest;
  if (!dest) return err('Seleziona la ribalta di destinazione.');
  if (statoRibaltaDestinazione(dest) !== 'libera') { _sel.dest = null; _renderPickerDest(); return err(`La ribalta ${dest} non è più disponibile.`); }
  const dataStr = document.getElementById('pOpData')?.value;
  if (!dataStr) return err('Inserisci data e ora dello spostamento.');
  // Ricontrollo stato mezzo al momento del salvataggio
  const s = (_getSpots() || {})[_mezzo.spotId];
  if (!s || !s.occupied || s.plate !== _mezzo.plate || !s.full) return err('Il container non risulta più parcheggiato pieno.');
  if (_pren.some(p => p.stato === 'creata' && p.plate === _mezzo.plate)) return err('Esiste già una prenotazione aperta per questo container.');
  if (_inCorso.has('salva')) return;
  _inCorso.add('salva');
  const btn = document.getElementById('pOpSalva'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvataggio…'; }
  try {
    const urgente = !!document.getElementById('pOpUrgente')?.checked;
    await addDoc(collection(window.db, 'prenotazioni'), {
      spotId: _mezzo.spotId,
      plate: _mezzo.plate,
      tipoMezzo: 'container',
      destinazione: dest,
      dataOra: new Date(dataStr),
      stato: 'creata',
      urgente,
      operatoreUid:   user?.uid || null,
      operatoreEmail: user?.email || null,
      operatoreNome:  user?.name || user?.email || null,
      operatoreReparto: user?.reparto || null,
      createdAt: serverTimestamp(),
    });
    await window.logHistory({ spot: _mezzo.spotId, action: 'Prenotazione creata', plate: _mezzo.plate, destinazione: dest, mode: 'container', tipo: 'container' });
    showToast(`Prenotazione creata: ${_mezzo.plate} → ${dest}`, 'success');
    // reset form
    _selezionaMezzo(null);
    _sel.dest = null; resetPicker('pOpDest');
    const inp = document.getElementById('pOpTarga'); if (inp) inp.value = '';
    const u = document.getElementById('pOpUrgente'); if (u) u.checked = false;
    _renderPickerDest();
  } catch (e) {
    err('Errore salvataggio: ' + (e.message || e));
  } finally {
    _inCorso.delete('salva');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salva prenotazione'; }
  }
};

window.pOpFiltra = function() {
  _filtroStato = document.getElementById('pOpFiltroStato')?.value || 'aperte';
  _filtroTarga = normalizzaId(document.getElementById('pOpFiltroTarga')?.value || '');
  _renderListaContainer();
};

function _prenContainer() {
  return _pren.filter(p => {
    if (['ribalta', 'navetta', 'spostamento', 'cassa_vuota'].includes(p.tipoMissione)) return false;
    if (p.tipoMezzo && p.tipoMezzo !== 'container') return false;
    return RE_CONTAINER.test(String(p.plate || '').trim().toUpperCase());
  });
}

function _renderListaContainer() {
  const el = document.getElementById('pOpLista');
  if (!el) return;
  const user = _user();
  let l = _prenContainer();
  if (_filtroStato === 'aperte') l = l.filter(p => p.stato === 'creata');
  else if (_filtroStato !== 'tutte') l = l.filter(p => p.stato === _filtroStato);
  if (_filtroTarga) l = l.filter(p => String(p.plate || '').toUpperCase().includes(_filtroTarga));
  l.sort((a, b) => ((a.urgente && a.stato === 'creata') ? 0 : 1) - ((b.urgente && b.stato === 'creata') ? 0 : 1)
    || ((_d(a.dataOra)?.getTime() || 0) - (_d(b.dataOra)?.getTime() || 0)) * (_filtroStato === 'aperte' ? 1 : -1));
  const tot = l.length;
  l = l.slice(0, 80);
  if (!tot) { el.innerHTML = '<div class="emptyState">Nessuna prenotazione container.</div>'; return; }
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin:0 2px 6px">${tot} prenotazion${tot === 1 ? 'e' : 'i'}${tot > 80 ? ' (mostrate 80)' : ''}</div>` +
    l.map(p => {
      const mia = user && p.operatoreUid === user.uid;
      const rich = (p.destinazione && p.destinazione !== '—') ? String(p.destinazione).toUpperCase() : '—';
      const eff  = p.postoFine ? String(p.postoFine).toUpperCase() : '';
      return `
      <div class="prenCard" style="${_S.card}${p.urgente && p.stato === 'creata' ? ';border:2px solid var(--red,#ef4444)' : ''}">
        <div class="prenHeader">
          <span style="font-size:16px;font-weight:800">${_esc(p.plate || '—')}</span>
          ${_statoBadge(p.stato)}
        </div>
        <div style="font-size:14px;margin-top:4px"><strong>${_esc(p.spotId || '—')}</strong> → <strong>${_esc(rich)}</strong>
          ${eff && eff !== rich ? `<span style="color:orange;font-size:12px"> (arrivato in ${_esc(eff)})</span>` : ''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">
          ${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span> ' : ''}${_fmt(p.dataOra)} · ${_esc(p.operatoreNome || p.operatoreEmail || p.utenteNome || '—')}${mia ? ' <strong style="color:var(--accent)">(tua)</strong>' : ''}
        </div>
        ${mia && p.stato === 'creata' ? `<div style="text-align:right;margin-top:8px"><button onclick="pOpAnnulla('${p.id}')" style="${_S.btnX}">✕ Annulla</button></div>` : ''}
      </div>`;
    }).join('');
}

// ── Annulla (solo proprie) — container / navetta / cassa vuota ───────────────
window.pOpAnnulla = async function(id) {
  const user = _user();
  const p = _pren.find(x => x.id === id);
  if (!p || !user) return;
  const autore = p.operatoreUid || p.utenteUid;
  if (autore !== user.uid) { showToast('Puoi annullare solo le tue richieste', 'error'); return; }
  const annullabile = p.tipoMissione === 'navetta' ? p.stato === 'in_attesa' : p.stato === 'creata';
  if (!annullabile) { showToast('Richiesta non più annullabile', 'error'); return; }
  if (!confirm('Annullare questa richiesta?')) return;
  if (_inCorso.has('ann_' + id)) return;
  _inCorso.add('ann_' + id);
  try {
    await updateDoc(doc(window.db, 'prenotazioni', id), {
      stato: 'annullata', annullataAt: serverTimestamp(),
      annullataDaUid: user.uid, annullataDaNome: user.name || user.email || null,
    });
    const tipo = p.tipoMissione === 'cassa_vuota' ? 'cassa' : 'container';
    await window.logHistory({
      spot: p.spotId || p.destinazione || null, action: 'Prenotazione annullata', tipo,
      plate: p.plate || p.navettaId || null, destinazione: p.destinazione || null,
      tipoMissione: p.tipoMissione || 'prenotazione',
      richiedente: p.operatoreNome || p.utenteNome || p.operatoreEmail || p.utenteEmail || null,
    });
    showToast('Richiesta annullata', 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  } finally {
    _inCorso.delete('ann_' + id);
  }
};

// ── Navettaggi interni ───────────────────────────────────────────────────────
function _renderNavStatus() {
  const el = document.getElementById('pOpNavStatus');
  if (!el) return;
  const nav = Object.values(window.navette || {}).filter(n => n.attiva)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const icona = s => s === 'pieno' ? '🟡 pieno' : (s === 'in_missione' ? '🔵 in missione' : '🟢 vuoto');
  const vuote = nav.filter(n => n.stato === 'vuoto').length;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="${_S.sec};margin:0">Navette</span>
      <span style="font-size:12px;font-weight:700;color:${vuote ? 'var(--accent2)' : 'var(--muted)'}">${vuote} vuot${vuote === 1 ? 'a' : 'e'} disponibil${vuote === 1 ? 'e' : 'i'}</span>
    </div>
    <div>${nav.length
      ? nav.map(n => `<span style="display:inline-block;margin:2px 6px 2px 0;font-size:12px;padding:3px 8px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"><strong>${_esc(n.nome)}</strong> · ${_esc(n.posizione || '—')} · ${icona(n.stato)}</span>`).join('')
      : '<span style="font-size:12px;color:var(--muted)">Nessuna navetta configurata.</span>'}</div>`;
}

function _renderPickerNav() {
  const el = document.getElementById('pOpNavPicker');
  if (!el) return;
  // La richiesta vuoto indica dove serve la navetta: qualsiasi ribalta valida
  // non già riservata (la navetta arriverà quando disponibile).
  el.innerHTML = pickerRibaltaHTML('pOpNav', '_pOpSelNav', { repartoUtente: _repKey(), selezionata: _sel.navDest });
}
window._pOpSelNav = function(_k, id) { _sel.navDest = id; _renderPickerNav(); };

window.pOpRichiestaVuoto = async function() {
  const dest = _sel.navDest;
  if (!dest) { showToast('Seleziona la ribalta dove serve il vuoto', 'error'); return; }
  if (!window.NavetteCore) { showToast('Modulo navette non caricato', 'error'); return; }
  if (_inCorso.has('nav')) return;
  _inCorso.add('nav');
  const btn = document.getElementById('pOpNavBtn'); if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  try {
    const urg = !!document.getElementById('pOpNavUrgente')?.checked;
    const res = await window.NavetteCore.creaRichiestaVuoto({ destinazione: dest, urgente: urg, user: _user() });
    await window.logHistory({ spot: dest, action: 'Prenotazione creata', tipo: 'container', tipoMissione: 'navetta', destinazione: dest, plate: res.navettaId || null });
    showToast(res.abbinata ? `Richiesta creata e abbinata a ${res.navettaId}` : 'Richiesta vuoto in coda', 'success');
    _sel.navDest = null; resetPicker('pOpNav');
    const u = document.getElementById('pOpNavUrgente'); if (u) u.checked = false;
    _renderPickerNav();
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  } finally {
    _inCorso.delete('nav');
    if (btn) { btn.disabled = false; btn.textContent = '+ Richiesta vuoto'; }
  }
};

function _renderListaNav() {
  const el = document.getElementById('pOpNavLista');
  if (!el) return;
  const user = _user();
  const nav = _pren.filter(p => p.tipoMissione === 'navetta');
  const ts = p => _d(p.dataOra)?.getTime() || 0;
  const inAttesa = nav.filter(p => p.stato === 'in_attesa').sort((a, b) => (a.urgente ? 0 : 1) - (b.urgente ? 0 : 1) || ts(a) - ts(b));
  const inCorso  = nav.filter(p => p.stato === 'creata').sort((a, b) => ts(a) - ts(b));
  const riga = (p, tag) => {
    const mia = user && p.utenteUid === user.uid;
    return `
    <div class="prenCard" style="${_S.card}">
      <div class="prenHeader">
        <span style="font-size:15px;font-weight:800">${_esc(p.navettaId || '— in coda —')}</span>
        <span class="prenBadge creata">${p.spostamento ? '🔀 ' : ''}${p.faseNavetta === 'pieno' ? 'PIENO' : 'VUOTO'} · ${tag}</span>
      </div>
      <div style="font-size:14px;margin-top:4px">${_esc(p.origine || '—')} → <strong>${_esc(p.destinazione || '—')}</strong></div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span> ' : ''}${_fmt(p.dataOra)} · ${_esc(p.utenteNome || p.utenteEmail || '—')}${mia ? ' <strong style="color:var(--accent)">(tua)</strong>' : ''}</div>
      ${mia && p.stato === 'in_attesa' ? `<div style="text-align:right;margin-top:8px"><button onclick="pOpAnnulla('${p.id}')" style="${_S.btnX}">✕ Annulla</button></div>` : ''}
    </div>`;
  };
  el.innerHTML =
      (inAttesa.length ? `<div style="${_S.sec}">In attesa (${inAttesa.length})</div>` + inAttesa.map(p => riga(p, 'in attesa')).join('') : '')
    + (inCorso.length  ? `<div style="${_S.sec}">Missioni in corso (${inCorso.length})</div>` + inCorso.map(p => riga(p, 'assegnata')).join('') : '')
    + ((!inAttesa.length && !inCorso.length) ? '<div class="emptyState">Nessuna richiesta navetta attiva.</div>' : '');
}

// ════════════════════════════════════════════════════════════════════════════
// MODALITÀ CASSA — richiesta cassa vuota
// ════════════════════════════════════════════════════════════════════════════
function _skeletonCassa() {
  return `
  <div class="prenGroupTitle">📦 RICHIEDI CASSA VUOTA</div>
  <div class="prenCard" style="${_S.card}">
    <div style="font-size:13px;color:var(--muted);line-height:1.4;margin-bottom:6px">
      L'autista porterà una cassa vuota (dal parcheggio o da un'altra ribalta) nella ribalta scelta.
      Puoi scegliere una ribalta libera o una <span style="color:orange;font-weight:700">🚛 in liberazione</span>.
    </div>
    <div style="${_S.sec}">Ribalta di destinazione</div>
    <div id="pOpCassaPicker"></div>
    <label style="${_S.chk}"><input type="checkbox" id="pOpCassaUrgente" style="width:18px;height:18px"> 🚨 Urgente</label>
    <button id="pOpCassaBtn" onclick="pOpRichiediCassa()" style="${_S.btn}">📦 Richiedi cassa vuota</button>
  </div>
  <div id="pOpCassaLista"></div>`;
}

function _renderPickerCassa() {
  const el = document.getElementById('pOpCassaPicker');
  if (!el) return;
  el.innerHTML = pickerRibaltaHTML('pOpCassa', '_pOpSelCassa', {
    repartoUtente: _repKey(), ammettiInLiberazione: true, selezionata: _sel.cassaDest,
  });
}
window._pOpSelCassa = function(_k, id) { _sel.cassaDest = id; _renderPickerCassa(); };

window.pOpRichiediCassa = async function() {
  const user = _user();
  const dest = _sel.cassaDest;
  if (!dest) { showToast('Seleziona la ribalta di destinazione', 'error'); return; }
  const st = statoRibaltaDestinazione(dest);
  if (st !== 'libera' && st !== 'in_liberazione') {
    _sel.cassaDest = null; _renderPickerCassa();
    showToast(`La ribalta ${dest} non è più disponibile`, 'error'); return;
  }
  if (_inCorso.has('cassa')) return;
  _inCorso.add('cassa');
  const btn = document.getElementById('pOpCassaBtn'); if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  try {
    const urgente = !!document.getElementById('pOpCassaUrgente')?.checked;
    await addDoc(collection(window.db, 'prenotazioni'), {
      tipoMissione: 'cassa_vuota',
      tipoMezzo:    'cassa',
      stato:        'creata',
      destinazione: dest,
      destinazioneInLiberazione: st === 'in_liberazione',
      plate:        null,
      spotId:       null,
      urgente,
      dataOra:      serverTimestamp(),
      utenteUid:    user?.uid || '',
      utenteEmail:  user?.email || '',
      utenteNome:   user?.name || user?.email || '',
      utenteReparto: user?.reparto || null,
      note:         `Richiesta cassa vuota per ${dest}`,
    });
    await window.logHistory({ spot: dest, action: 'Prenotazione creata', tipo: 'cassa', tipoMissione: 'cassa_vuota', destinazione: dest, urgente });
    showToast(`Richiesta cassa vuota per ${dest} inviata`, 'success');
    _sel.cassaDest = null; resetPicker('pOpCassa');
    const u = document.getElementById('pOpCassaUrgente'); if (u) u.checked = false;
    _renderPickerCassa();
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  } finally {
    _inCorso.delete('cassa');
    if (btn) { btn.disabled = false; btn.textContent = '📦 Richiedi cassa vuota'; }
  }
};

function _renderListaCassa() {
  const el = document.getElementById('pOpCassaLista');
  if (!el) return;
  const user = _user();
  const ts = p => _d(p.dataOra)?.getTime() || 0;
  const giorno = Date.now() - 24 * 3600 * 1000;
  const tutte = _pren.filter(p => p.tipoMissione === 'cassa_vuota');
  const aperte = tutte.filter(p => p.stato === 'creata')
    .sort((a, b) => (a.urgente ? 0 : 1) - (b.urgente ? 0 : 1) || ts(a) - ts(b));
  const chiuse = tutte.filter(p => p.stato !== 'creata' && (_d(p.completataAt || p.annullataAt || p.dataOra)?.getTime() || 0) >= giorno)
    .sort((a, b) => (_d(b.completataAt || b.annullataAt)?.getTime() || 0) - (_d(a.completataAt || a.annullataAt)?.getTime() || 0));
  const card = (p) => {
    const mia = user && p.utenteUid === user.uid;
    const r = getRibalteData()[String(p.destinazione || '').toUpperCase()];
    const inLib = p.stato === 'creata' && r && r.occupied && r.inLiberazione;
    const rep = repartoDiRibalta(p.destinazione);
    const esito = p.stato === 'completata'
      ? `<div style="font-size:13px;margin-top:4px">📦 <strong>${_esc(p.plate || '—')}</strong> da ${_esc(p.spotId || '—')} → <strong>${_esc(p.postoFine || p.destinazione || '—')}</strong>${p.postoFine && p.postoFine !== p.destinazione ? ` <span style="color:orange;font-size:12px">(richiesta ${_esc(p.destinazione)})</span>` : ''}</div>`
      : '';
    return `
    <div class="prenCard" style="${_S.card}${p.urgente && p.stato === 'creata' ? ';border:2px solid var(--red,#ef4444)' : ''}">
      <div class="prenHeader">
        <span style="font-size:16px;font-weight:800">📦 → ${_esc(p.destinazione || '—')}</span>
        ${_statoBadge(p.stato)}
      </div>
      ${rep ? `<div style="font-size:11px;color:var(--muted)">${_esc(rep)}</div>` : ''}
      ${inLib ? '<div style="font-size:12px;font-weight:700;color:orange;margin-top:4px">🚛 Ribalta ancora in liberazione</div>' : ''}
      ${esito}
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${p.urgente ? '<span class="urgBadge">🚨 URGENTE</span> ' : ''}${_fmt(p.dataOra)} · ${_esc(p.utenteNome || p.utenteEmail || '—')}${mia ? ' <strong style="color:var(--accent)">(tua)</strong>' : ''}</div>
      ${mia && p.stato === 'creata' ? `<div style="text-align:right;margin-top:8px"><button onclick="pOpAnnulla('${p.id}')" style="${_S.btnX}">✕ Annulla</button></div>` : ''}
    </div>`;
  };
  el.innerHTML =
      `<div class="prenGroupTitle">APERTE (${aperte.length})</div>`
    + (aperte.length ? aperte.map(card).join('') : '<div class="emptyState">Nessuna richiesta aperta.</div>')
    + (chiuse.length ? `<div class="prenGroupTitle" style="margin-top:14px">ULTIME 24 ORE (${chiuse.length})</div>` + chiuse.map(card).join('') : '');
}
