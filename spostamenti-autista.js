// ── spostamenti-autista.js ────────────────────────────────────────────────────
// Spostamento manuale di un veicolo da un parcheggio a un altro (ruolo autista).
// Flusso: elenco parcheggi occupati → «Sposta» → scelta zona → scelta posto libero
//         → conferma → scrittura.
//
// Non tocca mai `prenotazioni` né `ribalte`: è un movimento interno al piazzale,
// senza missione associata.
//
// L'anzianità (`since`) NON viene azzerata: il veicolo mantiene la data di
// ingresso, altrimenti uno spostamento logistico lo farebbe "ringiovanire" e
// scivolare in fondo alle code FIFO di casse e container.
//
// Dipende da: firebase-config.js (window.db), shared-utils.js, spots-data-mobile.js

import { _esc, fmtDur, showToast } from './shared-utils.js';
import * as _SU from './shared-utils.js';
// RE_CONTAINER letto dal namespace: se il browser servisse per qualche minuto una
// copia in cache di shared-utils.js senza il nuovo export, il modulo non si rompe.
const RE_CASSA     = /^\d{3}$/;
const RE_CONTAINER = _SU.RE_CONTAINER || /^(?:[A-Z]{4}\d{7}|[A-Z]{2}\d{3}(?:[A-Z]{2}|\d{1,3}))$/;

let _getSpots = () => ({});
let _getUser  = () => null;

// Stato UI: quale posto si sta spostando e a che punto è la scelta
let _sel = null; // { from, zona, to } | null

export function initSpostamenti({ getSpots, getUser }) {
  _getSpots = getSpots || _getSpots;
  _getUser  = getUser  || _getUser;
  render();
}

// ── CRITERI PARCHEGGI ─────────────────────────────────────────────────────────
// Tipo ammesso e stato pieno/vuoto dalla tabella unica (parcheggi-data.js).
const _PC = () => window.ParcheggiCore;
function _spotCriterio(id) { return _PC().criterio(id); }

function _tipoDaPlate(plate) {
  const k = (plate || '').trim().toUpperCase();
  if (RE_CASSA.test(k)) return 'cassa';
  if (RE_CONTAINER.test(k)) return 'container';
  return null;
}

// Il posto di destinazione è "compatibile" se rispetta il criterio del veicolo
// (stesso tipo e stesso stato pieno/vuoto). Gli altri restano selezionabili
// tramite «Mostra tutti», ma sono segnalati.
function _compatibile(spotId, veicolo) {
  const c = _spotCriterio(spotId);
  if (!c) return false;
  const tipo = _tipoDaPlate(veicolo.plate) || 'container';
  if (!c.ammessi.includes(tipo)) return false;
  return c.stato === (veicolo.full ? 'pieno' : 'vuoto');
}

// Posti che possono ricevere ORA questo veicolo (tipo ammesso + spazio libero),
// escluso il posto dove si trova già. Senza veicolo: posti con spazio libero.
function _liberi(veicolo) {
  const tipo = veicolo ? (_tipoDaPlate(veicolo.plate) || 'container') : null;
  return Object.values(_getSpots()).filter(s => {
    if (veicolo && s.id === veicolo.id) return false;
    if (tipo) return _PC().disponibilePer(s, tipo);
    return s.attivo && !s.inutilizzabile && s.statoOcc !== 'pieno';
  });
}

function _zonaDi(s) {
  return s.zone || s.zona || '—';
}

// ── RENDER ────────────────────────────────────────────────────────────────────
export function render() {
  const el = document.getElementById('spostList');
  if (!el) return;

  const spots = _getSpots();
  // Un elemento per mezzo (id = posto): su un posto possono esserci più mezzi
  const occupati = _PC().mezzi(spots)
    .filter(s => s.plate)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }) || String(a.plate).localeCompare(String(b.plate)));

  const statsEl = document.getElementById('spostStats');
  if (statsEl) {
    const lib = _liberi().length;
    statsEl.innerHTML = `
      <div class="statCard red"><div class="val">${occupati.length}</div><div class="lbl">Occupati</div></div>
      <div class="statCard green"><div class="val">${lib}</div><div class="lbl">Liberi</div></div>`;
  }

  if (!occupati.length) {
    el.innerHTML = '<div class="emptyState">Nessun parcheggio occupato.</div>';
    return;
  }

  // Filtro testo (targa o posto)
  const q = (document.getElementById('spostSearch')?.value || '').trim().toUpperCase();
  const lista = q
    ? occupati.filter(s => s.id.includes(q) || String(s.plate).toUpperCase().includes(q))
    : occupati;

  if (!lista.length) {
    el.innerHTML = '<div class="emptyState">Nessun risultato per "' + _esc(q) + '".</div>';
    return;
  }

  el.innerHTML = lista.map(s => _cardPosto(s)).join('');
}

function _cardPosto(s) {
  const aperto = _sel && _sel.from === s.id && _sel.plate === s.plate;
  const tipo = _tipoDaPlate(s.plate);
  const badgeTipo = tipo === 'cassa' ? '📦 Cassa' : (tipo === 'container' ? '🚢 Container' : '—');
  const badgePieno = s.full ? '🟡 Pieno' : '🟢 Vuoto';
  const extra = (s.damaged ? ' · ⚠️ Danno' : '') + (s.unusable ? ' · 🚫 Inutilizzabile' : '');

  return `
<div class="prenCard" style="margin-bottom:10px${aperto ? ';border:1.5px solid var(--accent)' : ''}">
  <div class="prenHeader">
    <span style="font-size:18px;font-weight:800;letter-spacing:1px">${_esc(s.id)}</span>
    <span class="prenBadge creata">${_esc(_zonaDi(s))}</span>
  </div>
  <div style="font-size:18px;font-weight:700;margin:6px 0 2px">${_esc(s.plate)}</div>
  <div style="font-size:12px;color:var(--muted)">${badgeTipo} · ${badgePieno}${extra}${s.since ? ' · ⏱ ' + fmtDur(s.since) : ''}</div>
  ${aperto
    ? `<div style="margin-top:10px">${_pannelloScelta(s)}</div>`
    : `<button onclick="spostApri('${_esc(s.id)}','${_esc(s.plate)}')"
         style="width:100%;margin-top:10px;padding:11px;border-radius:8px;border:none;
                background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;
                font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
         🔀 Sposta in altro parcheggio
       </button>`}
</div>`;
}

const _BTN = {
  zona:    'padding:9px 16px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;margin:3px',
  zonaSel: 'padding:9px 16px;border-radius:8px;border:2px solid var(--accent);background:var(--accent);color:#1C1F26;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;margin:3px',
  posto:   'display:inline-block;margin:3px;padding:8px 14px;border-radius:8px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer',
  postoAlt:'display:inline-block;margin:3px;padding:8px 14px;border-radius:8px;border:1.5px dashed var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer',
  annulla: 'width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer',
  label:   'font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 5px',
};

function _pannelloScelta(s) {
  // Fase 3 — conferma finale
  if (_sel.to) {
    const dest = _sel.to;
    const comp = _compatibile(dest, s);
    return `
<div style="padding:12px;border-radius:10px;border:2px solid var(--accent2,orange);background:var(--surface2)">
  <div style="font-size:14px;font-weight:800;margin-bottom:6px">⚠️ Confermi lo spostamento?</div>
  <div style="font-size:14px;line-height:1.5;margin-bottom:4px">
    <strong>${_esc(s.plate)}</strong><br>
    <span style="font-size:16px;font-weight:800">${_esc(s.id)} → ${_esc(dest)}</span>
  </div>
  ${comp ? '' : `<div style="font-size:12px;color:var(--accent2,orange);margin-bottom:8px">⚠️ ${_esc(dest)} non è un posto previsto per questo veicolo (${_esc(_descCriterio(dest))}).</div>`}
  <div style="font-size:11px;color:var(--muted);margin-bottom:12px">La data di ingresso del veicolo resta invariata.</div>
  <div style="display:flex;gap:8px">
    <button onclick="spostIndietro()"
            style="flex:1;padding:11px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">
      ✕ No
    </button>
    <button id="spostBtnSi" onclick="spostConferma()"
            style="flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1C1F26;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer">
      ✓ Sì, sposta
    </button>
  </div>
</div>`;
  }

  const liberi = _liberi(s);
  const mostraTutti = !!_sel.tutti;

  // Fase 2 — scelta posto nella zona
  if (_sel.zona) {
    const inZona = liberi.filter(x => _zonaDi(x) === _sel.zona);
    const comp   = inZona.filter(x => _compatibile(x.id, s));
    const altri  = inZona.filter(x => !_compatibile(x.id, s));
    const mostrati = mostraTutti ? inZona : comp;

    let h = `<button onclick="spostZona('')" style="${_BTN.zona}">← Cambia zona</button>`;
    h += `<div style="${_BTN.label}">${_esc(_sel.zona)} — posti liberi${mostraTutti ? '' : ' compatibili'}:</div>`;
    if (!mostrati.length) {
      h += `<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">Nessun posto libero${mostraTutti ? '' : ' compatibile'} in questa zona</div>`;
    } else {
      h += '<div style="display:flex;flex-wrap:wrap">';
      mostrati.sort((a, b) => a.id.localeCompare(b.id)).forEach(x => {
        const ok = _compatibile(x.id, s);
        h += `<button style="${ok ? _BTN.posto : _BTN.postoAlt}"
                onclick="spostScegli('${_esc(x.id)}')"
                title="${_esc(_descCriterio(x.id))}">${_esc(x.id)}${x.statoOcc === 'parziale' ? ' ◐' : ''}${ok ? '' : ' ⚠️'}</button>`;
      });
      h += '</div>';
    }
    if (!mostraTutti && altri.length) {
      h += `<div style="margin-top:8px"><button style="${_BTN.zona}" onclick="spostMostraTutti()">🔀 Mostra tutti i liberi (${altri.length} non compatibili)</button></div>`;
    }
    h += `<button onclick="spostChiudi()" style="${_BTN.annulla}">Annulla</button>`;
    return h;
  }

  // Fase 1 — scelta zona
  const zone = [...new Set(liberi.map(_zonaDi))].sort();
  let h = `<div style="${_BTN.label}">Seleziona la zona di destinazione:</div>`;
  if (!zone.length) {
    h += '<div style="font-size:12px;color:var(--muted)">Nessun posto libero disponibile</div>';
  } else {
    h += '<div style="display:flex;flex-wrap:wrap">';
    zone.forEach(z => {
      const tot  = liberi.filter(x => _zonaDi(x) === z).length;
      const comp = liberi.filter(x => _zonaDi(x) === z && _compatibile(x.id, s)).length;
      h += `<button style="${_BTN.zona}" onclick="spostZona('${_esc(z)}')">
              ${_esc(z)} <span style="opacity:.7;font-weight:600">· ${comp}/${tot}</span>
            </button>`;
    });
    h += '</div>';
    h += `<div style="font-size:11px;color:var(--muted);margin-top:4px">Compatibili / totali liberi per zona</div>`;
  }
  h += `<button onclick="spostChiudi()" style="${_BTN.annulla}">Annulla</button>`;
  return h;
}

function _descCriterio(id) {
  const c = _spotCriterio(id);
  if (!c) return 'posto';
  return `${c.ammessi.map(t => t === 'cassa' ? 'casse' : 'container').join('/')} ${c.stato === 'pieno' ? 'pieni' : 'vuoti'}`;
}

// ── AZIONI UI ─────────────────────────────────────────────────────────────────
window.spostApri = function(id, plate) {
  _sel = { from: id, plate: plate || null, zona: null, to: null, tutti: false };
  render();
};

window.spostChiudi = function() { _sel = null; render(); };

window.spostZona = function(z) {
  if (!_sel) return;
  _sel.zona = z || null;
  _sel.to = null;
  _sel.tutti = false;
  render();
};

window.spostMostraTutti = function() {
  if (!_sel) return;
  _sel.tutti = true;
  render();
};

window.spostScegli = function(dest) {
  if (!_sel) return;
  _sel.to = dest;
  render();
};

window.spostIndietro = function() {
  if (!_sel) return;
  _sel.to = null;
  render();
};

window.spostFiltra = function() { render(); };

let _inCorso = false;

window.spostConferma = async function() {
  if (!_sel || !_sel.to || _inCorso) return;
  const spots = _getSpots();
  const from = _sel.from, to = _sel.to;
  const v = spots[from];
  const s = v && (v.occupanti || []).find(o => !_sel.plate || o.plate === _sel.plate);

  if (!s || !s.plate) { showToast('Il veicolo non è più sul posto di partenza', 'error'); _sel = null; render(); return; }

  _inCorso = true;
  const btn = document.getElementById('spostBtnSi');
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }

  try {
    // Una sola transazione: il veicolo porta con sé stato, anzianità ed
    // eventuali flag; se la destinazione si è riempita nel frattempo, nulla cambia.
    await _PC().sposta(from, to, s.plate, { patch: { bloccoPlate: null } });

    await window.logHistory({
      spot: to,
      action: 'Spostamento parcheggio',
      plate: s.plate,
      tipo: _tipoDaPlate(s.plate) || null,
      origine: from,
      destinazione: to,
    });

    showToast(`✅ ${s.plate}: ${from} → ${to}`, 'success');
    _sel = null;
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Sì, sposta'; }
  } finally {
    _inCorso = false;
    render();
  }
};
