import { addDoc, collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── ribalte-operativo.js ──────────────────────────────────────────────────────
// Gestione ribalte per ruolo operativo/portineria (mobile)
// Le ribalte vivono nella collection Firestore 'ribalte'
// Dipende da: firebase-config.js, shared-utils.js, spots-data-mobile.js

import { _esc, showToast, fmtDate, fmtDur } from './shared-utils.js';

// getDestinazioniPerReparto è esposta su window da mobile.html
function _getDestinazioni() {
  if (typeof window.getDestinazioniPerReparto === 'function') {
    const user = typeof window._getCurrentUser === 'function' ? window._getCurrentUser() : null;
    const reparto = (user && user.role !== 'amministratore') ? user.reparto : null;
    return window.getDestinazioniPerReparto(reparto);
  }
  return [];
}

// ── HELPER REPARTO ────────────────────────────────────────────────────────────
// Trova la chiave reale in window._REPARTI ignorando maiuscole/spazi.
// Ritorna null se il reparto non esiste (NON fa fallback su "tutte").
function _repartoKeyDaNome(nome) {
  if (!nome || !window._REPARTI) return null;
  const target = String(nome).trim().toUpperCase();
  return Object.keys(window._REPARTI)
    .find(k => String(k).trim().toUpperCase() === target) || null;
}

// Set (upper-case) delle ribalte appartenenti a un reparto.
function _ribalteDelReparto(repKey) {
  const ids = (repKey && window._REPARTI && window._REPARTI[repKey]) || [];
  return new Set(ids.map(id => String(id).trim().toUpperCase()));
}

// ── STATO INTERNO ─────────────────────────────────────────────────────────────
let _getUser;
let _getMode = () => 'container';
let _unsubRibalte = null;
let _ribalteData  = {};  // { [id]: { occupied, plate, since, user } }
let _unsubPrenAperte = null;
let _prenAperte   = [];  // prenotazioni aperte (stato creata | in_attesa)

// Gruppo selezionato nei picker (per ogni formKey)
const _gruppoPickerForm = {};

// ── INIT ───────────────────────────────────────────────────────────────────────
export function initRibalteOperativo({ getUser, getMode }) {
  _getUser = getUser;
  if (getMode) _getMode = getMode;
  if (window.NavetteCore) window.NavetteCore.startNavetteListener(() => renderRibalte());
  if (_unsubRibalte) _unsubRibalte();
  _unsubRibalte = onSnapshot(
    query(collection(window.db, 'ribalte'), orderBy('__name__')),
    snap => {
      _ribalteData = {};
      snap.docs.forEach(d => { _ribalteData[d.id] = { id: d.id, ...d.data() }; });
      renderRibalte();
    },
    err => console.error('Errore ribalte:', err)
  );
  // Prenotazioni aperte: servono per sapere quali ribalte sono già riservate
  // come destinazione e per mostrare gli spostamenti in corso.
  if (_unsubPrenAperte) _unsubPrenAperte();
  _unsubPrenAperte = onSnapshot(
    query(collection(window.db, 'prenotazioni'), where('stato', 'in', ['creata', 'in_attesa'])),
    snap => {
      _prenAperte = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderRibalte();
    },
    err => console.error('Errore prenotazioni aperte:', err)
  );
}

export function stopRibalte() {
  if (_unsubRibalte) { _unsubRibalte(); _unsubRibalte = null; }
  if (_unsubPrenAperte) { _unsubPrenAperte(); _unsubPrenAperte = null; }
  if (window.NavetteCore) window.NavetteCore.stopNavetteListener();
}

// ── UTILITY: ribalte libere divise per gruppo ─────────────────────────────────
export function getRibalteLibere() {
  const occupate = new Set(
    Object.values(_ribalteData).filter(r => r.occupied).map(r => r.id)
  );
  const dest = _getDestinazioni();
  return {
    PNT1: dest.filter(d => d.startsWith('PNT1') && !occupate.has(d)),
    PNT2: dest.filter(d => d.startsWith('PNT2') && !occupate.has(d))
  };
}

// ── RENDER: lista ribalte nella pagina Ribalte (operativo) ────────────────────
export function renderRibalte() {
  // Il tab Prenota dell'operativo usa la disponibilità ribalte: lo teniamo allineato
  if (typeof window.renderPrenotaOp === 'function') { try { window.renderPrenotaOp(); } catch (e) { console.error(e); } }
  const el = document.getElementById('ribaltaList');
  if (!el) return;
  const modo = _getMode ? _getMode() : 'container';
  const _isCassa = p => /^\d{3}$/.test(String(p || '').trim());

  const user        = _getUser ? _getUser() : null;
  const isOperativo = user?.role === 'operativo';

  // Reparto associato all'utente operativo
  const repKey     = isOperativo ? _repartoKeyDaNome(user.reparto) : null;
  const consentite = isOperativo ? _ribalteDelReparto(repKey) : null;

  // ── Etichetta reparto in alto ───────────────────────────────────────────────
  const subEl = document.getElementById('ribalteSubtitle');
  if (subEl) {
    if (isOperativo) {
      subEl.innerHTML = repKey
        ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;
                        border:1.5px solid var(--accent);background:transparent;
                        color:var(--accent);font-size:13px;font-weight:800;
                        letter-spacing:.5px">🏷️ ${_esc(repKey)}</span>`
        : `<span style="display:inline-block;padding:4px 12px;border-radius:20px;
                        border:1.5px solid var(--red);background:transparent;
                        color:var(--red);font-size:13px;font-weight:800">
             ⚠️ Nessun reparto associato
           </span>`;
    } else {
      subEl.textContent = 'Le tue ribalte di competenza';
    }
  }

  // ── Lista ribalte ───────────────────────────────────────────────────────────
  // Operativo: SOLO le ribalte occupate del proprio reparto (nessuna libera).
  // Le ribalte già dichiarate "in uscita" spariscono dalla sua schermata: restano
  // occupate (per tutti gli altri) finché la portineria non registra l'uscita.
  let ribalte = Object.values(_ribalteData);
  if (isOperativo) {
    ribalte = ribalte.filter(r =>
      r.occupied && !r.inUscita && consentite.has(String(r.id).trim().toUpperCase())
    );
    // Modalità: container → ribalte con container; cassa → ribalte con casse
    ribalte = ribalte.filter(r => modo === 'cassa' ? _isCassa(r.plate) : !_isCassa(r.plate));
  }

  ribalte.sort((a, b) => {
    if (a.occupied && !b.occupied) return -1;
    if (!a.occupied && b.occupied) return 1;
    return a.id.localeCompare(b.id);
  });

  const statsEl = document.getElementById('ribalteStats');
  if (statsEl) {
    if (isOperativo) {
      statsEl.innerHTML = `
        <div class="statCard red"><div class="val">${ribalte.length}</div><div class="lbl">Occupate</div></div>`;
    } else {
      const occ  = ribalte.filter(r => r.occupied).length;
      const free = ribalte.length - occ;
      statsEl.innerHTML = `
        <div class="statCard blue"><div class="val">${ribalte.length}</div><div class="lbl">Totali</div></div>
        <div class="statCard green"><div class="val">${free}</div><div class="lbl">Libere</div></div>
        <div class="statCard red"><div class="val">${occ}</div><div class="lbl">Occupate</div></div>`;
    }
  }

  // ── Navette presenti (dal core), fuori missione ────────────────────────────
  const navetteAll = (window.navette && typeof window.navette === 'object')
    ? Object.values(window.navette) : [];
  // Navette ferme (vuoto/pieno) + navette in spostamento (missione aperta con spostamento:true)
  const _spNav = id => _prenAperte.find(p => p.id === id && p.tipoMissione === 'navetta' && p.spostamento);
  let navette = navetteAll.filter(n => n.attiva && (n.stato === 'vuoto' || n.stato === 'pieno' ||
    (n.stato === 'in_missione' && _spNav(n.missioneId))));
  if (isOperativo) {
    navette = navette.filter(n => n.posizione && consentite.has(String(n.posizione).trim().toUpperCase()));
  }
  if (modo === 'cassa') navette = []; // le navette sono sempre container
  navette.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  if (!ribalte.length && !navette.length) {
    el.innerHTML = isOperativo
      ? (repKey
          ? `<div class="emptyState">Nessuna ribalta occupata da ${modo === 'cassa' ? 'casse' : 'container'} nel tuo reparto.</div>`
          : '<div class="emptyState">Nessun reparto associato al tuo utente.<br><small>Contatta un amministratore.</small></div>')
      : '<div class="emptyState">Nessuna ribalta trovata.<br><small>Inizializza la collection "ribalte" su Firestore.</small></div>';
    return;
  }

  const navHtml = navette.length
    ? `<div class="prenGroupTitle" style="margin:2px 0 8px">🚚 NAVETTE (${navette.length})</div>`
      + navette.map(n => _navettaCardOperativo(n, user)).join('')
    : '';
  el.innerHTML = navHtml + ribalte.map(r => _ribaltaCard(r, user)).join('');
  _ripristinaFormLibera();
}

function _ribaltaCard(r, user) {
  const isOcc = r.occupied;
  const canManage = user?.role === 'operativo' || user?.role === 'amministratore' || user?.role === 'amministrativo';
  const since = r.since?.toDate ? r.since.toDate() : (r.since ? new Date(r.since) : null);

  let body = '';
  if (isOcc) {
    const sinceStr = since
      ? since.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';
    body += `
      <div style="font-size:18px;font-weight:700;margin:6px 0 2px">${_esc(r.plate || '—')}</div>
      <div style="font-size:12px;color:var(--muted)">Da: ${sinceStr}${since ? ' · ' + fmtDur(since) : ''}</div>`;

    if (r.inUscita) {
      body += `<div style="margin-top:6px;font-size:12px;font-weight:700;color:var(--accent2)">🚪 In uscita — in attesa che la portineria registri l'uscita</div>`;
    }

    // Liberazione richiesta: la ribalta resta occupata finché l'autista non porta via il mezzo
    if (r.inLiberazione) {
      body += `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;border:1.5px solid orange;font-size:13px;font-weight:700;color:orange">
        🚛 In liberazione — in attesa dell'autista</div>`;
    }

    // Spostamento in corso verso un'altra ribalta
    if (r.inSpostamento) {
      const sp = _prenAperte.find(p => p.id === r.inSpostamento);
      const mio = sp && user && sp.utenteUid === user.uid;
      body += `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;border:1.5px solid var(--accent);font-size:13px;font-weight:700;color:var(--accent)">
        🔀 In spostamento → ${_esc(r.spostamentoVerso || sp?.destinazione || '—')}
        ${sp ? `<div style="font-size:11px;font-weight:500;color:var(--muted);margin-top:2px">Richiesto da ${_esc(sp.utenteNome || sp.utenteEmail || '—')}</div>` : ''}
      </div>`;
      if (mio) {
        body += `<button onclick="annullaSpostamento('${_esc(r.inSpostamento)}')"
          style="width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--red,#ef4444);background:transparent;color:var(--red,#ef4444);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">
          ✕ Annulla spostamento</button>`;
      }
    }

    if (canManage && !r.inLiberazione && !r.inSpostamento && !r.inUscita) {
      body += `
        <button onclick="apriSposta('ribalta','${r.id}')"
                style="width:100%;margin-top:10px;padding:11px;border-radius:8px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
          🔀 Sposta in altra ribalta
        </button>
        ${_spostaSezioneHTML(r.id)}`;
    }

    if (canManage && !r.inLiberazione && !r.inSpostamento) {
      body += `
        <button class="btnRed" style="width:100%;margin-top:10px;padding:11px;font-size:14px"
                onclick="toggleLiberaForm('${r.id}')">
          🚛 Libera ribalta
        </button>
        <div id="liberaForm_${r.id}" style="display:none;margin-top:10px">
         <div id="liberaScelta_${r.id}">
          <div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px">Destinazione del veicolo:</div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <button id="btnDestPark_${r.id}" onclick="setLiberaDest('${r.id}','parcheggio')"
                    style="flex:1;padding:10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">
              🅿️ A parcheggio
            </button>
            <button id="btnDestExit_${r.id}" onclick="setLiberaDest('${r.id}','uscita')"
                    style="flex:1;padding:10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">
              🚪 In uscita
            </button>
          </div>

          <div id="parkSub_${r.id}" style="display:none">
            <div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px">Stato veicolo alla liberazione:</div>
            <div style="display:flex;gap:8px;margin-bottom:10px">
              <button id="btnVuota_${r.id}" onclick="setLiberaStato('${r.id}','vuota')"
                      style="flex:1;padding:8px;border-radius:8px;border:2px solid var(--accent);background:var(--accent);color:#1C1F26;font-weight:700;font-family:inherit;font-size:13px;cursor:pointer">
                🟢 Vuota
              </button>
              <button id="btnPiena_${r.id}" onclick="setLiberaStato('${r.id}','piena')"
                      style="flex:1;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:13px;cursor:pointer">
                🟡 Piena
              </button>
            </div>
            <button onclick="chiediConfermaLibera('${r.id}','parcheggio')"
                    style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
              ✓ Conferma e crea missione
            </button>
          </div>

          <div id="exitSub_${r.id}" style="display:none">
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.4">Il veicolo lascerà lo stabilimento. Nessuna missione verrà creata: la ribalta resta occupata finché la portineria non registra l'uscita.</div>
            <button onclick="chiediConfermaLibera('${r.id}','uscita')"
                    style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
              ✓ Conferma uscita
            </button>
          </div>

          <button onclick="toggleLiberaForm('${r.id}')"
                  style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">
            Annulla
          </button>
         </div>
         <div id="liberaConferma_${r.id}" style="display:none"></div>
        </div>`;
    }
  } else {
    body += `<div style="color:var(--accent2);font-weight:700;font-size:13px;margin-top:4px">Disponibile</div>`;
  }

  return `
    <div class="prenCard" style="margin-bottom:10px">
      <div class="prenHeader">
        <span style="font-size:18px;font-weight:800;letter-spacing:1px">${_esc(r.id)}</span>
        <span class="prenBadge ${isOcc ? 'creata' : 'completata'}">${isOcc ? '🔴 Occupata' : '🟢 Libera'}</span>
      </div>
      ${body}
    </div>`;
}

// ── DISPONIBILITÀ RIBALTE (condivisa: sposta, prenotazioni, richiesta cassa) ──
// Tutte le ribalte note (window._REPARTI è la fonte autorevole).
function _tutteLeRibalte() {
  return window._REPARTI
    ? [...new Set(Object.values(window._REPARTI).flat().map(r => String(r).trim().toUpperCase()))]
    : [];
}

// Reparto (chiave _REPARTI) di una ribalta
export function repartoDiRibalta(id) {
  const k = String(id || '').trim().toUpperCase();
  for (const [rep, ids] of Object.entries(window._REPARTI || {})) {
    if ((ids || []).some(x => String(x).trim().toUpperCase() === k)) return rep;
  }
  return null;
}

// Ribalte riservate come destinazione da missioni/richieste aperte
function _ribalteRiservate(escludiPrenId = null) {
  const s = new Set();
  _prenAperte.forEach(p => {
    if (p.id === escludiPrenId) return;
    const d = String(p.destinazione || '').trim().toUpperCase();
    if (d && d !== '—') s.add(d);
  });
  return s;
}

// Ribalte dove si trova fisicamente una navetta attiva
function _ribalteConNavetta() {
  return new Set(Object.values(window.navette || {})
    .filter(n => n.attiva && n.posizione)
    .map(n => String(n.posizione).trim().toUpperCase()));
}

/**
 * Stato di disponibilità di una ribalta come DESTINAZIONE.
 * 'libera' | 'in_liberazione' | 'occupata' | 'riservata' | 'navetta'
 */
export function statoRibaltaDestinazione(id, escludiPrenId = null) {
  const k = String(id || '').trim().toUpperCase();
  if (_ribalteConNavetta().has(k)) return 'navetta';
  if (_ribalteRiservate(escludiPrenId).has(k)) return 'riservata';
  const r = _ribalteData[k];
  if (r && r.occupied) return r.inLiberazione ? 'in_liberazione' : 'occupata';
  return 'libera';
}

/**
 * Elenco ribalte utilizzabili come destinazione.
 * opts.reparto: chiave reparto (null = tutti) · opts.ammettiInLiberazione: bool
 * Ritorna [{ id, stato }] ordinato per id.
 */
export function ribalteDisponibili({ reparto = null, ammettiInLiberazione = false, escludiPrenId = null } = {}) {
  let ids = _tutteLeRibalte();
  if (reparto) {
    const set = _ribalteDelReparto(reparto);
    ids = ids.filter(id => set.has(id));
  }
  return ids
    .map(id => ({ id, stato: statoRibaltaDestinazione(id, escludiPrenId) }))
    .filter(x => x.stato === 'libera' || (ammettiInLiberazione && x.stato === 'in_liberazione'))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getPrenotazioniAperte() { return _prenAperte; }
export function getRibalteData() { return _ribalteData; }

// ── PICKER RIBALTA GENERICO (reparto → altri reparti: edificio → reparto) ────
// Stato per chiave picker: { vista:'reparto'|'edifici'|'reparti'|'ribalte', edificio, rep }
const _pickerNav = {};
// Callback di selezione per chiave picker (nome funzione globale)
const _pickerCb = {};

/**
 * HTML del picker ribalte.
 * key: chiave univoca · onSelectFn: nome funzione window chiamata (key, ribaltaId)
 * opts: { repartoUtente, ammettiInLiberazione, escludiPrenId, escludiId }
 */
export function pickerRibaltaHTML(key, onSelectFn, opts = {}) {
  _pickerCb[key] = onSelectFn;
  _pickerCb[key + '__opts'] = opts;
  const nav = _pickerNav[key] || (_pickerNav[key] = { vista: opts.repartoUtente ? 'reparto' : 'edifici' });
  const esclusa = String(opts.escludiId || '').trim().toUpperCase();
  const lista = (rep) => ribalteDisponibili({ reparto: rep, ammettiInLiberazione: !!opts.ammettiInLiberazione, escludiPrenId: opts.escludiPrenId })
    .filter(x => x.id !== esclusa);
  const selezionata = opts.selezionata ? String(opts.selezionata).toUpperCase() : null;
  const btn = (x) => {
    const inLib = x.stato === 'in_liberazione';
    const sel = selezionata === x.id;
    return `<button onclick="_pickerSeleziona('${key}','${x.id}')"
      style="padding:8px 12px;border-radius:8px;margin:3px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;
             border:${sel ? '2px solid var(--accent)' : '1.5px solid ' + (inLib ? 'orange' : 'var(--border)')};
             background:${sel ? 'var(--accent)' : 'var(--surface2)'};color:${sel ? '#1C1F26' : (inLib ? 'orange' : 'var(--accent)')}">
      ${_esc(x.id)}${inLib ? ' 🚛' : ''}</button>`;
  };
  const navBtn = (label, onclick) => `<button onclick="${onclick}"
      style="padding:7px 12px;border-radius:8px;margin:3px;border:1.5px solid var(--border);background:var(--surface2);
             color:var(--text);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">${label}</button>`;
  const label = (t) => `<div style="font-size:12px;font-weight:600;color:var(--muted);margin:6px 0;text-transform:uppercase;letter-spacing:.4px">${t}</div>`;
  const legenda = opts.ammettiInLiberazione
    ? '<div style="font-size:11px;color:var(--muted);margin-top:4px">🚛 = ribalta in liberazione (sarà libera quando l\'autista porta via il mezzo)</div>' : '';

  let h = '';
  if (nav.vista === 'reparto') {
    const l = lista(opts.repartoUtente);
    h += label(`Ribalte ${_esc(opts.repartoUtente)}`);
    h += l.length ? `<div style="display:flex;flex-wrap:wrap">${l.map(btn).join('')}</div>`
                  : '<div style="color:var(--muted);font-size:13px;padding:6px">Nessuna ribalta disponibile nel tuo reparto</div>';
    h += `<div style="margin-top:6px">${navBtn('🔀 Mostra altri reparti', `_pickerVista('${key}','edifici')`)}</div>`;
  } else if (nav.vista === 'edifici') {
    if (opts.repartoUtente) h += navBtn('← Il mio reparto', `_pickerVista('${key}','reparto')`);
    h += label('Edificio');
    ['PNT1', 'PNT2'].forEach(ed => {
      const n = lista(null).filter(x => x.id.startsWith(ed + '-')).length;
      if (n) h += navBtn(`🏭 ${ed} (${n})`, `_pickerVista('${key}','reparti','${ed}')`);
    });
    if (!lista(null).length) h += '<div style="color:var(--muted);font-size:13px;padding:6px">Nessuna ribalta disponibile</div>';
  } else if (nav.vista === 'reparti') {
    h += navBtn('← Edifici', `_pickerVista('${key}','edifici')`);
    h += label(`Reparto — ${_esc(nav.edificio)}`);
    Object.keys(window._REPARTI || {}).forEach(rep => {
      const n = lista(rep).filter(x => x.id.startsWith(nav.edificio + '-')).length;
      if (n) h += navBtn(`${_esc(rep)} (${n})`, `_pickerVista('${key}','ribalte','${nav.edificio}','${_esc(rep)}')`);
    });
  } else {
    h += navBtn('← Reparti', `_pickerVista('${key}','reparti','${nav.edificio}')`);
    h += label(_esc(nav.rep));
    const l = lista(nav.rep).filter(x => x.id.startsWith(nav.edificio + '-'));
    h += l.length ? `<div style="display:flex;flex-wrap:wrap">${l.map(btn).join('')}</div>`
                  : '<div style="color:var(--muted);font-size:13px;padding:6px">Nessuna ribalta disponibile</div>';
  }
  return `<div id="pickerRib_${key}">${h}${legenda}</div>`;
}

export function resetPicker(key) { delete _pickerNav[key]; }

window._pickerVista = function(key, vista, edificio, rep) {
  _pickerNav[key] = { vista, edificio: edificio || null, rep: rep || null };
  const el = document.getElementById('pickerRib_' + key);
  if (el) el.outerHTML = pickerRibaltaHTML(key, _pickerCb[key], _pickerCb[key + '__opts'] || {});
};

window._pickerSeleziona = function(key, id) {
  const fn = _pickerCb[key];
  if (fn && typeof window[fn] === 'function') window[fn](key, id);
};

// ── SPOSTA IN ALTRA RIBALTA ───────────────────────────────────────────────────
// _sposta: { key, tipo:'ribalta'|'navetta', origine, nome?, dest, fase:'scelta'|'conferma' }
let _sposta = null;
const _spostaInCorso = new Set();

function _spostaSezioneHTML(key) {
  if (!_sposta || _sposta.key !== key) return '';
  const user = _getUser ? _getUser() : null;
  const repKey = _repartoKeyDaNome(user?.reparto);
  const fase = _sposta.fase;
  let h = `<div style="margin-top:10px;padding:10px;border-radius:10px;border:1.5px solid var(--accent);background:var(--surface2)">`;
  if (fase === 'scelta') {
    h += `<div style="font-size:13px;font-weight:700;margin-bottom:4px">🔀 Sposta ${_esc(_sposta.tipo === 'navetta' ? _sposta.nome : _sposta.origine)} in:</div>`;
    h += pickerRibaltaHTML('sposta_' + key, '_spostaScegli', {
      repartoUtente: repKey, escludiId: _sposta.origine, selezionata: _sposta.dest,
    });
    h += `<button onclick="spostaAnnullaForm()"
            style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">Annulla</button>`;
  } else {
    const r = _ribalteData[_sposta.origine] || {};
    const cosa = _sposta.tipo === 'navetta'
      ? `la navetta <strong>${_esc(_sposta.nome)}</strong>`
      : `il veicolo <strong>${_esc(r.plate || '—')}</strong> (${r.full ? '🟡 pieno' : '🟢 vuoto'})`;
    const altroRep = repKey && repartoDiRibalta(_sposta.dest) !== repKey
      ? `<br><span style="color:orange">⚠ La ribalta ${_esc(_sposta.dest)} è del reparto ${_esc(repartoDiRibalta(_sposta.dest) || '—')}.</span>` : '';
    h += `<div style="font-size:14px;font-weight:800;margin-bottom:6px">⚠️ Sei sicuro?</div>
      <div style="font-size:13px;line-height:1.45;margin-bottom:12px">
        Sposta ${cosa} da <strong>${_esc(_sposta.origine)}</strong> a <strong>${_esc(_sposta.dest)}</strong>.<br>
        Verrà creata la missione per l'autista; il mezzo mantiene il suo stato.${altroRep}
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="spostaIndietro()"
          style="flex:1;padding:11px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">✕ No</button>
        <button id="btnSiSposta" onclick="confermaSposta()"
          style="flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer">✓ Sì, sposta</button>
      </div>`;
  }
  return h + '</div>';
}

window.apriSposta = function(tipo, origine, nome) {
  const key = tipo === 'navetta' ? 'NAV_' + nome : origine;
  if (_sposta && _sposta.key === key) { _sposta = null; renderRibalte(); return; }
  // chiude un eventuale form "libera" aperto
  if (_formAperto) { _formAperto = null; }
  resetPicker('sposta_' + key);
  _sposta = { key, tipo, origine, nome: nome || null, dest: null, fase: 'scelta' };
  renderRibalte();
};

window._spostaScegli = function(_pickerKey, id) {
  if (!_sposta) return;
  _sposta.dest = id;
  _sposta.fase = 'conferma';
  renderRibalte();
};
window.spostaIndietro   = function() { if (_sposta) { _sposta.fase = 'scelta'; renderRibalte(); } };
window.spostaAnnullaForm = function() { _sposta = null; renderRibalte(); };

window.confermaSposta = async function() {
  if (!_sposta || !_sposta.dest) return;
  const { tipo, origine, dest, nome } = _sposta;
  const key = _sposta.key;
  if (_spostaInCorso.has(key)) return;
  const stato = statoRibaltaDestinazione(dest);
  if (stato !== 'libera') { showToast(`La ribalta ${dest} non è più disponibile`, 'error'); _sposta.fase = 'scelta'; renderRibalte(); return; }
  _spostaInCorso.add(key);
  const b = document.getElementById('btnSiSposta'); if (b) { b.disabled = true; b.textContent = '⏳…'; }
  const user = _getUser ? _getUser() : null;
  try {
    if (tipo === 'navetta') {
      if (!window.NavetteCore) throw new Error('Modulo navette non caricato');
      await window.NavetteCore.creaMissioneSpostamento({ navettaId: nome, origine, destinazione: dest, user });
      await window.logHistory({ spot: origine, action: 'Ribalta richiesta', tipo: 'container',
        plate: nome, navettaId: nome, tipoMissione: 'spostamento', origine, destinazione: dest });
    } else {
      const oriRef  = doc(window.db, 'ribalte', origine);
      const destRef = doc(window.db, 'ribalte', dest);
      const prenRef = doc(collection(window.db, 'prenotazioni'));
      let plate = null, tipoMezzo = 'container', full = false;
      await runTransaction(window.db, async (tx) => {
        const os = await tx.get(oriRef);
        const ds = await tx.get(destRef);
        const o = os.exists() ? os.data() : null;
        if (!o || !o.occupied) throw new Error(`La ribalta ${origine} non risulta occupata`);
        if (o.inLiberazione) throw new Error(`La ribalta ${origine} è già in liberazione`);
        if (o.inSpostamento) throw new Error(`La ribalta ${origine} ha già uno spostamento in corso`);
        if (o.inUscita) throw new Error(`Il veicolo di ${origine} è in uscita`);
        if (ds.exists() && ds.data().occupied) throw new Error(`La ribalta ${dest} è occupata`);
        plate = o.plate || null;
        tipoMezzo = /^\d{3}$/.test(String(plate || '').trim()) ? 'cassa' : 'container';
        full = !!o.full;
        tx.set(prenRef, {
          tipoMissione:   'spostamento',
          tipoMezzo,
          stato:          'creata',
          plate,
          spotId:         origine,
          origine,
          destinazione:   dest,
          fullAllaLibera: full,
          sinceOrigine:   o.since || null,
          urgente:        false,
          dataOra:        serverTimestamp(),
          utenteUid:      user?.uid   || '',
          utenteEmail:    user?.email || '',
          utenteNome:     user?.name  || user?.email || '',
          utenteReparto:  user?.reparto || null,
          note:           `Spostamento ${origine} → ${dest}`,
        });
        tx.set(oriRef, { inSpostamento: prenRef.id, spostamentoVerso: dest }, { merge: true });
      });
      await window.logHistory({ spot: origine, action: 'Ribalta richiesta', tipo: tipoMezzo, plate, full,
        tipoMissione: 'spostamento', origine, destinazione: dest });
    }
    _sposta = null;
    showToast(`Spostamento ${origine} → ${dest}: missione creata`, 'success');
    renderRibalte();
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
    if (b) { b.disabled = false; b.textContent = '✓ Sì, sposta'; }
  } finally {
    _spostaInCorso.delete(key);
  }
};

// Annulla spostamento: solo l'autore della richiesta
window.annullaSpostamento = async function(prenId) {
  const user = _getUser ? _getUser() : null;
  const p = _prenAperte.find(x => x.id === prenId);
  if (!p) { showToast('Spostamento non trovato', 'error'); return; }
  if (!user || p.utenteUid !== user.uid) { showToast('Puoi annullare solo i tuoi spostamenti', 'error'); return; }
  if (!confirm('Annullare lo spostamento?')) return;
  try {
    if (p.tipoMissione === 'navetta') {
      await window.NavetteCore.annullaSpostamento({ prenId, user });
    } else {
      await updateDoc(doc(window.db, 'prenotazioni', prenId), {
        stato: 'annullata', annullataAt: serverTimestamp(),
        annullataDaUid: user.uid, annullataDaNome: user.name || user.email || null,
      });
      await setDoc(doc(window.db, 'ribalte', p.origine || p.spotId), { inSpostamento: null, spostamentoVerso: null }, { merge: true });
    }
    await window.logHistory({ spot: p.origine || p.spotId, action: 'Prenotazione annullata',
      tipo: p.tipoMezzo === 'cassa' ? 'cassa' : 'container', plate: p.plate || p.navettaId || null,
      tipoMissione: 'spostamento', destinazione: p.destinazione || null });
    showToast('Spostamento annullato', 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  }
};

// ── FORM LIBERA RIBALTA ───────────────────────────────────────────────────────
const _liberaStato = {};
const _liberaDest  = {};
let _formAperto = null;            // { id, fase: 'scelta'|'conferma' } — sopravvive ai re-render
const _liberaInCorso = new Set();  // evita doppi invii

window.toggleLiberaForm = function(id) {
  if (_sposta) { _sposta = null; renderRibalte(); }
  const form = document.getElementById('liberaForm_' + id);
  if (!form) return;
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // un solo form aperto alla volta
    if (_formAperto && _formAperto.id !== id) {
      const altro = document.getElementById('liberaForm_' + _formAperto.id);
      if (altro) altro.style.display = 'none';
    }
    _formAperto = { id, fase: 'scelta' };
    _liberaStato[id] = 'vuota';
    _liberaDest[id]  = null;
    const ps = document.getElementById('parkSub_' + id); if (ps) ps.style.display = 'none';
    const es = document.getElementById('exitSub_' + id); if (es) es.style.display = 'none';
    _mostraFase(id, 'scelta');
    _aggiornaDest(id);
  } else if (_formAperto?.id === id) {
    _formAperto = null;
  }
};

function _mostraFase(id, fase) {
  const sc = document.getElementById('liberaScelta_' + id);
  const cf = document.getElementById('liberaConferma_' + id);
  if (sc) sc.style.display = fase === 'scelta' ? 'block' : 'none';
  if (cf) {
    cf.style.display = fase === 'conferma' ? 'block' : 'none';
    cf.innerHTML = fase === 'conferma' ? _confermaHTML(id) : '';
  }
}

// Seconda richiesta di conferma (riepilogo) prima di scrivere su Firestore
function _confermaHTML(id) {
  const r = _ribalteData[id] || {};
  const dest = _liberaDest[id];
  const plate = _esc(r.plate || '—');
  const testo = dest === 'uscita'
    ? `Il veicolo <strong>${plate}</strong> lascerà lo stabilimento.<br>La ribalta <strong>${_esc(id)}</strong> sparirà dalla tua lista ma resterà occupata finché la portineria non registra l'uscita.`
    : `Ribalta <strong>${_esc(id)}</strong> → parcheggio.<br>Veicolo <strong>${plate}</strong> dichiarato <strong>${(_liberaStato[id] || 'vuota') === 'piena' ? '🟡 PIENO' : '🟢 VUOTO'}</strong>: verrà creata la missione per l'autista.<br>La ribalta resterà occupata finché l'autista non porta via il veicolo.`;
  const onYes = dest === 'uscita' ? `confermaLiberaUscita('${id}')` : `confermaLibera('${id}')`;
  return `
    <div style="padding:12px;border-radius:10px;border:2px solid var(--accent2,orange);background:var(--surface2)">
      <div style="font-size:14px;font-weight:800;margin-bottom:6px">⚠️ Sei sicuro?</div>
      <div style="font-size:13px;line-height:1.45;margin-bottom:12px">${testo}</div>
      <div style="display:flex;gap:8px">
        <button onclick="annullaConfermaLibera('${id}')"
                style="flex:1;padding:11px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
          ✕ No
        </button>
        <button id="btnSiLibera_${id}" onclick="${onYes}"
                style="flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer">
          ✓ Sì, confermo
        </button>
      </div>
    </div>`;
}

window.chiediConfermaLibera = function(id, dest) {
  _liberaDest[id] = dest;
  _formAperto = { id, fase: 'conferma' };
  _mostraFase(id, 'conferma');
};

window.annullaConfermaLibera = function(id) {
  _formAperto = { id, fase: 'scelta' };
  _mostraFase(id, 'scelta');
};

// Dopo ogni re-render (snapshot ribalte/navette) riapre il form che era aperto
function _ripristinaFormLibera() {
  if (!_formAperto) return;
  const { id, fase } = _formAperto;
  const form = document.getElementById('liberaForm_' + id);
  if (!form) { _formAperto = null; return; }  // ribalta sparita/liberata
  form.style.display = 'block';
  const dest = _liberaDest[id];
  const ps = document.getElementById('parkSub_' + id); if (ps) ps.style.display = dest === 'parcheggio' ? 'block' : 'none';
  const es = document.getElementById('exitSub_' + id); if (es) es.style.display = dest === 'uscita' ? 'block' : 'none';
  _aggiornaDest(id);
  _aggiornaToggle(id);
  _mostraFase(id, fase);
}

window.setLiberaStato = function(id, stato) {
  _liberaStato[id] = stato;
  _aggiornaToggle(id);
};

window.setLiberaDest = function(id, dest) {
  _liberaDest[id] = dest;
  const ps = document.getElementById('parkSub_' + id);
  const es = document.getElementById('exitSub_' + id);
  if (ps) ps.style.display = dest === 'parcheggio' ? 'block' : 'none';
  if (es) es.style.display = dest === 'uscita' ? 'block' : 'none';
  if (dest === 'parcheggio') { _liberaStato[id] = _liberaStato[id] || 'vuota'; _aggiornaToggle(id); }
  _aggiornaDest(id);
};

function _aggiornaDest(id) {
  const bP = document.getElementById('btnDestPark_' + id);
  const bE = document.getElementById('btnDestExit_' + id);
  if (!bP || !bE) return;
  const dest = _liberaDest[id];
  const base = 'flex:1;padding:10px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer';
  bP.style.cssText = base + (dest === 'parcheggio'
    ? ';border:2px solid var(--accent);background:var(--accent);color:#1C1F26'
    : ';border:1.5px solid var(--border);background:var(--surface2);color:var(--text)');
  bE.style.cssText = base + (dest === 'uscita'
    ? ';border:2px solid var(--accent);background:var(--accent);color:#1C1F26'
    : ';border:1.5px solid var(--border);background:var(--surface2);color:var(--text)');
}

function _aggiornaToggle(id) {
  const btnV = document.getElementById('btnVuota_' + id);
  const btnP = document.getElementById('btnPiena_' + id);
  if (!btnV || !btnP) return;
  const stato = _liberaStato[id] || 'vuota';
  const base = 'flex:1;padding:8px;border-radius:8px;font-family:inherit;font-size:13px;cursor:pointer';
  btnV.style.cssText = base + (stato === 'vuota'
    ? ';border:2px solid var(--accent);background:var(--accent);color:#1C1F26;font-weight:700'
    : ';border:1.5px solid var(--border);background:var(--surface2);color:var(--text)');
  btnP.style.cssText = base + (stato === 'piena'
    ? ';border:2px solid orange;background:orange;color:#1C1F26;font-weight:700'
    : ';border:1.5px solid var(--border);background:var(--surface2);color:var(--text)');
}

window.confermaLibera = async function(id) {
  const user  = _getUser ? _getUser() : null;
  const r     = _ribalteData[id];
  if (!r) return;
  const full  = (_liberaStato[id] || 'vuota') === 'piena';
  const plate = r.plate || '—';
  if (_liberaInCorso.has(id)) return;
  _liberaInCorso.add(id);
  const b = document.getElementById('btnSiLibera_' + id); if (b) { b.disabled = true; b.textContent = '⏳…'; }
  try {
    // La ribalta NON viene liberata qui: resta occupata (inLiberazione) finché
    // l'autista non completa la missione portando via il mezzo.
    const prenRef = await addDoc(collection(window.db, 'prenotazioni'), {
      plate,
      spotId:         id,
      destinazione:   '—',
      dataOra:        serverTimestamp(),
      stato:          'creata',
      urgente:        false,
      utenteUid:      user?.uid   || '',
      utenteEmail:    user?.email || '',
      utenteNome:     user?.name  || user?.email || '',
      tipoMissione:   'ribalta',
      fullAllaLibera: full,
      note:           `Ribalta ${id} liberata — veicolo ${full ? 'PIENO' : 'VUOTO'}`,
      utenteReparto:  user?.reparto || null,
    });
    await setDoc(doc(window.db, 'ribalte', id), {
      inLiberazione: prenRef.id, liberazioneDa: serverTimestamp()
    }, { merge: true });
    await window.logHistory({ spot: id, action: 'Ribalta richiesta', plate, tipo: /^\d{3}$/.test(String(plate).trim()) ? 'cassa' : 'container', full });
    if (_formAperto?.id === id) _formAperto = null;
    showToast(`Ribalta ${id}: liberazione richiesta — missione creata`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
    if (b) { b.disabled = false; b.textContent = '✓ Sì, confermo'; }
  } finally {
    _liberaInCorso.delete(id);
  }
};

// Destinazione USCITA: nessuna missione. La ribalta resta occupata e viene
// marcata inUscita; sarà liberata dalla portineria al momento dell'uscita.
window.confermaLiberaUscita = async function(id) {
  const r = _ribalteData[id];
  if (!r) return;
  const plate = r.plate || '—';
  if (_liberaInCorso.has(id)) return;
  _liberaInCorso.add(id);
  const b = document.getElementById('btnSiLibera_' + id); if (b) { b.disabled = true; b.textContent = '⏳…'; }
  try {
    await setDoc(doc(window.db, 'ribalte', id), { inUscita: true }, { merge: true });
    await window.logHistory({ spot: id, action: 'Ribalta in uscita', plate });
    if (_formAperto?.id === id) _formAperto = null;
    showToast(`Ribalta ${id}: veicolo in uscita — la libererà la portineria`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
    if (b) { b.disabled = false; b.textContent = '✓ Sì, confermo'; }
  } finally {
    _liberaInCorso.delete(id);
  }
};

// ── CARD NAVETTA (operativo) ──────────────────────────────────────────────────
// Pieno  → "Dichiara scaricata" (pieno→vuoto, abbina la coda via NavetteCore)
// Vuoto  → "Carica e spedisci"  (crea missione pieno verso una ribalta)
function _navettaCardOperativo(n, user) {
  // Navetta in spostamento: solo stato + annulla (autore)
  if (n.stato === 'in_missione') {
    const sp = _prenAperte.find(p => p.id === n.missioneId);
    const mio = sp && user && sp.utenteUid === user.uid;
    return `
    <div class="prenCard" style="margin-bottom:10px;border:1.5px solid var(--accent)">
      <div class="prenHeader">
        <span style="font-size:18px;font-weight:800;letter-spacing:1px">🚚 ${_esc(n.nome)}</span>
        <span class="prenBadge creata">🔀 In spostamento</span>
      </div>
      <div style="font-size:13px;margin-top:6px"><strong>${_esc(sp?.origine || n.posizione || '—')}</strong> → <strong>${_esc(sp?.destinazione || '—')}</strong>
        · ${sp?.faseNavetta === 'pieno' ? '🟡 Pieno' : '🟢 Vuoto'}</div>
      ${sp ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">Richiesto da ${_esc(sp.utenteNome || sp.utenteEmail || '—')}</div>` : ''}
      ${mio ? `<button onclick="annullaSpostamento('${_esc(sp.id)}')"
          style="width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--red,#ef4444);background:transparent;color:var(--red,#ef4444);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">
          ✕ Annulla spostamento</button>` : ''}
    </div>`;
  }
  const isPieno = n.stato === 'pieno';
  const badge = isPieno ? '🟡 Pieno' : '🟢 Vuoto';
  let body = `<div style="font-size:12px;color:var(--muted);margin-top:4px">Posizione: <strong>${_esc(n.posizione || '—')}</strong></div>`;

  if (n.posizione) {
    body += `
      <button onclick="apriSposta('navetta','${_esc(n.posizione)}','${_esc(n.nome)}')"
              style="width:100%;margin-top:10px;padding:11px;border-radius:8px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
        🔀 Sposta in altra ribalta
      </button>
      ${_spostaSezioneHTML('NAV_' + n.nome)}`;
  }

  if (isPieno) {
    body += `
      <button class="btnRed" style="width:100%;margin-top:10px;padding:11px;font-size:14px"
              onclick="dichiaraNavettaVuota('${_esc(n.nome)}')">
        🟡→🟢 Dichiara scaricata
      </button>`;
  } else {
    body += `
      <button onclick="toggleSpedisciForm('${_esc(n.nome)}')"
              style="width:100%;margin-top:10px;padding:11px;border-radius:8px;border:none;
                     background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;
                     font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
        🚚 Carica e spedisci
      </button>
      <div id="spedForm_${_esc(n.nome)}" style="display:none;margin-top:10px">
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px">Ribalta di destinazione:</div>
        <input id="spedInput_${_esc(n.nome)}" class="inputField" spellcheck="false"
               style="text-transform:uppercase" placeholder="es. PNT1-03"
               onkeydown="if(event.key==='Enter')spedisciNavetta('${_esc(n.nome)}')">
        <button onclick="spedisciNavetta('${_esc(n.nome)}')"
                style="width:100%;margin-top:8px;padding:11px;border-radius:8px;border:none;
                       background:var(--accent);color:#1C1F26;font-family:inherit;font-size:14px;
                       font-weight:700;cursor:pointer">
          ✓ Crea missione
        </button>
        <button onclick="toggleSpedisciForm('${_esc(n.nome)}')"
                style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1.5px solid var(--border);
                       background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">
          Annulla
        </button>
      </div>`;
  }

  return `
    <div class="prenCard" style="margin-bottom:10px;border:1.5px solid var(--accent)">
      <div class="prenHeader">
        <span style="font-size:18px;font-weight:800;letter-spacing:1px">🚚 ${_esc(n.nome)}</span>
        <span class="prenBadge ${isPieno ? 'creata' : 'completata'}">${badge}</span>
      </div>
      ${body}
    </div>`;
}

function _isRibaltaValida(id) {
  const k = String(id || '').trim().toUpperCase();
  if (!k || !window._REPARTI) return false;
  return Object.values(window._REPARTI).flat().some(r => String(r).trim().toUpperCase() === k);
}

window.toggleSpedisciForm = function(nome) {
  const f = document.getElementById('spedForm_' + nome);
  if (!f) return;
  const open = f.style.display !== 'none';
  f.style.display = open ? 'none' : 'block';
  if (!open) setTimeout(() => document.getElementById('spedInput_' + nome)?.focus(), 60);
};

window.dichiaraNavettaVuota = async function(nome) {
  if (!window.NavetteCore) { showToast('Modulo navette non caricato', 'error'); return; }
  try {
    const res = await window.NavetteCore.dichiaraVuoto({ navettaId: nome });
    showToast(res.abbinata
      ? `${nome} scaricata — abbinata a una richiesta vuoto`
      : `${nome} ora vuota`, 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  }
};

window.spedisciNavetta = async function(nome) {
  const input = document.getElementById('spedInput_' + nome);
  const dest = (input?.value || '').trim().toUpperCase();
  if (!dest) { showToast('Inserisci la ribalta di destinazione', 'error'); return; }
  if (!_isRibaltaValida(dest)) { showToast(`Ribalta "${dest}" non valida.`, 'error'); return; }
  if (!window.NavetteCore) { showToast('Modulo navette non caricato', 'error'); return; }
  const n = (window.navette || {})[nome];
  const origine = n?.posizione || null;
  if (!origine) { showToast('Posizione navetta sconosciuta', 'error'); return; }
  try {
    await window.NavetteCore.creaMissionePieno({
      navettaId: nome, origine, destinazione: dest,
      user: (_getUser ? _getUser() : null),
    });
    showToast(`Missione navetta ${nome} creata (${origine} → ${dest})`, 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  }
};

// ── PICKER RIBALTE DISPONIBILI (usato nei form completamento) ─────────────────
/**
 * Ritorna l'HTML del picker ribalte libere divise per PNT1/PNT2.
 * formKey: chiave univoca del form (es. 'completa_<prenId>' o 'cassa_<spotId>')
 * onSelect: stringa JS da eseguire al click sul tasto (riceve la destinazione come arg)
 *   es. "confermaCompletamento" oppure "confermaCassa"
 */
export function ribaltaPickerHTML(formKey) {
  const gruppo = _gruppoPickerForm[formKey] || 'PNT1';
  const { PNT1, PNT2 } = getRibalteLibere();
  const list = gruppo === 'PNT1' ? PNT1 : PNT2;

  const btnGruppoStyle = (active) =>
    `padding:7px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;` +
    (active
      ? `border:2px solid var(--accent);background:var(--accent);color:#1C1F26`
      : `border:1.5px solid var(--border);background:var(--surface2);color:var(--text)`);

  const items = list.length
    ? list.map(d => `
        <button id="ribBtn_${formKey}_${d}"
                onclick="scegliRibalta('${formKey}','${d}')"
                style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);
                       background:var(--surface2);color:var(--accent);font-family:inherit;
                       font-size:14px;font-weight:700;cursor:pointer;margin:3px">
          ${_esc(d)}
        </button>`).join('')
    : `<div style="color:var(--muted);font-size:13px;padding:8px">Nessuna ribalta libera per ${gruppo}</div>`;

  return `
    <div id="ribaltaPicker_${formKey}">
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">
        Ribalta disponibile:
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button onclick="cambiaGruppoPicker('${formKey}','PNT1')" style="${btnGruppoStyle(gruppo==='PNT1')}">PNT1</button>
        <button onclick="cambiaGruppoPicker('${formKey}','PNT2')" style="${btnGruppoStyle(gruppo==='PNT2')}">PNT2</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${items}</div>
    </div>`;
}

window.cambiaGruppoPicker = function(formKey, gruppo) {
  _gruppoPickerForm[formKey] = gruppo;
  const el = document.getElementById('ribaltaPicker_' + formKey);
  if (el) el.outerHTML = ribaltaPickerHTML(formKey);
  else {
    // Cerca il contenitore e ri-renderizza
    const container = document.querySelector(`[data-picker-key="${formKey}"]`);
    if (container) container.innerHTML = ribaltaPickerHTML(formKey);
  }
};

window.scegliRibalta = function(formKey, dest) {
  // Evidenzia tasto selezionato
  document.querySelectorAll(`[id^="ribBtn_${formKey}_"]`).forEach(b => {
    const isSelected = b.id === `ribBtn_${formKey}_${dest}`;
    b.style.background = isSelected ? 'var(--accent)' : 'var(--surface2)';
    b.style.color      = isSelected ? '#1C1F26'       : 'var(--accent)';
    b.style.border     = isSelected ? '2px solid var(--accent)' : '1.5px solid var(--border)';
  });
  // Imposta valore nell'input nascosto del form
  // formKey può essere 'completa_<prenId>' o 'cassa_<spotId>'
  const rawKey = formKey.replace(/^(completa_|cassa_)/, '');
  const inputEl = document.getElementById('cfInput_' + rawKey) ||
                  document.getElementById('cfInput_cassa_' + rawKey);
  if (inputEl) inputEl.value = dest;
};

// ── BOX SUGGERIMENTI portineria ───────────────────────────────────────────────
export function updateRibalteBox(freeSpots) {
  const el = document.getElementById('sugList');
  if (!el) return;
  el.innerHTML = freeSpots.length
    ? freeSpots.map(s =>
        `<div class="sugItem">
          <span>${_esc(s.id)}</span>
          <span style="color:var(--accent2);font-weight:700;font-size:12px">LIBERO</span>
        </div>`).join('')
    : '<div class="emptyState">Nessun posto libero</div>';
}

export function isDestinazioneValida(dest) {
  return _getDestinazioni().includes((dest || '').toUpperCase());
}

// ── API condivisa (usata da prenotazioni-operativo.js via window) ─────────────
window.RibalteOp = {
  pickerRibaltaHTML, resetPicker, statoRibaltaDestinazione, ribalteDisponibili,
  getRibalteData, getPrenotazioniAperte, repartoDiRibalta,
};
