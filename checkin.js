import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── checkin.js ────────────────────────────────────────────────────────────────
// Check-in rapido + lista posti per la vista Mobile
// Dipende da: firebase-config.js, shared-utils.js, stato globale (spots, currentUser, currentMode)

import { fmtDate, fmtDur, showToast, validatePlate } from './shared-utils.js';
import * as _SU from './shared-utils.js';
// RE_CONTAINER letto dal namespace: se il browser servisse per qualche minuto una
// copia in cache di shared-utils.js senza il nuovo export, il modulo non si rompe.
const RE_CONTAINER = _SU.RE_CONTAINER || /^(?:[A-Z]{4}\d{7}|[A-Z]{2}\d{3}(?:[A-Z]{2}|\d{1,3}))$/;

// Riferimento allo stato condiviso (definito in mobile.html e passato a questo modulo)
// Usato tramite getters per evitare problemi di riferimento circolare
let _getSpots, _getUser, _getMode;

// Tutte le scritture sui posti passano da ParcheggiCore (transazioni, sotto-posti)
const _PC = () => window.ParcheggiCore;
const _tipoMode = () => (_getMode() === 'cassa' ? 'cassa' : 'container');
const _q = v => "'" + String(v ?? '').replace(/[\\'"<>&]/g, '') + "'";
const _e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Posti che possono ricevere ORA un mezzo del tipo indicato.
// Casse: prima i posti già parziali (i posti interi restano per i container).
function _postiDisponibili(spots, tipo) {
  const ids = Object.values(spots)
    .filter(s => _PC().disponibilePer(s, tipo))
    .map(s => s.id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (tipo !== 'cassa') return ids;
  const parz = ids.filter(id => spots[id].statoOcc === 'parziale');
  return parz.concat(ids.filter(id => spots[id].statoOcc !== 'parziale'));
}

function _badgePosto(s) {
  if (s.inutilizzabile) return { cls: 'unusable', txt: 'Inutilizzabile' };
  if (s.statoOcc === 'pieno') return { cls: 'occ', txt: 'Occupato' };
  if (s.statoOcc === 'parziale') return { cls: 'occ', txt: `Parziale ${s.sotto - s.slotLiberi.length}/${s.sotto}` };
  return { cls: 'free', txt: 'Libero' };
}

export function initCheckin({ getSpots, getUser, getMode }) {
  _getSpots = getSpots;
  _getUser  = getUser;
  _getMode  = getMode;
}

// ── UI CHECK-IN ───────────────────────────────────────────────────────────────
export function updateCheckinUI() {
  const spots = _getSpots();
  const all   = Object.values(spots);
  const lib   = all.filter(s => s.statoOcc === 'libero').length;
  const parz  = all.filter(s => s.statoOcc === 'parziale').length;
  const occ   = all.length - lib;
  const sottoTot = all.reduce((n, s) => n + (s.sotto || 1), 0);
  const sottoOcc = all.reduce((n, s) => n + ((s.sotto || 1) - (s.slotLiberi || []).length), 0);
  const disp  = _postiDisponibili(spots, _tipoMode());
  const mode  = _getMode() === 'cassa' ? 'Cassa' : 'Container';
  const user  = _getUser();

  document.getElementById('checkinSubtitle').textContent =
    `Modalità: ${mode} | ${disp.length} posti disponibili`;
  document.getElementById('checkinCardTitle').textContent =
    `Nuovo Check-in ${mode}`;

  const lbl = document.getElementById('checkinPlaceholderLabel');
  lbl.textContent = _getMode() === 'cassa' ? 'N. Cassa' : 'Targa';
  document.getElementById('checkinInput').placeholder =
    _getMode() === 'cassa' ? 'CAX-001' : 'AB123CD';

  document.getElementById('checkinStats').innerHTML = `
    <div class="statCard blue"><div class="val">${all.length}</div><div class="lbl">Totali</div></div>
    <div class="statCard green"><div class="val">${lib}</div><div class="lbl">Liberi</div></div>
    <div class="statCard red"><div class="val">${occ}</div><div class="lbl">${parz ? 'Occupati · ' + parz + ' parz.' : 'Occupati'}</div></div>
    <div class="statCard orange"><div class="val">${sottoTot ? Math.round(sottoOcc / sottoTot * 100) : 0}%</div><div class="lbl">Occupazione</div></div>`;

  // portineria: mostra suggerimenti (primi 5 posti disponibili per la modalità)
  if (user?.role === 'portineria') {
    const sug = disp.slice(0, 5).map(id => spots[id]);
    document.getElementById('sugList').innerHTML = sug.length
      ? sug.map(s =>
          `<div class="sugItem"><span>${s.id}</span><span style="color:var(--accent2);font-weight:700;font-size:12px">${s.statoOcc === 'parziale' ? 'PARZIALE' : 'LIBERO'}</span></div>`
        ).join('')
      : '<div class="emptyState">Nessun posto libero</div>';
  }
}

export async function doCheckinRapido() {
  const input  = document.getElementById('checkinInput');
  const raw    = input.value.trim();
  const res    = document.getElementById('checkinResult');
  const spots  = _getSpots();
  const user   = _getUser();
  const mode   = _getMode();

  // Validazione formato
  const plateCheck = validatePlate(raw, mode);
  if (!plateCheck.ok) {
    showResult(res, '⚠️ ' + plateCheck.msg, 'warn');
    return;
  }
  const plate = plateCheck.plate;

  // Verifica che il veicolo non sia già parcheggiato
  const gia = _PC().trovaMezzo(spots, plate);
  if (gia) {
    showResult(res, `⚠️ Veicolo ${plate} già presente nel posto ${gia.posto}.`, 'warn');
    return;
  }

  const candidati = _postiDisponibili(spots, _tipoMode());
  if (!candidati.length) {
    showResult(res, '⚠️ Nessun posto libero disponibile', 'warn');
    return;
  }

  // Prova i candidati in ordine: se un posto si riempie nel frattempo
  // la transazione lo rifiuta e si passa al successivo.
  let ultimoErr = null;
  for (const id of candidati.slice(0, 5)) {
    try {
      await _PC().assegna(id, { plate, tipo: _tipoMode(), user: user.email, damaged: false, full: false });
      await window.logHistory({ spot: id, action: 'Assegnato', plate, mode, full: false });
      showResult(res, `✅ ${plate} → Posto ${id}`, 'ok');
      input.value = '';
      showToast(`Posto ${id} assegnato a ${plate}`, 'success');
      return;
    } catch (e) {
      ultimoErr = e;
      if (e.code !== 'occupato') break;
    }
  }
  showResult(res, '⚠️ ' + (ultimoErr?.message || 'Errore'), 'warn');
}

function showResult(el, msg, type) {
  el.textContent = msg;
  el.className = 'checkinResult ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── LISTA POSTI ───────────────────────────────────────────────────────────────
export function renderPosti() {
  const spots = _getSpots();
  const mode  = _getMode();
  const tipo  = _tipoMode();
  const q     = (document.getElementById('searchPosto')?.value || '').trim().toUpperCase();
  const fZona = document.getElementById('filterZona')?.value  || '';

  // Il filtro pill ha precedenza sul select stato (non più presente nella ricerca)
  const pill  = (typeof window._getFilterPill === 'function') ? window._getFilterPill() : '';

  const targhe = s => (s.occupanti || []).map(o => o.plate);
  let res = Object.values(spots);
  if (q) res = res.filter(s => s.id.includes(q) || targhe(s).some(p => p && p.includes(q)));

  if (pill === 'libero') {
    // posti che possono ancora ricevere un mezzo della modalità corrente
    res = res.filter(s => _PC().disponibilePer(s, tipo));
  } else if (pill === 'occupato') {
    const isTipo = mode === 'cassa'
      ? (p => /^\d{3}$/.test(String(p).trim()))
      : (p => RE_CONTAINER.test(String(p).trim().toUpperCase()));
    res = res.filter(s => targhe(s).some(isTipo));
  }

  if (fZona) res = res.filter(s => s.zone === fZona);

  document.getElementById('spotList').innerHTML = res.map(s => {
    const b = _badgePosto(s);
    const occ = s.occupanti || [];
    const plates = occ.length ? occ.map(o => _e(o.plate)).join(' · ') : (s.inutilizzabile ? 'Inutilizzabile' : 'Libero');
    const meta = occ.length === 1
      ? `${s.zone}${occ[0].since ? ' · ' + fmtDur(occ[0].since) : ''}${occ[0].damaged ? ' · ⚠️ Danno' : ''}${occ[0].unusable ? ' · 🚫 Inutilizzabile' : ''}${occ[0].full ? ' · 🟡 Pieno' : ''}`
      : `${s.zone}${occ.length > 1 ? ' · ' + occ.length + ' mezzi' : ''}${occ.some(o => o.damaged) ? ' · ⚠️ Danno' : ''}${occ.some(o => o.unusable) ? ' · 🚫 Inutilizzabile' : ''}`;
    const itemCls = s.inutilizzabile || occ.some(o => o.unusable) ? 'unusable' : (occ.length ? 'occupied' : 'free');
    return `
    <div class="spotItem ${itemCls}" onclick="openSpotDrawer('${s.id}')">
      <div class="spotId">${s.id}</div>
      <div class="spotInfo">
        <div class="spotPlate">${plates}</div>
        <div class="spotMeta">${meta}</div>
      </div>
      <span class="spotBadge ${b.cls}">${b.txt}</span>
    </div>`;
  }).join('') || '<div class="emptyState">Nessun posto trovato</div>';
}

// ── DRAWER POSTO ──────────────────────────────────────────────────────────────
// Scheda di un mezzo parcheggiato nel drawer, con le sue azioni
function _schedaMezzoDrawer(id, o, canManage, canManageDamage) {
  const P = _q(o.plate);
  const tipoLbl = o.tipo === 'cassa' ? 'Cassa' : 'Container';
  let h = `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px">
      <div class="infoRow"><span class="infoKey">${tipoLbl}</span><span class="infoVal">${_e(o.plate)}</span></div>
      <div class="infoRow"><span class="infoKey">Da</span><span class="infoVal">${fmtDate(o.since)}</span></div>
      <div class="infoRow"><span class="infoKey">Durata</span><span class="infoVal">${fmtDur(o.since)}</span></div>
      <div class="infoRow"><span class="infoKey">Utente</span><span class="infoVal" style="font-size:12px">${_e(o.user || '—')}</span></div>
      <div class="infoRow"><span class="infoKey">Stato</span><span class="infoVal">${o.full ? '🟡 Piena/o' : '🟢 Vuota/o'}</span></div>
      ${o.damaged ? '<div class="infoRow"><span class="infoKey">Veicolo</span><span class="infoVal" style="color:var(--red)">⚠️ Danno segnalato</span></div>' : ''}
      ${o.unusable ? '<div class="infoRow"><span class="infoKey">Veicolo</span><span class="infoVal" style="color:#7c3aed">🚫 Inutilizzabile</span></div>' : ''}
      <div style="margin-top:12px"></div>
      ${o.full
        ? `<button class="btnGreen" style="margin-bottom:8px" onclick="toggleFullDrawer('${id}',false,${P})">🟢 Segna come Vuota/o</button>`
        : `<button class="btnOrange" style="margin-bottom:8px" onclick="toggleFullDrawer('${id}',true,${P})">🟡 Segna come Piena/o</button>`}`;
  if (canManage) h += `<button class="btnRed" onclick="freeFromDrawer('${id}',${P})">✕ Libera ${_e(o.plate)}</button>`;
  if (canManageDamage) {
    h += `<div style="margin-top:12px">
        ${o.damaged
          ? `<button class="btnOrange" style="margin-bottom:8px" onclick="removeDamagedDrawer('${id}',${P})">✓ Rimuovi segnalazione danno</button>`
          : `<button class="btnOrange" style="margin-bottom:8px" onclick="addDamagedDrawer('${id}',${P})">⚠️ Segna veicolo come danneggiato</button>`}
        ${o.unusable
          ? `<button class="btnGray" onclick="removeUnusableDrawer('${id}',${P})">✓ Rimuovi veicolo inutilizzabile</button>`
          : `<button class="btnUnusable" onclick="addUnusableDrawer('${id}',${P})">🚫 Segna veicolo come inutilizzabile</button>`}
      </div>`;
  }
  return h + '</div>';
}

export function openSpotDrawer(id) {
  const spots   = _getSpots();
  const user    = _getUser();
  const mode    = _getMode();
  const sp      = spots[id];
  if (!sp) return;

  const canManage     = user && (user.role === 'autista' || user.role === 'amministratore' || user.role === 'portineria' || user.role === 'amministrativo');
  const canManageDamage = user && (user.role === 'amministrativo' || user.role === 'amministratore');
  const modeLabel = mode === 'cassa' ? 'Cassa' : 'Container';
  const modeIcon  = mode === 'cassa' ? '📦' : '🚛';
  const occ = sp.occupanti || [];
  const ammessiTxt = sp.ammessi.map(t => t === 'cassa' ? 'casse' : 'container').join(' / ');

  let html = `<div class="drawerTitle">${modeIcon} Posto ${id}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">${sp.zone} · accetta ${ammessiTxt}${sp.sotto > 1 ? ' · ' + sp.sotto + ' sotto-posti' : ''}</div>`;

  // Posto bloccato (temporaneo, dal campo)
  if (sp.inutilizzabile) {
    html += `<div style="background:#7c3aed13;border:1px solid #7c3aed30;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-weight:700;color:#7c3aed">🚫 Posto inutilizzabile</div>`;
    if (canManageDamage) {
      html += `<button class="btnGray" style="margin-bottom:8px" onclick="removeUnusableDrawer('${id}')">✓ Rimuovi stato inutilizzabile</button>`;
    }
    html += `<button class="btnGray" style="margin-top:8px" onclick="closeDrawer()">Chiudi</button>`;
    document.getElementById('drawerContent').innerHTML = html;
    document.getElementById('spotDrawer').classList.add('open');
    document.getElementById('drawerOverlay').classList.add('open');
    return;
  }

  const b = _badgePosto(sp);
  const badgeStyle = b.cls === 'free'
    ? 'background:#A4D20013;border:1px solid #A4D20030;color:var(--accent2)'
    : 'background:#ef444413;border:1px solid #ef444430;color:var(--red)';
  html += `<div style="${badgeStyle};border-radius:10px;padding:10px 14px;margin-bottom:6px;font-weight:700">${b.cls === 'free' ? '🟢' : '🔴'} ${b.txt}</div>`;

  occ.forEach(o => { html += _schedaMezzoDrawer(id, o, canManage, canManageDamage); });

  // Form di assegnazione: solo se il posto può ricevere un mezzo della modalità corrente
  const puoRicevere = _PC().disponibilePer(sp, _tipoMode());
  if (puoRicevere) {
    if (canManage) {
      html += `<div style="${occ.length ? 'border-top:1px solid var(--border);margin-top:12px;padding-top:12px' : 'margin-top:8px'}">
        <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${modeLabel} / Identificativo</label>
        <input class="inputField" id="drawerInput" type="text" placeholder="${mode === 'cassa' ? '042' : 'ABCD1234567 / AB123CD'}" maxlength="15" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')assignFromDrawer('${id}')">
        <label class="checkLabel"><input type="checkbox" id="drawerFull" style="accent-color:var(--orange)"> 🟡 Piena/o (carico completo)</label>
        <button class="btnGreen" onclick="assignFromDrawer('${id}')">✓ Assegna ${modeLabel}</button>
      </div>`;
    } else if (!occ.length) {
      html += `<div style="color:var(--muted);font-size:13px">Solo gli autisti possono assegnare veicoli.</div>`;
    }
  } else if (!occ.length && !sp.ammessi.includes(_tipoMode())) {
    html += `<div style="color:var(--muted);font-size:13px;margin-top:8px">Il posto non accetta ${_tipoMode() === 'cassa' ? 'casse' : 'container'}.</div>`;
  }
  // Blocco del posto: solo se non c'è nessun mezzo, a cura di amministrativi
  if (!occ.length && canManageDamage) {
    html += `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Stato posto</div>
      <button class="btnUnusable" onclick="addUnusableDrawer('${id}')">🚫 Segna posto come inutilizzabile</button>
    </div>`;
  }
  html += `<button class="btnGray" style="margin-top:8px" onclick="closeDrawer()">Chiudi</button>`;

  document.getElementById('drawerContent').innerHTML = html;
  document.getElementById('spotDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  if (puoRicevere && canManage) setTimeout(() => document.getElementById('drawerInput')?.focus(), 100);
}

export function closeDrawer() {
  document.getElementById('spotDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}

export async function assignFromDrawer(id) {
  const spots = _getSpots();
  const user  = _getUser();
  const mode  = _getMode();
  const inp   = document.getElementById('drawerInput');
  const raw   = inp?.value.trim() || '';

  // Validazione formato
  const plateCheck = validatePlate(raw, mode);
  if (!plateCheck.ok) { showToast(plateCheck.msg, 'error'); return; }
  const plate = plateCheck.plate;

  // Verifica duplicato (su qualsiasi posto)
  const gia = _PC().trovaMezzo(spots, plate);
  if (gia) { showToast(`Veicolo ${plate} già presente nel posto ${gia.posto}.`, 'error'); return; }

  const full = document.getElementById('drawerFull')?.checked || false;
  try {
    // La transazione verifica posto attivo, tipo ammesso e spazio libero
    await _PC().assegna(id, { plate, tipo: _tipoMode(), user: user.email, damaged: false, full });
    await window.logHistory({ spot: id, action: 'Assegnato', plate, mode, full });

    // Se è una cassa piena, crea automaticamente una missione di prelievo
    if (mode === 'cassa' && full) {
      await addDoc(collection(window.db, 'prenotazioni'), {
        plate,
        spotId:        id,
        destinazione:  null,
        dataOra:       serverTimestamp(),
        stato:         'creata',
        urgente:       false,
        operatoreEmail: user.email,
        operatoreNome:  user.name || user.email,
        operatoreUid:  user.uid,
      });
    }

    showToast(`Posto ${id} → ${plate}`, 'success');
    closeDrawer();
  } catch (e) { showToast('⚠️ ' + e.message, 'error'); }
}

export async function freeFromDrawer(id, plate) {
  try {
    const rimosso = await _PC().libera(id, plate || null);
    if (rimosso) await window.logHistory({ spot: id, action: 'Liberato', plate: rimosso.plate });
    showToast(rimosso ? `${rimosso.plate} rimosso dal posto ${id}` : `Posto ${id} già libero`, 'success');
    closeDrawer();
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function toggleFullDrawer(id, newFull, plate) {
  try {
    const m = await _PC().aggiorna(id, plate || null, { full: newFull });
    await window.logHistory({ spot: id, action: newFull ? 'Segnato Pieno' : 'Segnato Vuoto', plate: m.plate });
    showToast(`${m.plate} (${id}) ${newFull ? 'segnato pieno' : 'segnato vuoto'}`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

function _soloAmministrativi(msg) {
  const user = _getUser();
  if (['amministrativo', 'amministratore'].includes(user?.role)) return true;
  showToast(msg, 'error');
  return false;
}

export async function addDamagedDrawer(id, plate) {
  if (!_soloAmministrativi('Non hai i permessi per segnalare un danno.')) return;
  try {
    const m = await _PC().aggiorna(id, plate || null, { damaged: true });
    await window.logHistory({ spot: id, action: 'Danno segnalato', plate: m.plate });
    showToast(`Danno segnalato per ${m.plate} (${id})`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function removeDamagedDrawer(id, plate) {
  if (!_soloAmministrativi('Non hai i permessi per rimuovere un danno.')) return;
  try {
    const m = await _PC().aggiorna(id, plate || null, { damaged: false });
    await window.logHistory({ spot: id, action: 'Danno rimosso', plate: m.plate });
    showToast(`Segnalazione danno rimossa per ${m.plate} (${id})`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

// Con targa → flag sul MEZZO. Senza targa → blocco temporaneo del POSTO (solo se vuoto).
export async function addUnusableDrawer(id, plate) {
  if (!_soloAmministrativi('Non hai i permessi per segnalare un veicolo inutilizzabile.')) return;
  try {
    if (plate) {
      const m = await _PC().aggiorna(id, plate, { unusable: true });
      await window.logHistory({ spot: id, action: 'Inutilizzabile segnalato', plate: m.plate });
      showToast(`${m.plate} (${id}) segnato come inutilizzabile`, 'success');
      openSpotDrawer(id);
    } else {
      await _PC().impostaInutilizzabile(id, true);
      await window.logHistory({ spot: id, action: 'Posto inutilizzabile segnalato', plate: null });
      showToast(`Posto ${id} segnato come inutilizzabile`, 'success');
      closeDrawer();
    }
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function removeUnusableDrawer(id, plate) {
  if (!_soloAmministrativi('Non hai i permessi.')) return;
  try {
    if (plate) {
      const m = await _PC().aggiorna(id, plate, { unusable: false });
      await window.logHistory({ spot: id, action: 'Inutilizzabile rimosso', plate: m.plate });
      showToast(`Stato inutilizzabile rimosso per ${m.plate}`, 'success');
    } else {
      await _PC().impostaInutilizzabile(id, false);
      await window.logHistory({ spot: id, action: 'Posto inutilizzabile rimosso', plate: null });
      showToast(`Stato inutilizzabile rimosso per ${id}`, 'success');
    }
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}
