// ── ribalte-operativo.js ──────────────────────────────────────────────────────
// Gestione ribalte per ruolo operativo e portineria
// Dipende da: firebase-config.js, shared-utils.js, spots-data.js

import { db, doc, collection, query, orderBy, onSnapshot, updateDoc, addDoc, serverTimestamp }
  from './firebase-config.js';
import { DESTINAZIONI_VALIDE } from './spots-data.js';
import { _esc, showToast, fmtDate, fmtDur } from './shared-utils.js';

// ── STATO INTERNO ─────────────────────────────────────────────────────────────
let _getUser;
let _unsubRibalte = null;
let _ribalteData  = {}; // { [id]: { occupied, plate, since, user, full, reparto, ... } }

// Mappa reparto → id ribalte di competenza
// Adattare secondo la struttura reale dei dati Firestore
// Se l'utente ha reparto=null, vede tutte le ribalte
const REPARTO_RIBALTE = {
  // esempio:
  // 'reparto_a': ['R01','R02','R03'],
  // 'reparto_b': ['R04','R05','R06'],
};

/**
 * Inizializza il modulo ribalte operativo.
 * @param {{ getUser: Function }} opts
 */
export function initRibalteOperativo({ getUser }) {
  _getUser = getUser;

  if (_unsubRibalte) _unsubRibalte();

  // Ascolta la collezione 'spots' filtrando per tipo ribalta
  // I posti ribalta si identificano perché il loro id inizia con 'R' oppure
  // hanno il campo zone === 'RIBALTA'. Adattare al dato reale.
  _unsubRibalte = onSnapshot(
    query(collection(db, 'spots'), orderBy('__name__')),
    snap => {
      _ribalteData = {};
      snap.docs.forEach(d => {
        const data = d.data();
        // Considera ribalta solo i posti con zone 'RIBALTA' o id che inizia con 'R'
        if (data.zone === 'RIBALTA' || d.id.startsWith('R')) {
          _ribalteData[d.id] = { id: d.id, ...data, since: data.since?.toDate() || null };
        }
      });
      renderRibalte();
    },
    err => console.error('Errore ribalte:', err)
  );
}

export function stopRibalte() {
  if (_unsubRibalte) { _unsubRibalte(); _unsubRibalte = null; }
}

/**
 * Renderizza la lista ribalte nella pagina operativo.
 * Filtra per reparto utente se configurato.
 */
export function renderRibalte() {
  const el = document.getElementById('ribaltaList');
  if (!el) return;

  const user   = _getUser ? _getUser() : null;
  const reparto = user?.reparto || null;

  // Determina le ribalte visibili
  let ribalte = Object.values(_ribalteData);

  if (reparto && REPARTO_RIBALTE[reparto]) {
    ribalte = ribalte.filter(r => REPARTO_RIBALTE[reparto].includes(r.id));
  }

  // Stats
  const statsEl = document.getElementById('ribalteStats');
  if (statsEl) {
    const occ  = ribalte.filter(r => r.occupied).length;
    const free = ribalte.length - occ;
    statsEl.innerHTML = `
      <div class="statCard blue"><div class="val">${ribalte.length}</div><div class="lbl">Totali</div></div>
      <div class="statCard green"><div class="val">${free}</div><div class="lbl">Libere</div></div>
      <div class="statCard red"><div class="val">${occ}</div><div class="lbl">Occupate</div></div>
      <div class="statCard orange"><div class="val">${ribalte.filter(r=>r.occupied && r.full).length}</div><div class="lbl">Piene</div></div>`;
  }

  // Subtitle
  const subEl = document.getElementById('ribalteSubtitle');
  if (subEl) {
    subEl.textContent = reparto
      ? `Reparto: ${reparto}`
      : 'Tutte le ribalte';
  }

  if (!ribalte.length) {
    el.innerHTML = '<div class="emptyState">Nessuna ribalta disponibile</div>';
    return;
  }

  // Ordine: occupate prima (quelle che richiedono azione), poi libere
  ribalte.sort((a, b) => {
    if (a.occupied && !b.occupied) return -1;
    if (!a.occupied && b.occupied) return 1;
    return a.id.localeCompare(b.id);
  });

  el.innerHTML = ribalte.map(r => _ribaltaCard(r, user)).join('');
}

function _ribaltaCard(r, user) {
  const isOcc = r.occupied;
  const isOperativo = user?.role === 'operativo';

  let body = '';
  if (isOcc) {
    body += `
      <div class="ribaltaPlate">${_esc(r.plate || '—')}</div>
      <div class="ribaltaMeta">
        Da: ${fmtDate(r.since)} · ${fmtDur(r.since)}
        <span class="ribaltaFullBadge ${r.full ? 'piena' : 'vuota'}">${r.full ? '🟡 Piena' : '🟢 Vuota'}</span>
      </div>`;

    if (isOperativo) {
      // Tasto "Libera" che apre form inline
      body += `
        <button class="btnRed" style="width:100%;padding:11px;font-size:14px"
                onclick="toggleLiberaForm('${r.id}')">
          🚛 Libera ribalta
        </button>
        <div class="liberaForm" id="liberaForm_${r.id}" style="display:none">
          <div class="lfTitle">Veicolo in uscita — stato cassa:</div>
          <div class="liberaToggle">
            <button id="btnVuota_${r.id}" class="activeVuota"
                    onclick="setLiberaStato('${r.id}','vuota')">🟢 Vuota</button>
            <button id="btnPiena_${r.id}"
                    onclick="setLiberaStato('${r.id}','piena')">🟡 Piena</button>
          </div>
          <button class="btnLiberaConferma" onclick="confermaLibera('${r.id}')">
            ✓ Conferma liberazione
          </button>
          <button class="btnLiberaAnnulla" onclick="toggleLiberaForm('${r.id}')">
            Annulla
          </button>
        </div>`;
    }
  } else {
    body += `<div class="ribaltaMeta" style="color:var(--accent2);font-weight:700">Disponibile</div>`;
  }

  return `
    <div class="ribaltaCard ${isOcc ? 'occupied' : 'free'}" id="ribaltaCard_${r.id}">
      <div class="ribaltaHeader">
        <div class="ribaltaId">${_esc(r.id)}</div>
        <span class="ribaltaStateBadge ${isOcc ? 'occupied' : 'free'}">
          ${isOcc ? '🔴 Occupata' : '🟢 Libera'}
        </span>
      </div>
      ${body}
    </div>`;
}

// ── STATO FORM LIBERA ─────────────────────────────────────────────────────────
const _liberaStato = {}; // { [id]: 'vuota' | 'piena' }

window.toggleLiberaForm = function(id) {
  const form = document.getElementById('liberaForm_' + id);
  if (!form) return;
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // default vuota
    _liberaStato[id] = 'vuota';
    _aggiornaToggle(id);
  }
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
  btnV.className = stato === 'vuota' ? 'activeVuota' : '';
  btnP.className = stato === 'piena' ? 'activePiena' : '';
}

window.confermaLibera = async function(id) {
  const user  = _getUser ? _getUser() : null;
  const r     = _ribalteData[id];
  const full  = (_liberaStato[id] || 'vuota') === 'piena';
  const plate = r?.plate || '—';

  try {
    // Libera il posto ribalta su Firestore
    await updateDoc(doc(db, 'spots', id), {
      occupied: false,
      plate:    null,
      since:    null,
      user:     null,
      full:     false
    });

    // Aggiunge record storico
    await addDoc(collection(db, 'history'), {
      ts:     serverTimestamp(),
      spot:   id,
      action: 'Liberato',
      plate,
      user:   user?.email || '—',
      full,
      tipoRibalta: true
    });

    // Crea una missione per gli autisti (nuova prenotazione automatica)
    await addDoc(collection(db, 'prenotazioni'), {
      plate,
      spotId:      id,
      destinazione: '—',
      dataOra:      serverTimestamp(),
      stato:        'creata',
      urgente:      false,
      utenteUid:    user?.uid   || '',
      utenteEmail:  user?.email || '',
      tipoMissione: 'ribalta',
      fullAllaLibera: full,
      note: `Ribalta ${id} liberata — veicolo ${full ? 'PIENO' : 'VUOTO'}`
    });

    showToast(`Ribalta ${id} liberata ✓`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

// ── BOX SUGGERIMENTI (portineria, nella pagina check-in) ──────────────────────
/**
 * Aggiorna il box suggerimenti ribalta visibile nella pagina Check-in
 * @param {Array} freeSpots - array di oggetti spot liberi
 */
export function updateRibalteBox(freeSpots) {
  const el = document.getElementById('sugList');
  if (!el) return;
  el.innerHTML = freeSpots.length
    ? freeSpots.map(s =>
        `<div class="sugItem">
          <span>${_esc(s.id)}</span>
          <span style="color:var(--accent2);font-weight:700;font-size:12px">LIBERO</span>
        </div>`
      ).join('')
    : '<div class="emptyState">Nessun posto libero</div>';
}

/**
 * Verifica se una destinazione ribalta è valida
 */
export function isDestinazioneValida(dest) {
  return DESTINAZIONI_VALIDE.includes((dest || '').toUpperCase());
}
