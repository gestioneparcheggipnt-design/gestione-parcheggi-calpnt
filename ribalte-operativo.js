import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
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
let _unsubRibalte = null;
let _ribalteData  = {};  // { [id]: { occupied, plate, since, user } }

// Gruppo selezionato nei picker (per ogni formKey)
const _gruppoPickerForm = {};

// ── INIT ───────────────────────────────────────────────────────────────────────
export function initRibalteOperativo({ getUser }) {
  _getUser = getUser;
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
}

export function stopRibalte() {
  if (_unsubRibalte) { _unsubRibalte(); _unsubRibalte = null; }
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
  const el = document.getElementById('ribaltaList');
  if (!el) return;

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
  let ribalte = Object.values(_ribalteData);
  if (isOperativo) {
    ribalte = ribalte.filter(r =>
      r.occupied && consentite.has(String(r.id).trim().toUpperCase())
    );
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
  let navette = navetteAll.filter(n => n.attiva && (n.stato === 'vuoto' || n.stato === 'pieno'));
  if (isOperativo) {
    navette = navette.filter(n => n.posizione && consentite.has(String(n.posizione).trim().toUpperCase()));
  }
  navette.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  if (!ribalte.length && !navette.length) {
    el.innerHTML = isOperativo
      ? (repKey
          ? '<div class="emptyState">Nessuna ribalta occupata nel tuo reparto.</div>'
          : '<div class="emptyState">Nessun reparto associato al tuo utente.<br><small>Contatta un amministratore.</small></div>')
      : '<div class="emptyState">Nessuna ribalta trovata.<br><small>Inizializza la collection "ribalte" su Firestore.</small></div>';
    return;
  }

  const navHtml = navette.length
    ? `<div class="prenGroupTitle" style="margin:2px 0 8px">🚚 NAVETTE (${navette.length})</div>`
      + navette.map(n => _navettaCardOperativo(n, user)).join('')
    : '';
  el.innerHTML = navHtml + ribalte.map(r => _ribaltaCard(r, user)).join('');
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

    if (canManage) {
      body += `
        <button class="btnRed" style="width:100%;margin-top:10px;padding:11px;font-size:14px"
                onclick="toggleLiberaForm('${r.id}')">
          🚛 Libera ribalta
        </button>
        <div id="liberaForm_${r.id}" style="display:none;margin-top:10px">
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
          <button onclick="confermaLibera('${r.id}')"
                  style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
            ✓ Conferma liberazione
          </button>
          <button onclick="toggleLiberaForm('${r.id}')"
                  style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">
            Annulla
          </button>
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

// ── FORM LIBERA RIBALTA ───────────────────────────────────────────────────────
const _liberaStato = {};

window.toggleLiberaForm = function(id) {
  const form = document.getElementById('liberaForm_' + id);
  if (!form) return;
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) { _liberaStato[id] = 'vuota'; _aggiornaToggle(id); }
};

window.setLiberaStato = function(id, stato) {
  _liberaStato[id] = stato;
  _aggiornaToggle(id);
};

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
  try {
    await setDoc(doc(window.db, 'ribalte', id), {
      occupied: false, plate: null, since: null, user: null, full: false
    });
    await addDoc(collection(window.db, 'prenotazioni'), {
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
      note:           `Ribalta ${id} liberata — veicolo ${full ? 'PIENO' : 'VUOTO'}`
    });
    await window.logHistory({ spot: id, action: 'Ribalta richiesta', plate });
    showToast(`Ribalta ${id} liberata — missione creata`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

// ── CARD NAVETTA (operativo) ──────────────────────────────────────────────────
// Pieno  → "Dichiara scaricata" (pieno→vuoto, abbina la coda via NavetteCore)
// Vuoto  → "Carica e spedisci"  (crea missione pieno verso una ribalta)
function _navettaCardOperativo(n, user) {
  const isPieno = n.stato === 'pieno';
  const badge = isPieno ? '🟡 Pieno' : '🟢 Vuoto';
  let body = `<div style="font-size:12px;color:var(--muted);margin-top:4px">Posizione: <strong>${_esc(n.posizione || '—')}</strong></div>`;

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
