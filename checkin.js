// ── checkin.js ────────────────────────────────────────────────────────────────
// Check-in rapido + lista posti per la vista Mobile
// Dipende da: firebase-config.js, shared-utils.js, stato globale (spots, currentUser, currentMode)

import { db, doc, setDoc, addDoc, collection, updateDoc, serverTimestamp }
  from './firebase-config.js';
import { fmtDate, fmtDur, showToast } from './shared-utils.js';

// Riferimento allo stato condiviso (definito in mobile.html e passato a questo modulo)
// Usato tramite getters per evitare problemi di riferimento circolare
let _getSpots, _getUser, _getMode;

export function initCheckin({ getSpots, getUser, getMode }) {
  _getSpots = getSpots;
  _getUser  = getUser;
  _getMode  = getMode;
}

// ── UI CHECK-IN ───────────────────────────────────────────────────────────────
export function updateCheckinUI() {
  const spots = _getSpots();
  const all   = Object.values(spots);
  const occ   = all.filter(s => s.occupied).length;
  const free  = all.length - occ;
  const mode  = _getMode() === 'cassa' ? 'Cassa' : 'Container';
  const user  = _getUser();

  document.getElementById('checkinSubtitle').textContent =
    `Modalità: ${mode} | ${free} posti liberi`;
  document.getElementById('checkinCardTitle').textContent =
    `Nuovo Check-in ${mode}`;

  const lbl = document.getElementById('checkinPlaceholderLabel');
  lbl.textContent = _getMode() === 'cassa' ? 'N. Cassa' : 'Targa';
  document.getElementById('checkinInput').placeholder =
    _getMode() === 'cassa' ? 'CAX-001' : 'AB123CD';

  document.getElementById('checkinStats').innerHTML = `
    <div class="statCard blue"><div class="val">${all.length}</div><div class="lbl">Totali</div></div>
    <div class="statCard green"><div class="val">${free}</div><div class="lbl">Liberi</div></div>
    <div class="statCard red"><div class="val">${occ}</div><div class="lbl">Occupati</div></div>
    <div class="statCard orange"><div class="val">${Math.round(occ / all.length * 100) || 0}%</div><div class="lbl">Occupazione</div></div>`;

  // portineria: mostra suggerimenti (prime 5 casse libere)
  if (user?.role === 'portineria') {
    const freeSpots = all.filter(s => !s.occupied).slice(0, 5);
    document.getElementById('sugList').innerHTML = freeSpots.length
      ? freeSpots.map(s =>
          `<div class="sugItem"><span>${s.id}</span><span style="color:var(--accent2);font-weight:700;font-size:12px">LIBERO</span></div>`
        ).join('')
      : '<div class="emptyState">Nessun posto libero</div>';
  }
}

export async function doCheckinRapido() {
  const input  = document.getElementById('checkinInput');
  const plate  = input.value.trim().toUpperCase();
  const res    = document.getElementById('checkinResult');
  const spots  = _getSpots();
  const user   = _getUser();
  const mode   = _getMode();

  const RE_VAL_CASSA     = /^\d{3}$/;
  const RE_VAL_CONTAINER = /^[A-Z]{4}\d{7}$/;

  if (!plate) {
    showResult(res, '⚠️ Inserisci ' + (mode === 'cassa' ? 'n. cassa (3 cifre)' : 'targa (4 lettere + 7 cifre)'), 'warn');
    return;
  }
  if (mode === 'cassa' && !RE_VAL_CASSA.test(plate)) {
    showResult(res, '⚠️ Formato non valido. Inserisci 3 cifre (es. 001)', 'warn');
    return;
  }
  if (mode !== 'cassa' && !RE_VAL_CONTAINER.test(plate)) {
    showResult(res, '⚠️ Formato non valido. Inserisci 4 lettere + 7 cifre (es. ABCD1234567)', 'warn');
    return;
  }

  const all = Object.values(spots);
  const alreadySpot = all.find(s => s.occupied && s.plate === plate);
  if (alreadySpot) {
    showResult(res, `⚠️ ${plate} già al posto ${alreadySpot.id}`, 'warn');
    return;
  }

  const freeSpot = all.find(s => !s.occupied);
  if (!freeSpot) {
    showResult(res, '⚠️ Nessun posto libero disponibile', 'warn');
    return;
  }

  try {
    await setDoc(doc(db, 'spots', freeSpot.id), {
      occupied: true, plate, since: serverTimestamp(),
      user: user.email, damaged: false, full: false
    });
    await addDoc(collection(db, 'history'), {
      ts: serverTimestamp(), spot: freeSpot.id,
      action: 'Assegnato', plate, user: user.email, mode
    });
    showResult(res, `✅ ${plate} → Posto ${freeSpot.id}`, 'ok');
    input.value = '';
    showToast(`Posto ${freeSpot.id} assegnato a ${plate}`, 'success');
  } catch (e) {
    showResult(res, '⚠️ Errore: ' + e.message, 'warn');
  }
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
  const q     = (document.getElementById('searchPosto')?.value || '').trim().toUpperCase();
  const fZona = document.getElementById('filterZona')?.value  || '';

  // Il filtro pill ha precedenza sul select stato (non più presente nella ricerca)
  const pill  = (typeof window._getFilterPill === 'function') ? window._getFilterPill() : '';

  let res = Object.values(spots);
  if (q)               res = res.filter(s => s.id.includes(q) || (s.plate && s.plate.includes(q)));

  const RE_CASSA = /^\d{3}$/;
  const RE_CONTAINER = /^[A-Z]{4}\d{7}$/;
  if (pill === 'libero') {
    res = res.filter(s => !s.occupied);
  } else if (pill === 'occupato') {
    if (mode === 'cassa') {
      // Casse: plate a 3 cifre
      res = res.filter(s => s.occupied && s.plate && RE_CASSA.test(s.plate.trim()));
    } else {
      // Container: plate con 4 lettere + 7 cifre, o comunque NON a 3 cifre
      res = res.filter(s => s.occupied && s.plate && !RE_CASSA.test(s.plate.trim()));
    }
  }

  if (fZona) res = res.filter(s => s.zone === fZona);

  document.getElementById('spotList').innerHTML = res.map(s => `
    <div class="spotItem ${s.occupied ? 'occupied' : 'free'}" onclick="openSpotDrawer('${s.id}')">
      <div class="spotId">${s.id}</div>
      <div class="spotInfo">
        <div class="spotPlate">${s.plate || (s.occupied ? '—' : 'Libero')}</div>
        <div class="spotMeta">${s.zone}${s.since ? ' · ' + fmtDur(s.since) : ''}${s.damaged ? ' · ⚠️ Danneggiato' : ''}${s.full ? ' · 🟡 Pieno' : ''}</div>
      </div>
      <span class="spotBadge ${s.occupied ? 'occ' : 'free'}">${s.occupied ? 'Occupato' : 'Libero'}</span>
    </div>`).join('') || '<div class="emptyState">Nessun posto trovato</div>';
}

// ── DRAWER POSTO ──────────────────────────────────────────────────────────────
export function openSpotDrawer(id) {
  const spots   = _getSpots();
  const user    = _getUser();
  const mode    = _getMode();
  const sp      = spots[id];
  if (!sp) return;

  const canManage = user && (user.role === 'autista' || user.role === 'amministratore' || user.role === 'portineria');
  const modeLabel = mode === 'cassa' ? 'Cassa' : 'Container';
  const modeIcon  = mode === 'cassa' ? '📦' : '🚛';

  let html = `<div class="drawerTitle">${modeIcon} Posto ${id}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">${sp.zone}</div>`;

  if (!sp.occupied) {
    html += `<div style="background:#A4D20013;border:1px solid #A4D20030;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-weight:700;color:var(--accent2)">🟢 Libero</div>`;
    if (canManage) {
      html += `<label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${modeLabel} / Identificativo</label>
        <input class="inputField" id="drawerInput" type="text" placeholder="${mode === 'cassa' ? 'CAX-001' : 'AB123CD'}" maxlength="15" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')assignFromDrawer('${id}')">
        <label class="checkLabel"><input type="checkbox" id="drawerDamaged" style="accent-color:var(--red)"> ⚠️ Veicolo danneggiato</label>
        <label class="checkLabel"><input type="checkbox" id="drawerFull" style="accent-color:var(--orange)"> 🟡 Piena/o (carico completo)</label>
        <button class="btnGreen" onclick="assignFromDrawer('${id}')">✓ Assegna ${modeLabel}</button>`;
    } else {
      html += `<div style="color:var(--muted);font-size:13px">Solo gli autisti possono assegnare veicoli.</div>`;
    }
  } else {
    html += `<div style="background:#ef444413;border:1px solid #ef444430;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-weight:700;color:var(--red)">🔴 Occupato</div>
      <div class="infoRow"><span class="infoKey">${modeLabel}</span><span class="infoVal">${sp.plate || '—'}</span></div>
      <div class="infoRow"><span class="infoKey">Da</span><span class="infoVal">${fmtDate(sp.since)}</span></div>
      <div class="infoRow"><span class="infoKey">Durata</span><span class="infoVal">${fmtDur(sp.since)}</span></div>
      <div class="infoRow"><span class="infoKey">Utente</span><span class="infoVal" style="font-size:12px">${sp.user || '—'}</span></div>
      <div class="infoRow"><span class="infoKey">Stato cassa</span><span class="infoVal">${sp.full ? '🟡 Piena' : '🟢 Vuota'}</span></div>
      ${sp.damaged ? '<div class="infoRow"><span class="infoKey">Danno</span><span class="infoVal" style="color:var(--red)">⚠️ Segnalato</span></div>' : ''}
      <div style="margin-top:14px"></div>
      ${sp.full
        ? `<button class="btnGreen" style="margin-bottom:8px" onclick="toggleFullDrawer('${id}',false)">🟢 Segna come Vuota</button>`
        : `<button class="btnOrange" style="margin-bottom:8px" onclick="toggleFullDrawer('${id}',true)">🟡 Segna come Piena</button>`}`;
    if (canManage) {
      html += `${sp.damaged
        ? `<button class="btnOrange" style="margin-bottom:8px" onclick="removeDamagedDrawer('${id}')">✓ Rimuovi segnalazione danno</button>`
        : `<button class="btnOrange" style="margin-bottom:8px" onclick="addDamagedDrawer('${id}')">⚠️ Segnala veicolo danneggiato</button>`}
        <button class="btnRed" onclick="freeFromDrawer('${id}')">✕ Libera Posto</button>`;
    }
  }
  html += `<button class="btnGray" style="margin-top:8px" onclick="closeDrawer()">Chiudi</button>`;

  document.getElementById('drawerContent').innerHTML = html;
  document.getElementById('spotDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  if (!sp.occupied && canManage) setTimeout(() => document.getElementById('drawerInput')?.focus(), 100);
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
  const plate = inp?.value.trim().toUpperCase();
  if (!plate) { showToast('Inserisci identificativo', 'error'); return; }

  const _RE_CASSA_D     = /^\d{3}$/;
  const _RE_CONTAINER_D = /^[A-Z]{4}\d{7}$/;
  if (mode === 'cassa' && !_RE_CASSA_D.test(plate)) {
    showToast('⚠️ Formato cassa non valido. Usa 3 cifre (es. 001)', 'error'); return;
  }
  if (mode !== 'cassa' && !_RE_CONTAINER_D.test(plate)) {
    showToast('⚠️ Formato container non valido. Usa 4 lettere + 7 cifre (es. ABCD1234567)', 'error'); return;
  }

  const alreadySpot = Object.entries(spots).find(([sid, s]) => s.occupied && s.plate === plate && sid !== id);
  if (alreadySpot) { showToast(`⚠️ ${plate} già al posto ${alreadySpot[0]}`, 'error'); return; }

  const damaged = document.getElementById('drawerDamaged')?.checked || false;
  const full    = document.getElementById('drawerFull')?.checked    || false;
  try {
    await setDoc(doc(db, 'spots', id), { occupied: true, plate, since: serverTimestamp(), user: user.email, damaged, full });
    await addDoc(collection(db, 'history'), { ts: serverTimestamp(), spot: id, action: 'Assegnato', plate, user: user.email, mode });
    showToast(`Posto ${id} → ${plate}`, 'success');
    closeDrawer();
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function freeFromDrawer(id) {
  const spots = _getSpots();
  const user  = _getUser();
  const sp    = spots[id];
  try {
    await addDoc(collection(db, 'history'), { ts: serverTimestamp(), spot: id, action: 'Liberato', plate: sp.plate, user: user.email });
    await setDoc(doc(db, 'spots', id), { occupied: false, plate: null, since: null, user: null, full: false });
    showToast(`Posto ${id} liberato`, 'success');
    closeDrawer();
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function toggleFullDrawer(id, newFull) {
  const spots = _getSpots();
  const user  = _getUser();
  try {
    await updateDoc(doc(db, 'spots', id), { full: newFull });
    await addDoc(collection(db, 'history'), { ts: serverTimestamp(), spot: id, action: newFull ? 'Segnato Pieno' : 'Segnato Vuoto', plate: spots[id].plate, user: user.email });
    showToast(`Posto ${id} ${newFull ? 'segnato pieno' : 'segnato vuoto'}`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function addDamagedDrawer(id) {
  const spots = _getSpots();
  const user  = _getUser();
  try {
    await updateDoc(doc(db, 'spots', id), { damaged: true });
    await addDoc(collection(db, 'history'), { ts: serverTimestamp(), spot: id, action: 'Danno segnalato', plate: spots[id].plate, user: user.email });
    showToast(`Danno segnalato per ${id}`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}

export async function removeDamagedDrawer(id) {
  const spots = _getSpots();
  const user  = _getUser();
  try {
    await updateDoc(doc(db, 'spots', id), { damaged: false });
    await addDoc(collection(db, 'history'), { ts: serverTimestamp(), spot: id, action: 'Danno rimosso', plate: spots[id].plate, user: user.email });
    showToast(`Danno rimosso per ${id}`, 'success');
    openSpotDrawer(id);
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
}
