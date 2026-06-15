import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── PRENOTAZIONI-DESKTOP.JS ─────────────────────────────────────────────────────────
// ── Stato locale prenotazioni ─────────────────────────────────────────────
// DESTINAZIONI_VALIDE è dinamico: dipende dal reparto dell'utente corrente.
// Amministratore → tutte; altri → solo quelle del proprio reparto.
function _getDestinazioniUtente() {
  const reparto = (typeof window.currentUser !== 'undefined' && window.currentUser)
    ? (window.currentUser.role === 'amministratore' ? null : window.currentUser.reparto)
    : null;
  return getDestinazioniPerReparto(reparto);
}

let _prenotazioni = [];
let _mezzoCorrente = null;
let _prenListener = null;
let _destinazioneValida = false;
let _reverseHistoryListener = null;
let _reverseScaricateOggi = 0;
let _ribalteListener = null;
let _ribalteData = {}; // { [id]: { occupied, plate } }
const _gruppoPickerDesk = {}; // { [formKey]: 'PNT1'|'PNT2' }

function _getRibalteLibere() {
  // Escludi ribalte fisicamente occupate in Firestore
  const occupate = new Set(Object.values(_ribalteData).filter(r => r.occupied).map(r => r.id));
  // Escludi ribalte già usate come destinazione in prenotazioni ancora aperte
  _prenotazioni.forEach(p => {
    if (p.stato === 'creata' && p.destinazione) occupate.add(p.destinazione.trim().toUpperCase());
  });
  return {
    PNT1: _getDestinazioniUtente().filter(d => d.startsWith('PNT1') && !occupate.has(d)),
    PNT2: _getDestinazioniUtente().filter(d => d.startsWith('PNT2') && !occupate.has(d))
  };
}

// Stili bottoni picker desktop
const _DS = {
  ribBtn:    'padding:5px 10px;border-radius:6px;border:1px solid var(--border,#3a4050);background:var(--surface2,#2e333d);color:#A4D200;font-size:13px;font-weight:700;cursor:pointer;margin:2px',
  ribBtnSel: 'padding:5px 10px;border-radius:6px;border:2px solid #A4D200;background:#A4D200;color:#1C1F26;font-size:13px;font-weight:700;cursor:pointer;margin:2px',
  navBtn:    'padding:4px 12px;border-radius:6px;border:1px solid var(--border,#3a4050);background:var(--surface2,#2e333d);color:var(--text,#e8eaf0);font-size:12px;font-weight:600;cursor:pointer;margin:2px',
  navBtnSel: 'padding:4px 12px;border-radius:6px;border:2px solid #A4D200;background:#A4D200;color:#1C1F26;font-size:12px;font-weight:700;cursor:pointer;margin:2px',
  altriBtn:  'padding:4px 12px;border-radius:6px;border:1px solid var(--border,#3a4050);background:transparent;color:var(--text2,#9ca3af);font-size:12px;font-weight:600;cursor:pointer;margin:2px',
  label:     'font-size:11px;color:var(--text2,#9ca3af);margin:8px 0 4px;text-transform:uppercase;letter-spacing:.04em',
};

// Restituisce tutte le ribalte libere (non filtrate per reparto utente), escludendo impegnate
function _getRibalteLibereAll() {
  // Ribalte fisicamente occupate in Firestore
  const occupate = new Set(Object.values(_ribalteData).filter(r => r.occupied).map(r => r.id));
  // Ribalte impegnate in prenotazioni aperte
  _prenotazioni.forEach(p => {
    if (p.stato === 'creata' && p.destinazione) occupate.add(p.destinazione.trim().toUpperCase());
  });
  // Usa REPARTI direttamente (disponibile nel bundle) — non window._REPARTI
  const all = typeof REPARTI !== 'undefined'
    ? Object.values(REPARTI).flat()
    : (typeof getDestinazioniPerReparto === 'function' ? getDestinazioniPerReparto(null) : []);
  return {
    PNT1: all.filter(d => d.startsWith('PNT1') && !occupate.has(d)),
    PNT2: all.filter(d => d.startsWith('PNT2') && !occupate.has(d)),
  };
}

function _ribaltaPickerHTMLDesk(formKey) {
  const gruppo = _gruppoPickerDesk[formKey] || 'PNT1';
  const { PNT1, PNT2 } = _getRibalteLibere();
  const list = gruppo === 'PNT1' ? PNT1 : PNT2;
  const btnSt = (a) => `padding:5px 14px;border-radius:6px;font-size:12px;cursor:pointer;` +
    (a ? `border:2px solid #A4D200;background:#A4D200;color:#1C1F26;font-weight:700`
       : `border:1px solid var(--border,#3a4050);background:var(--surface2,#2e333d);color:var(--text,#e8eaf0)`);

  // Pulsante "altri reparti" solo se l'utente non è amministratore
  const mostraAltri = (typeof window.currentUser !== 'undefined' && window.currentUser &&
    window.currentUser.role !== 'amministratore' && window.currentUser.reparto);
  const altriBtnHTML = mostraAltri
    ? `<button onclick="deskApriAltriReparti('${formKey}')" style="${_DS.altriBtn}">🔀 Ribalte altri reparti</button>`
    : '';

  const items = list.length
    ? list.map(d => `<button id="deskRibBtn_${formKey}_${d}" onclick="deskScegliRibalta('${formKey}','${d}')"
        style="${_DS.ribBtn}">${d}</button>`).join('')
    : `<span style="color:var(--text2);font-size:12px">Nessuna libera per ${gruppo}</span>`;

  return `<div id="deskRibaltaPicker_${formKey}" style="margin-top:8px">
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">Ribalta disponibile:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center">
      <button onclick="deskCambiaGruppo('${formKey}','PNT1')" style="${btnSt(gruppo==='PNT1')}">PNT1</button>
      <button onclick="deskCambiaGruppo('${formKey}','PNT2')" style="${btnSt(gruppo==='PNT2')}">PNT2</button>
      ${altriBtnHTML}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${items}</div>
    <div id="deskAltriReparti_${formKey}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#3a4050)"></div>
  </div>`;
}

// ── Navigazione "altri reparti" desktop ───────────────────────────────────────

window.deskApriAltriReparti = function(formKey) {
  const wrap = document.getElementById('deskAltriReparti_' + formKey);
  if (!wrap) return;
  const { PNT1: allPNT1, PNT2: allPNT2 } = _getRibalteLibereAll();
  // Escludi destinazioni già del proprio reparto
  const mieDestin = new Set(_getRibalteLibere().PNT1.concat(_getRibalteLibere().PNT2));
  const pnt1 = allPNT1.filter(d => !mieDestin.has(d));
  const pnt2 = allPNT2.filter(d => !mieDestin.has(d));
  const altreLibere = pnt1.concat(pnt2);

  if (!altreLibere.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--text2)">Nessuna ribalta libera in altri reparti</div>';
    wrap.style.display = 'block';
    return;
  }

  let h = `<div style="${_DS.label}">Seleziona edificio:</div><div style="display:flex;flex-wrap:wrap;gap:4px">`;
  if (pnt1.length) h += `<button style="${_DS.navBtn}" onclick="deskAltriEdificio('${formKey}','PNT1')">🏭 PNT1 (${pnt1.length})</button>`;
  if (pnt2.length) h += `<button style="${_DS.navBtn}" onclick="deskAltriEdificio('${formKey}','PNT2')">🏭 PNT2 (${pnt2.length})</button>`;
  h += `</div><div id="deskAltriSub_${formKey}"></div>`;
  wrap.innerHTML = h;
  wrap.style.display = 'block';
};

window.deskAltriEdificio = function(formKey, edificio) {
  const sub = document.getElementById('deskAltriSub_' + formKey);
  if (!sub) return;
  const { PNT1: allPNT1, PNT2: allPNT2 } = _getRibalteLibereAll();
  const mieDestin = new Set(_getRibalteLibere().PNT1.concat(_getRibalteLibere().PNT2));
  const altreLibere = (edificio === 'PNT1' ? allPNT1 : allPNT2).filter(d => !mieDestin.has(d));

  // Raggruppa per reparto
  const repartiMap = {};
  altreLibere.forEach(d => {
    let found = 'Altro';
    for (const [nome, ids] of Object.entries(typeof REPARTI !== 'undefined' ? REPARTI : {})) {
      if (ids.includes(d)) { found = nome; break; }
    }
    if (!repartiMap[found]) repartiMap[found] = [];
    repartiMap[found].push(d);
  });

  let h = `<div style="${_DS.label}">${edificio} — Seleziona reparto:</div><div style="display:flex;flex-wrap:wrap;gap:4px">`;
  Object.entries(repartiMap).forEach(([nome, ids]) => {
    h += `<button style="${_DS.navBtn}" onclick="deskAltriReparto('${formKey}','${nome}','${edificio}')">${nome} (${ids.length})</button>`;
  });
  h += '</div><div id="deskAltriRibalte_' + formKey + '"></div>';
  sub.innerHTML = h;
};

window.deskAltriReparto = function(formKey, repartoNome, edificio) {
  const wrap = document.getElementById('deskAltriRibalte_' + formKey);
  if (!wrap) return;
  const { PNT1: allPNT1, PNT2: allPNT2 } = _getRibalteLibereAll();
  const mieDestin = new Set(_getRibalteLibere().PNT1.concat(_getRibalteLibere().PNT2));
  const ids = (typeof REPARTI !== 'undefined' && REPARTI[repartoNome]) ? REPARTI[repartoNome] : [];
  const ribalte = allPNT1.concat(allPNT2).filter(d => !mieDestin.has(d) && ids.includes(d));

  let h = `<div style="${_DS.label}">${repartoNome}:</div><div style="display:flex;flex-wrap:wrap;gap:4px">`;
  ribalte.forEach(d => {
    h += `<button id="deskRibBtn_${formKey}_${d}" onclick="deskScegliRibalta('${formKey}','${d}')" style="${_DS.ribBtn}">${d}</button>`;
  });
  h += '</div>';
  wrap.innerHTML = h;
};

window.deskCambiaGruppo = function(formKey, gruppo) {
  _gruppoPickerDesk[formKey] = gruppo;
  const el = document.getElementById('deskRibaltaPicker_' + formKey);
  if (el) el.outerHTML = _ribaltaPickerHTMLDesk(formKey);
};

window.deskScegliRibalta = function(formKey, dest) {
  document.querySelectorAll(`[id^="deskRibBtn_${formKey}_"]`).forEach(b => {
    const sel = b.id === `deskRibBtn_${formKey}_${dest}`;
    b.style.background = sel ? '#A4D200' : 'var(--surface2,#2e333d)';
    b.style.color      = sel ? '#1C1F26' : '#A4D200';
    b.style.border     = sel ? '2px solid #A4D200' : '1px solid var(--border,#3a4050)';
  });
  const inp = document.getElementById('deskRibInput_' + formKey);
  if (inp) inp.value = dest;
  // Se è il picker del form principale, aggiorna il campo hidden e abilita Salva
  if (formKey === 'prenForm') {
    const hidden = document.getElementById('pren-destinazione');
    if (hidden) hidden.value = dest;
    _destinazioneValida = true;
    const fb = document.getElementById('pren-dest-feedback');
    if (fb) { fb.textContent = '✔ ' + dest + ' selezionata'; fb.className = 'pren-feedback ok'; }
    _aggiornaBtnSalva();
  }
};

// Inietta il picker nel form principale (chiamato dopo cercaMezzo e ad ogni aggiornamento ribalte)
function _aggiornaPickerForm() {
  const wrap = document.getElementById('pren-ribalta-picker');
  if (!wrap) return;
  // Se non c'è un mezzo cercato mostra messaggio placeholder
  if (!_mezzoCorrente) {
    wrap.innerHTML = '<div style="font-size:.82rem;color:var(--muted);padding:.4rem 0">🔍 Cerca prima il container per vedere le ribalte disponibili</div>';
    return;
  }
  wrap.innerHTML = _ribaltaPickerHTMLDesk('prenForm');
  // Ripristina selezione corrente se già scelta
  const val = document.getElementById('pren-destinazione')?.value;
  if (val) {
    document.querySelectorAll('[id^="deskRibBtn_prenForm_"]').forEach(b => {
      const sel = b.id === 'deskRibBtn_prenForm_' + val;
      b.style.background = sel ? '#A4D200' : 'var(--surface2,#2e333d)';
      b.style.color      = sel ? '#1C1F26' : '#A4D200';
      b.style.border     = sel ? '2px solid #A4D200' : '1px solid var(--border,#3a4050)';
    });
  }
}

// ── Aggiorna vista tab in base alla modalità corrente ─────────────────────
function _aggiornaVistaPrenotazioni() {
  const isCassa = (window.currentMode === 'cassa');
  document.getElementById('pren-view-container').style.display = isCassa ? 'none' : 'block';
  document.getElementById('pren-view-casse').style.display     = isCassa ? 'block' : 'none';
  if (isCassa) {
    renderCasse();
    _initReverseTarget();
  } else {
    renderPrenotazioni();
    if (_reverseHistoryListener) { _reverseHistoryListener(); _reverseHistoryListener = null; }
  }
}

// ── Vista CASSE: lista posti occupati da casse ────────────────────────────
function renderCasse() {
  const container = document.getElementById('casse-list-container');
  if (!container) return;

  // Filtra i posti occupati da casse piene (plate = 3 cifre + flag full)
  const casseOccupate = Object.values(window.spots).filter(s =>
    s.occupied && s.full && s.plate && RE_CASSA.test(s.plate.trim())
  );

  if (!casseOccupate.length) {
    container.innerHTML = '<div class="casse-empty">Nessuna cassa piena al momento.</div>';
    return;
  }

  // Controlla se ci sono prenotazioni urgenti attive per ciascuna cassa
  const idUrgenti = new Set(
    _prenotazioni
      .filter(p => p.urgente && p.stato === 'creata')
      .map(p => p.plate)
  );

  // Ordine: prima urgenti, poi per anzianità (since crescente = più vecchie prima)
  casseOccupate.sort((a, b) => {
    const aUrg = idUrgenti.has(a.plate) ? 0 : 1;
    const bUrg = idUrgenti.has(b.plate) ? 0 : 1;
    if (aUrg !== bUrg) return aUrg - bUrg;
    // Stessa priorità → più vecchie prima
    const aTs = a.since ? (a.since.toDate ? a.since.toDate().getTime() : new Date(a.since).getTime()) : 0;
    const bTs = b.since ? (b.since.toDate ? b.since.toDate().getTime() : new Date(b.since).getTime()) : 0;
    return aTs - bTs;
  });

  container.innerHTML = casseOccupate.map((s, idx) => {
    const urgente = idUrgenti.has(s.plate);
    const rankClass = idx < 3 ? 'cassa-rank top' : 'cassa-rank';
    const rowClass = urgente ? 'cassa-row urgente' : 'cassa-row';
    const sinceTs = s.since ? (s.since.toDate ? s.since.toDate() : new Date(s.since)) : null;
    const anzianita = sinceTs ? _fmtAnzianita(sinceTs) : '—';
    const sinceStr  = sinceTs ? sinceTs.toLocaleDateString('it-IT', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    return `
      <div class="${rowClass}">
        <div class="${rankClass}" style="font-size:1.1rem">${idx + 1}</div>
        <div class="cassa-id" style="font-size:1.2rem;font-weight:700">${_esc(s.plate)}</div>
        <div class="cassa-posto" style="font-size:1rem">${_esc(s.id)}</div>
        <div class="cassa-anzianita" style="font-size:1rem">
          <span title="Entrata: ${sinceStr}">⏱ ${anzianita}</span>
        </div>
        <div class="cassa-badges">
          ${urgente ? '<span class="badge-urgente" style="font-size:1rem">🚨 Urgente</span>' : ''}
          ${s.full ? '<span class="badge-pieno" style="font-size:1rem">📦 Piena</span>' : ''}
        </div>
      </div>`;
  }).join('');
}

function _fmtAnzianita(date) {
  const ms = Date.now() - date.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'min';
  const d = Math.floor(h / 24);
  return d + 'g ' + (h % 24) + 'h';
}

// ── Vista CONTAINER: validazione e form ──────────────────────────────────
function validaDestinazione() {
  const val = document.getElementById('pren-destinazione').value.trim().toUpperCase();
  const feedback = document.getElementById('pren-dest-feedback');
  if (!val) {
    feedback.textContent = '';
    feedback.className = 'pren-feedback';
    _destinazioneValida = false;
  } else if (_getDestinazioniUtente().includes(val)) {
    feedback.textContent = '✔ Destinazione valida';
    feedback.className = 'pren-feedback ok';
    _destinazioneValida = true;
  } else {
    feedback.textContent = '⚠️ Destinazione non trovata nell\'elenco';
    feedback.className = 'pren-feedback err';
    _destinazioneValida = false;
  }
  _aggiornaBtnSalva();
}

function _aggiornaBtnSalva() {
  const btn = document.getElementById('pren-btn-salva');
  if (btn) btn.disabled = !(_mezzoCorrente && _destinazioneValida);
}

function initPrenotazioni() {
  if (window.currentUser && window.currentUser.role === 'portineria') return;
  const dtInput = document.getElementById('pren-data');
  if (dtInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.min = now.toISOString().slice(0, 16);
    if (!dtInput.value) dtInput.value = now.toISOString().slice(0, 16);
  }
  // Listener ribalte
  if (_ribalteListener) _ribalteListener();
  _ribalteListener = onSnapshot(
    query(collection(window.db, 'ribalte'), orderBy('__name__')),
    snap => {
      _ribalteData = {};
      snap.docs.forEach(d => { _ribalteData[d.id] = { id: d.id, ...d.data() }; });
      _aggiornaPickerForm();
    },
    err => console.error('Errore listener ribalte:', err)
  );
  if (_prenListener) _prenListener();
  _prenListener = onSnapshot(
    query(collection(window.db, 'prenotazioni'), orderBy('dataOra', 'desc')),
    snap => {
      _prenotazioni = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _aggiornaVistaPrenotazioni();
      _aggiornaPickerForm();
    },
    err => console.error('Errore listener prenotazioni:', err)
  );
}

async function cercaMezzo() {
  const targa = document.getElementById('pren-targa').value.trim().toUpperCase();
  const feedback = document.getElementById('pren-mezzo-feedback');
  const infoBox = document.getElementById('pren-mezzo-trovato');
  const btnSalva = document.getElementById('pren-btn-salva');
  _mezzoCorrente = null;
  infoBox.style.display = 'none';
  btnSalva.disabled = true;
  if (!targa) {
    feedback.textContent = 'Inserisci un identificativo.';
    feedback.className = 'pren-feedback err';
    return;
  }
  // Validazione formato: deve essere un container
  const tipo = riconosciTipoMezzo(targa);
  if (tipo !== 'container') {
    feedback.textContent = tipo === 'cassa'
      ? '⚠️ Questo è un numero di cassa. Le prenotazioni riguardano solo container.'
      : '⚠️ Formato non valido. Container: 4 lettere + 7 cifre (es. ABCD1234567)';
    feedback.className = 'pren-feedback err';
    return;
  }
  feedback.textContent = 'Ricerca in corso…';
  feedback.className = 'pren-feedback';
  try {
    const snap = await getDocs(query(collection(window.db, 'spots'), where('plate', '==', targa), limit(1)));
    if (snap.empty) {
      feedback.textContent = '⚠️ Nessun container trovato con ID "' + targa + '".';
      feedback.className = 'pren-feedback err';
      return;
    }
    const docSnap = snap.docs[0];
    const data = docSnap.data();
    _mezzoCorrente = { spotId: docSnap.id, plate: data.plate, occupied: data.occupied };

    // Blocco se container inutilizzabile e vuoto
    if (data.unusable && !data.full) {
      feedback.textContent = `⛔ "${targa}" è inutilizzabile e vuoto. Non può essere assegnato a nessuna missione.`;
      feedback.className = 'pren-feedback err';
      _mezzoCorrente = null;
      return;
    }

    // Controlla se il container è già alla ribalta
    const ribalteSnap = await getDocs(query(collection(window.db, 'ribalte'), where('plate', '==', targa), limit(1)));
    if (!ribalteSnap.empty) {
      const ribData = ribalteSnap.docs[0].data();
      if (ribData.occupied) {
        feedback.textContent = `⚠️ "${targa}" è attualmente alla ribalta ${ribalteSnap.docs[0].id}.`;
        feedback.className = 'pren-feedback err';
        _mezzoCorrente = null;
        return;
      }
    }

    // Controlla se esiste già una prenotazione aperta per questo container
    const prenAperta = _prenotazioni.find(p => p.plate === targa && p.stato === 'creata');
    if (prenAperta) {
      const dest = prenAperta.destinazione ? ` → ${prenAperta.destinazione}` : '';
      feedback.textContent = `⚠️ "${targa}" ha già una prenotazione aperta${dest}.`;
      feedback.className = 'pren-feedback err';
      _mezzoCorrente = null;
      return;
    }

    // Blocco se non parcheggiato
    if (!data.occupied) {
      feedback.textContent = `⛔ "${targa}" non risulta parcheggiato in nessun posto. Impossibile prenotare.`;
      feedback.className = 'pren-feedback err';
      _mezzoCorrente = null;
      return;
    }

    // Blocco se container vuoto
    if (!data.full) {
      feedback.textContent = `⛔ "${targa}" risulta vuoto. Prenotare solo container pieni.`;
      feedback.className = 'pren-feedback err';
      _mezzoCorrente = null;
      return;
    }

    feedback.textContent = '✔ Container trovato!';
    feedback.className = 'pren-feedback ok';
    document.getElementById('pren-spot-id').textContent = docSnap.id;
    document.getElementById('pren-spot-plate').textContent = data.plate;
    const occEl = document.getElementById('pren-spot-occupied');
    occEl.textContent = data.occupied ? '🔴 Occupato' : '🟢 Libero';
    occEl.style.display = 'inline-block';
    infoBox.style.display = 'flex';
    _aggiornaPickerForm();
    _aggiornaBtnSalva();
  } catch (err) {
    console.error('Errore ricerca mezzo:', err);
    feedback.textContent = 'Errore durante la ricerca. Riprova.';
    feedback.className = 'pren-feedback err';
  }
}

async function salvaPrenotazione() {
  if (!_mezzoCorrente) return;
  const destinazione = document.getElementById('pren-destinazione').value.trim().toUpperCase();
  const dataOra = document.getElementById('pren-data').value;
  const urgente = document.getElementById('pren-urgente').checked;
  if (!destinazione || !_getDestinazioniUtente().includes(destinazione)) { alert('Destinazione non valida.'); return; }
  if (!dataOra) { alert('Inserisci data e ora dello spostamento.'); return; }
  const user = window.auth.currentUser;
  const btnSalva = document.getElementById('pren-btn-salva');
  btnSalva.disabled = true;
  btnSalva.textContent = '⏳ Salvataggio…';
  try {
    // Recupera nome completo dall'utente corrente
    const operatoreNome = (typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.name)
      ? window.currentUser.name
      : (user ? user.email : null);
    await addDoc(collection(window.db, 'prenotazioni'), {
      spotId: _mezzoCorrente.spotId,
      plate: _mezzoCorrente.plate,
      tipoMezzo: 'container',
      destinazione: destinazione,
      dataOra: new Date(dataOra),
      stato: 'creata',
      urgente: urgente,
      operatoreUid: user ? user.uid : null,
      operatoreEmail: user ? user.email : null,
      operatoreNome: operatoreNome,
      createdAt: serverTimestamp()
    });
    resetFormPrenotazione();
  } catch (err) {
    console.error('Errore salvataggio:', err);
    alert('Errore durante il salvataggio. Controlla la console.');
    btnSalva.disabled = false;
    btnSalva.textContent = '💾 Salva Prenotazione';
  }
}

async function cambiaStatoPrenotazione(id, nuovoStato) {
  try {
    const aggiornamento = { stato: nuovoStato };
    if (nuovoStato === 'completata') aggiornamento.completedAt = serverTimestamp();
    await updateDoc(doc(window.db, 'prenotazioni', id), aggiornamento);
  } catch (err) {
    console.error('Errore aggiornamento stato:', err);
    alert('Errore durante l\'aggiornamento. Riprova.');
  }
}

async function eliminaPrenotazione(id) {
  if (!confirm('Eliminare questa prenotazione? L\'operazione non è reversibile.')) return;
  try {
    await deleteDoc(doc(window.db, 'prenotazioni', id));
  } catch (err) {
    console.error('Errore eliminazione:', err);
    alert('Errore durante l\'eliminazione. Riprova.');
  }
}

// ── Render tabella container ──────────────────────────────────────────────
function renderPrenotazioni() {
  const tbody = document.getElementById('pren-table-body');
  if (!tbody) return;
  const filtroStato = document.getElementById('pren-filter-stato')?.value || '';
  const filtroData  = document.getElementById('pren-filter-data')?.value || '';
  const filtroTarga = (document.getElementById('pren-filter-targa')?.value || '').toUpperCase().trim();

  // Solo prenotazioni container (esclude casse)
  let lista = _prenotazioni.filter(p => !p.tipoMezzo || p.tipoMezzo === 'container');
  if (filtroStato) lista = lista.filter(p => p.stato === filtroStato);
  if (filtroTarga) lista = lista.filter(p => (p.plate || '').toUpperCase().includes(filtroTarga));
  if (filtroData) lista = lista.filter(p => {
    if (!p.dataOra) return false;
    const d = p.dataOra.toDate ? p.dataOra.toDate() : new Date(p.dataOra);
    return d.toISOString().slice(0, 10) === filtroData;
  });

  // Ordine: completate in fondo, poi urgenti prima, poi per createdAt crescente (prima inserite)
  lista.sort((a, b) => {
    const aCompletata = a.stato === 'completata' ? 1 : 0;
    const bCompletata = b.stato === 'completata' ? 1 : 0;
    if (aCompletata !== bCompletata) return aCompletata - bCompletata;
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    const aCreated = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const bCreated = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return aCreated - bCreated;
  });

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="pren-empty">Nessuna prenotazione trovata.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => {
    const d = p.dataOra?.toDate ? p.dataOra.toDate() : (p.dataOra ? new Date(p.dataOra) : null);
    const dataStr = d ? d.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    const badgeStato   = '<span class="stato-badge stato-' + p.stato + '" style="font-size:.95rem">' + _statoLabel(p.stato) + '</span>';
    const badgeUrgente = p.urgente
      ? '<span style="color:#ef4444;font-weight:700;font-size:1rem">🚨 Sì</span>'
      : '<span style="color:var(--muted);font-size:.9rem">—</span>';
    let azioni = '';
    const isOwn = window.currentUser && p.operatoreUid === window.currentUser.uid;
    const isAmministratore = window.currentUser && window.currentUser.role === 'amministratore';
    const canDelete = isAmministratore || (window.currentUser && window.currentUser.role === 'amministrativo' && isOwn);
    if (p.stato === 'creata' && isAmministratore) {
      const destConf = p.destinazione && p.destinazione !== '—' ? p.destinazione : null;
      const picker   = _ribaltaPickerHTMLDesk('desk_' + p.id);
      const confirmBtnLabel = destConf
        ? `✔ Conferma ${_esc(destConf)}`
        : '✔ Conferma ribalta';
      azioni += `<button class="pren-action-btn btn-completa"
          onclick="toggleDeskCompletaForm('${p.id}')">✔ Completa</button>
        <div id="deskCompletaForm_${p.id}" style="display:none;padding:8px;border:1px solid var(--border,#3a4050);border-radius:8px;margin-top:6px;background:var(--surface,#252930)">
          <input id="deskRibInput_desk_${p.id}" type="text"
                 value="${destConf ? _esc(destConf) : ''}"
                 placeholder="Seleziona ribalta"
                 readonly
                 style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#3a4050);background:var(--bg,#1C1F26);color:var(--text,#e8eaf0);font-size:13px;margin-bottom:6px">
          ${destConf
            ? `<div style="display:flex;gap:6px;margin-bottom:6px">
                 <button onclick="confermaDeskCompleta('${p.id}')"
                         style="flex:1;padding:7px;border-radius:6px;border:none;background:#A4D200;color:#1C1F26;font-size:13px;font-weight:700;cursor:pointer">
                   ✓ ${_esc(destConf)}
                 </button>
                 <button onclick="toggleDeskPickerMod('${p.id}')"
                         style="padding:7px 12px;border-radius:6px;border:1px solid var(--border,#3a4050);background:var(--surface2,#2e333d);color:var(--text,#e8eaf0);font-size:13px;cursor:pointer">
                   ✏️
                 </button>
               </div>
               <div id="deskPickerMod_${p.id}" style="display:none">${picker}
                 <button onclick="confermaDeskCompleta('${p.id}')"
                         style="width:100%;margin-top:6px;padding:7px;border-radius:6px;border:none;background:#A4D200;color:#1C1F26;font-size:13px;font-weight:700;cursor:pointer">
                   ✓ Conferma ribalta selezionata
                 </button>
               </div>`
            : `${picker}
               <button onclick="confermaDeskCompleta('${p.id}')"
                       style="width:100%;margin-top:6px;padding:7px;border-radius:6px;border:none;background:#A4D200;color:#1C1F26;font-size:13px;font-weight:700;cursor:pointer">
                 ✓ Conferma ribalta selezionata
               </button>`}
          <button onclick="toggleDeskCompletaForm('${p.id}')"
                  style="width:100%;margin-top:4px;padding:6px;border-radius:6px;border:1px solid var(--border,#3a4050);background:transparent;color:var(--text2);font-size:12px;cursor:pointer">
            Annulla
          </button>
        </div>`;
    }
    if (canDelete && p.stato !== 'completata') azioni += '<button class="pren-action-btn btn-elimina" onclick="eliminaPrenotazione(\'' + p.id + '\')">🗑</button>';
    const rowClass = p.stato === 'completata' ? ' class="pren-row-completata"' : '';
    const operatoreDisplay = _esc(p.operatoreNome || p.operatoreEmail || '—');
    return '<tr' + rowClass + '><td><strong>' + _esc(p.plate || '—') + '</strong></td><td>' + _esc(p.spotId || '—') + '</td><td>' + _esc(p.destinazione || '—') + '</td><td style="white-space:nowrap">' + dataStr + '</td><td>' + badgeStato + '</td><td style="text-align:center">' + badgeUrgente + '</td><td style="font-size:.9rem">' + operatoreDisplay + '</td><td><div class="pren-actions">' + azioni + '</div></td></tr>';
  }).join('');
}

function _statoLabel(stato) {
  return { creata: 'Creata', completata: 'Completata' }[stato] || stato;
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function resetFormPrenotazione() {
  document.getElementById('pren-targa').value = '';
  document.getElementById('pren-destinazione').value = '';
  document.getElementById('pren-urgente').checked = false;
  document.getElementById('pren-mezzo-feedback').textContent = '';
  document.getElementById('pren-mezzo-feedback').className = 'pren-feedback';
  document.getElementById('pren-dest-feedback').textContent = '';
  document.getElementById('pren-dest-feedback').className = 'pren-feedback';
  document.getElementById('pren-mezzo-trovato').style.display = 'none';
  document.getElementById('pren-btn-salva').disabled = true;
  document.getElementById('pren-btn-salva').textContent = '💾 Salva Prenotazione';
  _mezzoCorrente = null;
  _destinazioneValida = false;
  _gruppoPickerDesk['prenForm'] = 'PNT1';
  _aggiornaPickerForm();
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('pren-data').value = now.toISOString().slice(0, 16);
}

function resetFiltri() {
  document.getElementById('pren-filter-stato').value = '';
  document.getElementById('pren-filter-data').value = '';
  document.getElementById('pren-filter-targa').value = '';
  renderPrenotazioni();
}

// ── Helpers completamento desktop ────────────────────────────────────────────
window.toggleDeskCompletaForm = function(id) {
  const el = document.getElementById('deskCompletaForm_' + id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.toggleDeskPickerMod = function(id) {
  const el = document.getElementById('deskPickerMod_' + id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.confermaDeskCompleta = async function(id) {
  const inp  = document.getElementById('deskRibInput_desk_' + id);
  const dest = inp?.value.trim().toUpperCase();
  if (!dest) { alert('Seleziona una ribalta prima di confermare.'); return; }
  try {
    const pren  = _prenotazioni.find(p => p.id === id);
    const plate = pren?.plate || '—';
    // Aggiorna prenotazione
    await updateDoc(doc(window.db, 'prenotazioni', id), {
      stato: 'completata', completedAt: serverTimestamp(), postoFine: dest
    });
    // Libera posto parcheggio origine
    if (pren?.spotId && !pren.spotId.startsWith('PNT')) {
      await setDoc(doc(window.db, 'spots', pren.spotId), {
        occupied: false, plate: null, since: null, user: null, full: false
      });
    }
    // Occupa ribalta destinazione
    await setDoc(doc(window.db, 'ribalte', dest), {
      occupied: true, plate, since: serverTimestamp(),
      user: auth.currentUser?.email || '—', full: false
    });
  } catch(err) {
    console.error('Errore completamento:', err);
    alert('Errore durante il completamento. Controlla la console.');
  }
};

window.cercaMezzo              = cercaMezzo;
window.salvaPrenotazione       = salvaPrenotazione;
window.resetFormPrenotazione   = resetFormPrenotazione;
window.cambiaStatoPrenotazione = cambiaStatoPrenotazione;
window.eliminaPrenotazione     = eliminaPrenotazione;

// ── Riquadro Target Casse Giornaliero (solo reparto REVERSE) ─────────────

function _isReverseUser() {
  return window.currentUser &&
    (window.currentUser.reparto || '').trim().toUpperCase() === 'REVERSE';
}

function _reverseTargetKey() {
  const d = new Date();
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return `reverse_target_${ds}`;
}

function _initReverseTarget() {
  const box = document.getElementById('reverse-target-box');
  if (!box) return;
  if (!_isReverseUser()) {
    box.style.display = 'none';
    if (_reverseHistoryListener) { _reverseHistoryListener(); _reverseHistoryListener = null; }
    return;
  }
  box.style.display = 'block';
  const input = document.getElementById('reverse-target-input');
  const saved = localStorage.getItem(_reverseTargetKey());
  if (input && saved !== null) input.value = saved;
  _startReverseHistoryListener();
}

function _startReverseHistoryListener() {
  if (_reverseHistoryListener) { _reverseHistoryListener(); _reverseHistoryListener = null; }
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  _reverseHistoryListener = onSnapshot(
    query(collection(window.db, 'history'), where('ts', '>=', oggi), where('action', '==', 'Liberato')),
    snap => {
      const RE = /^\d{3}$/;
      _reverseScaricateOggi = snap.docs.filter(d => {
        const p = d.data().plate;
        return p && RE.test(p.trim());
      }).length;
      _aggiornaReverseUI();
    },
    err => console.error('Errore listener reverse history:', err)
  );
}

function _aggiornaReverseUI() {
  const elScaricate = document.getElementById('reverse-scaricate');
  const elDelta     = document.getElementById('reverse-delta');
  const elPWrap     = document.getElementById('reverse-progress-wrap');
  const elPFill     = document.getElementById('reverse-progress-fill');
  const elPPct      = document.getElementById('reverse-progress-pct');
  if (!elScaricate) return;
  elScaricate.textContent = _reverseScaricateOggi;
  const targetRaw = document.getElementById('reverse-target-input')?.value;
  const target = parseInt(targetRaw, 10);
  if (!targetRaw || isNaN(target) || target <= 0) {
    elDelta.textContent = '—';
    elDelta.classList.remove('negativo');
    if (elPWrap) elPWrap.style.display = 'none';
    return;
  }
  const rimanenti = target - _reverseScaricateOggi;
  elDelta.textContent = rimanenti > 0 ? rimanenti : 0;
  elDelta.classList.toggle('negativo', rimanenti < 0);
  const pct = Math.min(100, Math.round((_reverseScaricateOggi / target) * 100));
  if (elPWrap) {
    elPWrap.style.display = 'block';
    elPFill.style.width = pct + '%';
    elPPct.textContent = pct + '%';
    elPFill.style.background = pct >= 100 ? 'var(--green, #22c55e)' : 'var(--accent)';
  }
}

window.aggiornaReverseTarget = function() {
  const input = document.getElementById('reverse-target-input');
  if (!input) return;
  const val = input.value.trim();
  if (val) localStorage.setItem(_reverseTargetKey(), val);
  else localStorage.removeItem(_reverseTargetKey());
  _aggiornaReverseUI();
};

