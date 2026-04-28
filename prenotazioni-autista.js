// ── prenotazioni-autista.js ───────────────────────────────────────────────────
// Gestione prenotazioni casse/container + missioni ribalta per autista (mobile)
// Dipende da: firebase-config.js, shared-utils.js

import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc, addDoc, getDocs, serverTimestamp, where }
  from './firebase-config.js';
import { showToast, _esc, fmtDur } from './shared-utils.js';
import { getRibalteLibere, ribaltaPickerHTML } from './ribalte-operativo.js';

let _unsubPren   = null;
let _unsubSpots  = null;
let _prenotazioni = [];
let _spots        = {};  // cache posti per vista casse
let _getUser;
let _getMode;
let _getSpots;

// Tiene traccia di quale card ha il form di completamento aperto
let _openCompletaId = null;

const RE_CASSA = /^\d{3}$/;

export function initPrenotazioni(opts) {
  const { getUser, getMode } = opts;
  _getUser  = getUser;
  _getMode  = getMode || (() => 'container');
  _getSpots = opts.getSpots || (() => ({}));

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
  const ordinarie = lista.filter(p => p.tipoMissione !== 'ribalta');

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

    // Tasto Completa con picker ribalte diviso PNT1/PNT2
    const spotKey = s.id;
    const pickerCassa = ribaltaPickerHTML('cassa_' + spotKey);
    const btnCassaHTML = `
      <button class="btnCompleta" onclick="aprirCompletaCassa('${spotKey}')" style="margin-top:10px;width:100%">✅ Completa missione</button>
      <div id="completaForm_cassa_${spotKey}" style="display:none;margin-top:10px">
        <div class="cfTitle">Ribalta in cui hai posizionato la cassa:</div>
        <input class="cfInput" id="cfInput_cassa_${spotKey}" type="text"
               placeholder="Seleziona dal picker o digita"
               oninput="this.value=this.value.toUpperCase()"
               readonly style="margin-bottom:10px">
        <div data-picker-key="cassa_${spotKey}">${pickerCassa}</div>
        <div class="cfActions" style="margin-top:10px">
          <button class="btnCfConfirm" onclick="confermaCassa('${spotKey}')">✓ Conferma</button>
          <button class="btnCfCancel"  onclick="chiudiCompletaCassa('${spotKey}')">Annulla</button>
        </div>
      </div>`;

    html += `
      <div class="prenCard${urgente ? ' urgente' : ''}">
        <div class="prenHeader">
          <span class="prenPlate">${_esc(s.plate)}</span>
          ${urgente ? '<span class="urgBadge">🚨 URGENTE</span>' : '<span class="prenBadge creata">📦 Piena</span>'}
        </div>
        <div style="font-size:22px;font-weight:800;color:var(--text);margin:8px 0 4px;letter-spacing:1px">${_esc(s.id)}</div>
        ${btnCassaHTML}
      </div>`;
  });

  el.innerHTML = html;

  // Ripristina form aperto se ancora presente
  if (_openCompletaId) {
    const form = document.getElementById('completaForm_' + _openCompletaId);
    if (form) form.style.display = 'block';
  }
}

// ── CARD MISSIONE RIBALTA ────────────────────────────────────────────────────
function _missioneCard(p) {
  const d = _parseDate(p.dataOra);
  const dataStr = d ? d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const statoVeicolo = p.fullAllaLibera ? '🟡 Piena' : '🟢 Vuota';
  const pickerPosti = _postiPickerHTML('miss_' + p.id);

  return `
    <div class="missioneCard">
      <div class="missioneTitle">🚛 Sposta veicolo da ribalta ${_esc(p.spotId || '—')}</div>
      <div class="missioneBody">
        <strong>${_esc(p.plate || '—')}</strong> · ${statoVeicolo} · ${dataStr}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${_esc(p.note || '')}</div>
      <button class="btnCompleta" onclick="aprirCompletaMissione('${p.id}')" style="margin-top:10px;width:100%">
        ✅ Completa missione
      </button>
      <div id="completaForm_${p.id}" style="display:none;margin-top:10px">
        <div class="cfTitle">Parcheggio in cui hai posizionato il veicolo:</div>
        <input class="cfInput" id="cfInput_${p.id}" type="text"
               placeholder="Seleziona dal picker sotto"
               readonly style="margin-bottom:10px">
        <div data-picker-key="miss_${p.id}">${pickerPosti}</div>
        <button onclick="confermaMissione('${p.id}')"
                style="width:100%;margin-top:10px;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
          ✓ Conferma spostamento
        </button>
        <button onclick="chiudiCompletaForm('${p.id}')"
                style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">
          Annulla
        </button>
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
    const destConf  = p.destinazione && p.destinazione !== '—' ? _esc(p.destinazione) : null;
    const pickerConf = ribaltaPickerHTML('completa_' + p.id);
    // Input nascosto pre-impostato con la ribalta prenotata
    const presetVal  = destConf || '';
    btnHTML = `
      <button class="btnCompleta" onclick="aprirCompletaForm('${p.id}')" style="margin-top:8px">
        ✅ Completa
      </button>
      <div id="completaForm_${p.id}" style="display:none;margin-top:10px">
        <input class="cfInput" id="cfInput_${p.id}" type="text"
               value="${presetVal}"
               placeholder="Ribalta destinazione"
               oninput="this.value=this.value.toUpperCase()"
               readonly style="margin-bottom:10px">
        ${destConf ? `
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button onclick="confermaCompletamento('${p.id}')"
                  style="flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
            ✓ Conferma ribalta ${destConf}
          </button>
          <button onclick="aprirModificaRibalta('${p.id}')"
                  style="padding:11px 14px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:13px;cursor:pointer">
            ✏️ Modifica
          </button>
        </div>
        <div id="pickerMod_${p.id}" style="display:none">
          <div data-picker-key="completa_${p.id}">${pickerConf}</div>
          <button onclick="confermaCompletamento('${p.id}')"
                  style="width:100%;margin-top:8px;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
            ✓ Conferma ribalta selezionata
          </button>
        </div>` : `
        <div data-picker-key="completa_${p.id}">${pickerConf}</div>
        <button onclick="confermaCompletamento('${p.id}')"
                style="width:100%;margin-top:8px;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
          ✓ Conferma ribalta selezionata
        </button>`}
        <button onclick="chiudiCompletaForm('${p.id}')"
                style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">
          Annulla
        </button>
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
      <div style="display:flex;align-items:center;gap:10px;margin:10px 0 4px;flex-wrap:wrap">
        <span style="font-size:22px;font-weight:800;color:var(--text);letter-spacing:1px">${_esc(p.spotId || '—')}</span>
        <span style="font-size:22px;color:var(--accent2)">→</span>
        <span style="font-size:22px;font-weight:800;color:var(--accent);letter-spacing:1px">${_esc(p.destinazione || '—')}</span>
      </div>
      <div class="prenMeta" style="margin-top:2px">${dataStr}</div>
      ${bloccatoNote}
      ${btnHTML}
    </div>`;
}

// ── LOGICA FORM COMPLETAMENTO ─────────────────────────────────────────────────
window.aprirCompletaCassa = function(spotId) {
  // Chiudi eventuali form già aperti
  if (_openCompletaId) chiudiCompletaForm(_openCompletaId);
  _openCompletaId = 'cassa_' + spotId;
  const form = document.getElementById('completaForm_cassa_' + spotId);
  if (form) {
    form.style.display = 'block';
    setTimeout(() => document.getElementById('cfInput_cassa_' + spotId)?.focus(), 80);
  }
};

window.chiudiCompletaCassa = function(spotId) {
  const form = document.getElementById('completaForm_cassa_' + spotId);
  if (form) form.style.display = 'none';
  if (_openCompletaId === 'cassa_' + spotId) _openCompletaId = null;
};

window.confermaCassa = async function(spotId) {
  const input = document.getElementById('cfInput_cassa_' + spotId);
  const dest  = input?.value.trim().toUpperCase();
  if (!dest) { showToast('Seleziona una ribalta', 'error'); return; }
  try {
    const user  = _getUser ? _getUser() : null;
    const spot  = _getSpots ? _getSpots()[spotId] : null;
    const plate = spot?.plate || spotId;

    // 1. Libera posto parcheggio
    await setDoc(doc(db, 'spots', spotId), {
      occupied: false, plate: null, since: null, user: null, full: false, damaged: false
    });

    // 2. Occupa ribalta
    await setDoc(doc(db, 'ribalte', dest), {
      occupied: true,
      plate,
      since:    serverTimestamp(),
      user:     user?.email || '—',
      full:     false
    });

    _openCompletaId = null;
    showToast(`Cassa ${plate} → ${dest} · Posto ${spotId} liberato`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

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

// ── PICKER POSTI PARCHEGGIO LIBERI ───────────────────────────────────────────
// Usato nella card missione ribalta: l'autista sceglie dove parcheggiare
function _postiPickerHTML(formKey) {
  const spots   = _getSpots ? _getSpots() : {};
  const liberi  = Object.values(spots).filter(s => !s.occupied);

  // Raggruppa per zona
  const zone = {};
  liberi.forEach(s => {
    const z = s.zone || 'Altro';
    if (!zone[z]) zone[z] = [];
    zone[z].push(s.id);
  });

  if (!liberi.length) {
    return `<div style="color:var(--muted);font-size:13px;padding:8px">Nessun posto libero disponibile</div>`;
  }

  let html = '';
  for (const [zona, ids] of Object.entries(zone)) {
    html += `<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:8px 0 4px">${zona}</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
    html += ids.map(id => `
      <button id="postoBtn_${formKey}_${id}"
              onclick="scegliPosto('${formKey}','${id}')"
              style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);
                     background:var(--surface2);color:var(--accent);font-family:inherit;
                     font-size:14px;font-weight:700;cursor:pointer;margin:2px">
        ${id}
      </button>`).join('');
    html += `</div>`;
  }

  return `<div id="postiPicker_${formKey}">${html}</div>`;
}

window.scegliPosto = function(formKey, postoId) {
  // Evidenzia tasto selezionato e deseleziona gli altri
  document.querySelectorAll(`[id^="postoBtn_${formKey}_"]`).forEach(b => {
    const sel = b.id === `postoBtn_${formKey}_${postoId}`;
    b.style.background = sel ? 'var(--accent)' : 'var(--surface2)';
    b.style.color      = sel ? '#1C1F26'       : 'var(--accent)';
    b.style.border     = sel ? '2px solid var(--accent)' : '1.5px solid var(--border)';
    b.style.fontWeight = sel ? '700'            : '700';
  });
  // Imposta valore nell'input del form
  const rawKey = formKey.replace(/^miss_/, '');
  const inputEl = document.getElementById('cfInput_' + rawKey);
  if (inputEl) inputEl.value = postoId;
};

window.aprirModificaRibalta = function(id) {
  const pickerMod = document.getElementById('pickerMod_' + id);
  if (pickerMod) pickerMod.style.display = pickerMod.style.display === 'none' ? 'block' : 'none';
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
    const pren  = _prenotazioni.find(p => p.id === id);
    const user  = _getUser ? _getUser() : null;
    const plate = pren?.plate || '—';
    const isMissioneRibalta = pren?.tipoMissione === 'ribalta';

    // Aggiorna prenotazione come completata
    await updateDoc(doc(db, 'prenotazioni', id), {
      stato:        'completata',
      completataAt: serverTimestamp(),
      postoFine
    });

    if (isMissioneRibalta) {
      // MISSIONE RIBALTA → PARCHEGGIO:
      // 1. Libera la ribalta di origine (spotId è un PNT)
      if (pren?.spotId) {
        await setDoc(doc(db, 'ribalte', pren.spotId), {
          occupied: false, plate: null, since: null, user: null, full: false
        });
      }
      // 2. Occupa il posto parcheggio di destinazione
      if (postoFine && postoFine !== '—') {
        await setDoc(doc(db, 'spots', postoFine), {
          occupied: true,
          plate,
          since:    serverTimestamp(),
          user:     user?.email || '—',
          full:     pren?.fullAllaLibera || false,
          damaged:  false
        });
      }
      showToast(`Missione completata · ${pren?.spotId} liberata · ${postoFine} occupato`, 'success');
    } else {
      // MISSIONE CONTAINER → RIBALTA:
      // 1. Libera posto parcheggio di origine
      if (pren?.spotId) {
        await setDoc(doc(db, 'spots', pren.spotId), {
          occupied: false, plate: null, since: null, user: null, full: false, damaged: false
        });
      }
      // 2. Occupa ribalta di destinazione
      if (postoFine && postoFine !== '—') {
        await setDoc(doc(db, 'ribalte', postoFine), {
          occupied: true,
          plate,
          since:    serverTimestamp(),
          user:     user?.email || '—',
          full:     false
        });
      }
      showToast(`Completato · ${postoFine} occupata · Posto ${pren?.spotId} liberato`, 'success');
    }

    _openCompletaId = null;
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
