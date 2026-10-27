// ── impostazioni-desktop.js ─ Tab Impostazioni ────────────────────────────────
// Config del magazzino (reparti → ribalte, etichette zone) su Firestore nel
// documento config/magazzino, con fallback sui dati statici di spots-data-desktop.js.
//
// ELENCO UNICO (ribalte, posti, navette) con i tasti Attiva/Disattiva · Modifica · Elimina.
//   Ribalte : attivazione in config/parcheggi.ribalteDisattivate; elenco/reparto in
//             config/magazzino; rinomina ed eliminazione in ParcheggiCore.
//   Posti   : tabella in config/posti (ParcheggiCore; al primo salvataggio viene
//             copiata dal codice), attivazione in config/parcheggi.disattivati.
//   Navette : collezione navette (NavetteCore).
//
// window.REPARTI_TUTTI = tutte le ribalte; window.REPARTI = solo le ATTIVE
// (è quella che usano picker, validazioni, portineria, navette, ricerca).
// Amministratore: tutto. Amministrativo: solo le ribalte, solo Attiva/Disattiva.
import { doc, getDoc, setDoc, onSnapshot }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CFG_REF = () => doc(window.db, 'config', 'magazzino');

// Etichette di default per i reparti conosciuti (per il primo seed)
const _DEFAULT_REPARTO_LABELS = {
  'RICEVIMENTO': 'Ricevimento', 'SPEDIZIONI': 'Spedizioni', 'CAPI APPESI': 'Capi appesi',
  'LAV MAN': 'Lav man', 'REVERSE': 'Reverse', 'ESTERO': 'Estero',
  'E-COMMERCE': 'E-commerce', 'TGW': 'TGW'
};
// Etichette di default delle zone (solo per il primo seed).
const _DEFAULT_ZONE = {
  'ZONA A': { label: 'P Verde (A)' },
  'ZONA B': { label: 'P Blu (B)' },
  'ZONA C': { label: 'Zona C' },
  'ZONA D': { label: 'Zona D' },
};

const _RE_RIBALTA = /^PNT[12]-\d{2}$/;

let _cfg = null;          // copia locale della config Firestore
let _unsub = null;        // unsubscribe listener
let _seeding = false;

const _isAdmin = () => window.currentUser?.role === 'amministratore';
const _esc = (s) => (window._esc || (x => String(x ?? '')))(s);
const _sortId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

function _titleCase(s){ return s.toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()); }

// Costruisce la config di default a partire dai dati statici
function _buildDefaultConfig(){
  const reparti = {}, ordine = [];
  const R = window.REPARTI_TUTTI || window.REPARTI || {};
  Object.keys(R).forEach(code => {
    reparti[code] = {
      label: _DEFAULT_REPARTO_LABELS[code] || _titleCase(code),
      ribalte: (R[code] || []).slice()
    };
    ordine.push(code);
  });
  const zone = {};
  window.ParcheggiCore.zone().forEach(z => {
    zone[z] = { label: (_DEFAULT_ZONE[z] && _DEFAULT_ZONE[z].label) || z };
  });
  return { reparti, ordine, zone };
}

// Riporta la config nelle variabili globali usate dal resto dell'app
function _applyToGlobals(cfg){
  const REPARTI = {}, LABELS = {}, ORDER = [];
  (cfg.ordine || Object.keys(cfg.reparti || {})).forEach(code => {
    const r = (cfg.reparti || {})[code];
    if(!r) return;
    REPARTI[code] = (r.ribalte || []).slice();
    LABELS[code]  = r.label || _titleCase(code);
    ORDER.push(code);
  });
  window.REPARTI_TUTTI = REPARTI;
  window.REPARTI = window.ParcheggiCore.filtraReparti(REPARTI);
  window.REPARTI_LABELS = LABELS;
  window.REPARTI_ORDER = ORDER;
  window.ZONE_META = cfg.zone || {};
}

// Propaga i cambiamenti alle altre viste già renderizzate
function _refreshDependents(){
  if(window.renderUsers) try{ window.renderUsers(); }catch(e){}
  if(window._aggiornaVistaPrenotazioni) try{ window._aggiornaVistaPrenotazioni(); }catch(e){}
  if(window.doSearch && document.getElementById('pageRicerca')?.classList.contains('active'))
    try{ window.doSearch(); }catch(e){}
  if(document.getElementById('pageImpostazioni')?.classList.contains('active'))
    renderImpostazioni();
  _populateNewUserReparto();
}

// Cambio delle ribalte disattivate (evento da ParcheggiCore): ricalcola REPARTI
window.addEventListener('calpnt:ribalte', ()=>{
  window.REPARTI = window.ParcheggiCore.filtraReparti(window.REPARTI_TUTTI || {});
  _refreshDependents();
});

// ── Caricamento / listener config ──────────────────────────────────────────────
async function initImpostazioniConfig(){
  if(_unsub) return;                       // già inizializzato
  try{
    const snap = await getDoc(CFG_REF());
    if(!snap.exists()){
      // Primo avvio: seed dai dati statici (solo amministratore può scrivere)
      _cfg = _buildDefaultConfig();
      if(_isAdmin()){
        _seeding = true;
        try{ await setDoc(CFG_REF(), _cfg); }catch(e){ /* regole Firestore: ignora */ }
        _seeding = false;
      }
      _applyToGlobals(_cfg);
      _refreshDependents();
    }
  }catch(e){ /* offline / permessi: si resta sui dati statici */ }

  // Listener realtime
  _unsub = onSnapshot(CFG_REF(), (snap)=>{
    if(!snap.exists()) return;
    _cfg = snap.data();
    _cfg.zone = _cfg.zone || {};
    window.ParcheggiCore.zone().forEach(z => { if(!_cfg.zone[z]) _cfg.zone[z] = { label: _DEFAULT_ZONE[z]?.label || z }; });
    _applyToGlobals(_cfg);
    _refreshDependents();
  }, ()=>{});
}
function stopImpostazioni(){ if(_unsub){ _unsub(); _unsub=null; } }

async function _saveConfig(){
  if(!_cfg) return;
  if(!_isAdmin()){
    window.showToast('Solo un amministratore può modificare la configurazione', 'error');
    return;
  }
  try{
    _cfg.ordine = _cfg.ordine || Object.keys(_cfg.reparti || {});
    await setDoc(CFG_REF(), _cfg);
    // il listener onSnapshot aggiorna globals e viste
  }catch(e){
    window.showToast('Errore salvataggio: ' + e.message, 'error');
    throw e;
  }
}

// Config fresca dal server (dopo operazioni fatte da ParcheggiCore su config/magazzino)
async function _ricaricaConfig(){
  try{ const s = await getDoc(CFG_REF()); if(s.exists()) _cfg = s.data(); }catch(e){}
}

// ── Reparti e zone ─────────────────────────────────────────────────────────────
function _findRepartoOf(code){
  const rr = _cfg.reparti || {};
  return Object.keys(rr).find(k => (rr[k].ribalte || []).includes(code)) || null;
}

window._impAddReparto = function(){
  const codeEl = document.getElementById('imp-new-rep-code');
  const labEl  = document.getElementById('imp-new-rep-label');
  const code = (codeEl?.value || '').trim().toUpperCase();
  const label = (labEl?.value || '').trim() || _titleCase(code);
  if(!code){ window.showToast('Inserisci il codice reparto', 'error'); return; }
  if(_cfg.reparti[code]){ window.showToast('Reparto già esistente', 'error'); return; }
  _cfg.reparti[code] = { label, ribalte: [] };
  _cfg.ordine = (_cfg.ordine || Object.keys(_cfg.reparti)).concat(code);
  if(codeEl) codeEl.value=''; if(labEl) labEl.value='';
  _saveConfig().catch(()=>{});
};

window._impRenameReparto = function(code){
  const cur = _cfg.reparti[code]?.label || '';
  const nl = prompt('Nuova etichetta per il reparto ' + code + ':', cur);
  if(nl===null) return;
  const v = nl.trim();
  if(!v) return;
  _cfg.reparti[code].label = v;
  _saveConfig().catch(()=>{});
};

window._impDeleteReparto = function(code){
  const n = (_cfg.reparti[code]?.ribalte || []).length;
  if(!confirm('Eliminare il reparto "'+(_cfg.reparti[code]?.label||code)+'"?\n'
      + (n ? ('Le sue '+n+' ribalte diventeranno "non assegnate".') : '') )) return;
  _cfg.nonAssegnate = (_cfg.nonAssegnate || []).concat(_cfg.reparti[code]?.ribalte || []);
  delete _cfg.reparti[code];
  _cfg.ordine = (_cfg.ordine || []).filter(x=>x!==code);
  _saveConfig().catch(()=>{});
};

window._impRenameZona = function(z){
  const cur = (_cfg.zone?.[z]?.label) || z;
  const nl = prompt('Etichetta per la zona ' + z + ':', cur);
  if(nl===null) return;
  _cfg.zone = _cfg.zone || {};
  _cfg.zone[z] = _cfg.zone[z] || {};
  _cfg.zone[z].label = nl.trim() || z;
  _saveConfig().catch(()=>{});
};

// Opzioni <option> per i dropdown reparto (usato anche da admin-desktop.js)
window._repartoOptionsHTML = function(selected){
  const order = window.REPARTI_ORDER || Object.keys(window.REPARTI || {});
  const labels = window.REPARTI_LABELS || {};
  let out = '<option value="" '+(!selected?'selected':'')+'>— Reparto —</option>';
  order.forEach(code=>{
    out += '<option value="'+_esc(code)+'" '+(selected===code?'selected':'')+'>'+_esc(labels[code]||code)+'</option>';
  });
  return out;
};

function _populateNewUserReparto(){
  const sel = document.getElementById('newUserReparto');
  if(sel) sel.innerHTML = window._repartoOptionsHTML('');
}
window._populateNewUserReparto = _populateNewUserReparto;

// ══════════════════════════════════════════════════════════════════════════════
// ELENCO UNICO
// ══════════════════════════════════════════════════════════════════════════════
let _filtroTipo = 'tutti';      // 'tutti' | 'ribalta' | 'posto' | 'navetta'
let _filtroQ = '';

const _edificioDi = rb => (String(rb).match(/^(PNT\d)/i) || [,'—'])[1].toUpperCase();

// Stato d'uso di una ribalta (per colonna Stato e per evidenziare quelle bloccate)
function _usoRibalta(rb){
  const k = String(rb).trim().toUpperCase();
  const r = (window.ribalte||{})[k];
  const nav = Object.values(window.navette||{}).find(n => String(n.posizione||'').toUpperCase() === k);
  const aperte = (window.prenotazioniAperte||[]).some(p =>
    [p.destinazione, p.origine, p.spotId, p.ribaltaArrivo].some(x => String(x||'').toUpperCase() === k));
  if(r && r.occupied){
    if(r.inLiberazione) return { txt:'in liberazione · '+(r.plate||''), uso:true };
    if(r.inSpostamento) return { txt:'in spostamento · '+(r.plate||''), uso:true };
    return { txt:'occupata · '+(r.plate||''), uso:true };
  }
  if(nav) return { txt:'navetta '+(nav.nome||''), uso:true };
  if(aperte) return { txt:'missione aperta', uso:true };
  return { txt:'libera', uso:false };
}

// Tutte le righe dell'elenco
function _righe(){
  const C = window.ParcheggiCore;
  const out = [];
  const labels = {};
  Object.keys(_cfg.reparti || {}).forEach(k => labels[k] = _cfg.reparti[k].label || k);

  // Ribalte (tutte, anche disattivate e non assegnate)
  const viste = new Set();
  (_cfg.ordine || Object.keys(_cfg.reparti || {})).forEach(code => {
    ((_cfg.reparti[code] || {}).ribalte || []).forEach(rb => {
      const id = String(rb).toUpperCase(); if(viste.has(id)) return; viste.add(id);
      const on = C.ribaltaAttiva(id), u = on ? _usoRibalta(id) : { txt:'', uso:false };
      out.push({ tipo:'ribalta', id, gruppo: labels[code] || code, ordGruppo: _edificioDi(id),
        dettagli: _edificioDi(id), on, uso: u.uso, usoTxt: u.txt });
    });
  });
  (_cfg.nonAssegnate || []).forEach(rb => {
    const id = String(rb).toUpperCase(); if(viste.has(id)) return; viste.add(id);
    const on = C.ribaltaAttiva(id), u = on ? _usoRibalta(id) : { txt:'', uso:false };
    out.push({ tipo:'ribalta', id, gruppo:'— non assegnata', ordGruppo:'ZZ', dettagli:_edificioDi(id), on, uso:u.uso, usoTxt:u.txt });
  });

  // Posti
  const zoneMeta = _cfg.zone || {};
  const _amm = a => a.map(t => t === 'cassa' ? 'casse' : 'container').join(' + ');
  C.idTutti().forEach(id => {
    const c = C.criterio(id), on = C.isAttivo(id);
    const v = (window.spots||{})[id];
    const occ = on && v ? C.etichettaOcc(v) : '';
    const targhe = on && v ? (v.occupanti||[]).map(o=>o.plate).join(', ') : '';
    const usoTxt = !on ? '' : (v && v.inutilizzabile ? 'inutilizzabile' : (occ || 'libero') + (targhe ? ' · ' + targhe : ''));
    out.push({ tipo:'posto', id, gruppo: (zoneMeta[c.zona]?.label) || c.zona, ordGruppo: c.zona,
      dettagli: `${_amm(c.ammessi)} · ${c.stato==='pieno'?'pieni':'vuoti'}${c.sotto>1?' · ×'+c.sotto:''}${c.slide!=null?' · slide '+c.slide:''}`,
      on, uso: !!(v && v.occupanti && v.occupanti.length), usoTxt });
  });

  // Navette
  Object.values(window.navette || {}).forEach(n => {
    const st = n.stato === 'in_missione' ? 'in missione' : (n.stato || 'vuoto');
    out.push({ tipo:'navetta', id: n.nome, gruppo: n.posizione || '—', ordGruppo: n.posizione || '',
      dettagli: 'navetta ' + st, on: n.attiva !== false, uso: n.stato === 'in_missione' || !!n.missioneId, usoTxt: st });
  });
  return out;
}

const _TIPI = [
  { k:'tutti',   lab:'Tutti' },
  { k:'ribalta', lab:'Ribalte' },
  { k:'posto',   lab:'Posti' },
  { k:'navetta', lab:'Navette' },
];
const _ORD_TIPO = { ribalta:0, posto:1, navetta:2 };

function _righeFiltrate(){
  let r = _righe();
  if(!_isAdmin()) r = r.filter(x => x.tipo === 'ribalta');
  const tutte = r;
  if(_filtroTipo !== 'tutti') r = r.filter(x => x.tipo === _filtroTipo);
  const q = _filtroQ.trim().toUpperCase();
  if(q) r = r.filter(x => [x.id, x.gruppo, x.dettagli, x.usoTxt].some(v => String(v||'').toUpperCase().includes(q)));
  r.sort((a,b) => (_ORD_TIPO[a.tipo]-_ORD_TIPO[b.tipo]) || String(a.ordGruppo).localeCompare(String(b.ordGruppo)) || _sortId(a.id,b.id));
  return { righe: r, tutte };
}

function _rigaHTML(x){
  const admin = _isAdmin();
  const tipoLab = { ribalta:'Ribalta', posto:'Posto', navetta:'Navetta' }[x.tipo];
  const id = _esc(x.id), t = x.tipo;
  const stato = x.on
    ? `<span class="imp-badge on">Attiv${t==='ribalta'||t==='navetta'?'a':'o'}</span>`
    : `<span class="imp-badge off">Disattivat${t==='ribalta'||t==='navetta'?'a':'o'}</span>`;
  const uso = x.usoTxt ? `<span class="imp-uso ${x.uso?'busy':''}">${_esc(x.usoTxt)}</span>` : '';
  let az = `<button class="imp-act" onclick="window._impToggle('${t}','${id}')">${x.on?'Disattiva':'Attiva'}</button>`;
  if(admin){
    az += `<button class="imp-act" onclick="window._impModifica('${t}','${id}')">Modifica</button>`;
    az += `<button class="imp-act danger" onclick="window._impElimina('${t}','${id}')">Elimina</button>`;
  }
  return `<tr class="${x.on?'':'is-off'}">
    <td><span class="imp-tipo ${t}">${tipoLab}</span></td>
    <td class="mono">${id}</td>
    <td>${_esc(x.gruppo)}</td>
    <td class="muted">${_esc(x.dettagli)}</td>
    <td>${stato} ${uso}</td>
    <td class="imp-azioni">${az}</td>
  </tr>`;
}

function _renderElenco(){
  const body = document.getElementById('imp-rows');
  if(!body || !_cfg) return;
  const { righe, tutte } = _righeFiltrate();
  body.innerHTML = righe.length ? righe.map(_rigaHTML).join('')
    : '<tr><td colspan="6" class="muted" style="text-align:center;padding:18px">Nessun elemento</td></tr>';
  // filtri con conteggi
  const pills = document.getElementById('imp-filtri');
  if(pills){
    const tipi = _isAdmin() ? _TIPI : _TIPI.filter(x => x.k === 'ribalta');
    pills.innerHTML = tipi.map(f => {
      const n = f.k === 'tutti' ? tutte.length : tutte.filter(x => x.tipo === f.k).length;
      const off = f.k === 'tutti' ? tutte.filter(x=>!x.on).length : tutte.filter(x => x.tipo === f.k && !x.on).length;
      return `<button class="imp-pill ${_filtroTipo===f.k?'active':''}" onclick="window._impFiltro('${f.k}')">${f.lab} <small>${n}${off?' · '+off+' off':''}</small></button>`;
    }).join('');
  }
  const fonte = document.getElementById('imp-fonte');
  if(fonte) fonte.style.display = (_isAdmin() && window.ParcheggiCore.fonteTabella() === 'codice') ? '' : 'none';
}

window._impFiltro = function(k){ _filtroTipo = k; _renderElenco(); };
window._impCerca  = function(v){ _filtroQ = v || ''; _renderElenco(); };

// Sezione Reparti e zone (solo amministratore)
function _repartiZoneHTML(){
  const order = _cfg.ordine || Object.keys(_cfg.reparti || {});
  const rows = order.map(code => {
    const r = _cfg.reparti[code]; if(!r) return '';
    return `<tr><td>${_esc(r.label||code)}</td><td class="mono muted">${_esc(code)}</td>
      <td class="muted">${(r.ribalte||[]).length} ribalte</td>
      <td class="imp-azioni"><button class="imp-act" onclick="window._impRenameReparto('${_esc(code)}')">Rinomina</button>
      <button class="imp-act danger" onclick="window._impDeleteReparto('${_esc(code)}')">Elimina</button></td></tr>`;
  }).join('');
  const zone = window.ParcheggiCore.zone().map(z => {
    const lab = _cfg.zone?.[z]?.label || z;
    return `<button class="imp-pill" title="Rinomina etichetta" onclick="window._impRenameZona('${_esc(z)}')">${_esc(lab)} <small>${_esc(z)} ✏️</small></button>`;
  }).join('');
  return `
    <div class="imp-cols">
      <div class="imp-card">
        <div class="imp-card-title">Reparti</div>
        <table class="imp-table compact"><tbody>${rows}</tbody></table>
        <div class="imp-addrep">
          <input id="imp-new-rep-code"  class="inputField" placeholder="CODICE (es. PACKING)" spellcheck="false" style="text-transform:uppercase">
          <input id="imp-new-rep-label" class="inputField" placeholder="Etichetta (es. Packing)">
          <button class="imp-act primary" onclick="window._impAddReparto()">+ Reparto</button>
        </div>
      </div>
      <div class="imp-card">
        <div class="imp-card-title">Etichette zone</div>
        <div class="imp-chips">${zone}</div>
      </div>
    </div>`;
}

// ── Render del tab ─────────────────────────────────────────────────────────────
function renderImpostazioni(){
  const wrap = document.getElementById('pageImpostazioni');
  if(!wrap) return;
  const body = wrap.querySelector('#imp-body');
  if(!_cfg){
    body.innerHTML = '<div style="color:var(--muted);font-size:13px">Caricamento configurazione…</div>';
    body.dataset.built = '';
    return;
  }
  const admin = _isAdmin();
  if(!admin) _filtroTipo = 'ribalta';
  const chiave = admin ? 'admin' : 'ribalte';
  if(body.dataset.built !== chiave){
    body.innerHTML = `
      ${admin ? '<div class="imp-section"><div class="imp-section-title">Reparti e zone</div><div id="imp-repzone"></div></div>' : ''}
      <div class="imp-section">
        <div class="imp-section-title">${admin ? 'Ribalte, posti e navette' : 'Ribalte'}</div>
        <div class="imp-note">${admin
          ? '<strong>Disattiva</strong> nasconde l\'elemento da tutte le funzioni finché non lo riattivi. <strong>Modifica</strong> ed <strong>Elimina</strong> sono bloccati se l\'elemento è occupato, in uso da una navetta o coinvolto in una missione aperta.'
          : 'Una ribalta disattivata sparisce da prenotazioni, missioni, navette e portineria finché non la riattivi. Si disattiva solo una ribalta libera, senza navetta e senza missioni aperte.'}</div>
        <div class="imp-note warn" id="imp-fonte" style="display:none">I posti vengono ancora dalla tabella nel codice (<code>parcheggi-data.js</code>): al primo salvataggio di un posto la tabella viene copiata su Firestore e da lì in poi si gestisce solo da qui.</div>
        <div class="imp-toolbar">
          <div class="imp-pills" id="imp-filtri"></div>
          <input class="inputField imp-search" placeholder="Cerca ID, reparto, zona, targa…" value="${_esc(_filtroQ)}" oninput="window._impCerca(this.value)">
          ${admin ? `<div class="imp-add">
            <button class="imp-act primary" onclick="window._impModifica('ribalta','')">+ Ribalta</button>
            <button class="imp-act primary" onclick="window._impModifica('posto','')">+ Posto</button>
            <button class="imp-act primary" onclick="window._impModifica('navetta','')">+ Navetta</button></div>` : ''}
        </div>
        <div class="imp-tablewrap">
          <table class="imp-table">
            <thead><tr><th>Tipo</th><th>ID</th><th>Reparto / zona / posizione</th><th>Dettagli</th><th>Stato</th><th>Azioni</th></tr></thead>
            <tbody id="imp-rows"></tbody>
          </table>
        </div>
      </div>`;
    body.dataset.built = chiave;
  }
  const rz = document.getElementById('imp-repzone');
  if(rz) rz.innerHTML = _repartiZoneHTML();
  _renderElenco();
}
window.renderImpostazioni = renderImpostazioni;

// ══════════════════════════════════════════════════════════════════════════════
// AZIONI
// ══════════════════════════════════════════════════════════════════════════════
const _inCorso = new Set();
async function _esegui(chiave, fn, okMsg){
  if(_inCorso.has(chiave)) return false;
  _inCorso.add(chiave);
  try{ await fn(); if(okMsg) window.showToast(okMsg, 'success'); return true; }
  catch(e){ window.showToast(e.message || String(e), 'error'); return false; }
  finally{ _inCorso.delete(chiave); }
}

// ── Attiva / Disattiva ─────────────────────────────────────────────────────────
window._impToggle = async function(tipo, id){
  const C = window.ParcheggiCore;
  const role = window.currentUser?.role;
  if(tipo === 'ribalta'){
    if(role !== 'amministratore' && role !== 'amministrativo'){
      window.showToast('Solo amministratore e amministrativo possono attivare o disattivare le ribalte.','error'); return;
    }
    const attiva = !C.ribaltaAttiva(id);
    if(!attiva && !confirm(`Disattivare la ribalta ${id}?\nNon comparirà più in nessuna funzione finché non la riattivi.`)) return;
    await _esegui('r:'+id, () => C.impostaRibaltaAttiva(id, attiva, window.currentUser), `Ribalta ${id} ${attiva?'attivata':'disattivata'}`);
    return;
  }
  if(!_isAdmin()){ window.showToast('Operazione riservata all\'amministratore.','error'); return; }
  if(tipo === 'posto'){
    const attiva = !C.isAttivo(id);
    if(!attiva && !confirm(`Disattivare il posto ${id}?\nNon comparirà più in nessuna funzione finché non lo riattivi.`)) return;
    await _esegui('p:'+id, () => C.impostaAttivo(id, attiva, window.currentUser), `Posto ${id} ${attiva?'attivato':'disattivato'}`);
    return;
  }
  if(tipo === 'navetta'){
    const n = (window.navette||{})[id];
    const attiva = !(n && n.attiva !== false);
    if(!attiva && n && n.stato === 'in_missione'){ window.showToast(`La navetta ${id} è in missione.`,'error'); return; }
    await _esegui('n:'+id, () => window.NavetteCore.setAttiva(id, attiva), `Navetta ${id} ${attiva?'attivata':'disattivata'}`);
  }
};
// compatibilità con eventuali chiamate esistenti
window._impToggleRibalta = (id) => window._impToggle('ribalta', id);
window._impTogglePosto   = (id) => window._impToggle('posto', id);

// ── Elimina ────────────────────────────────────────────────────────────────────
window._impElimina = async function(tipo, id){
  if(!_isAdmin()){ window.showToast('Operazione riservata all\'amministratore.','error'); return; }
  const C = window.ParcheggiCore;
  const nome = { ribalta:'la ribalta', posto:'il posto', navetta:'la navetta' }[tipo];
  if(!confirm(`Eliminare definitivamente ${nome} ${id}?\nLo storico resta, ma l'elemento sparisce dall'elenco. Per nasconderlo solo temporaneamente usa "Disattiva".`)) return;
  if(tipo === 'ribalta')
    await _esegui('r:'+id, async () => { await C.eliminaRibalta(id, window.currentUser); await _ricaricaConfig(); }, `Ribalta ${id} eliminata`);
  else if(tipo === 'posto')
    await _esegui('p:'+id, () => C.eliminaPosto(id, window.currentUser), `Posto ${id} eliminato`);
  else if(tipo === 'navetta')
    await _esegui('n:'+id, async () => {
      await window.NavetteCore.eliminaNavetta(id);
      if(window.logHistory) try{ await window.logHistory({ spot:id, action:'Navetta eliminata' }); }catch(e){}
    }, `Navetta ${id} eliminata`);
};

// ── Modifica / Nuovo (finestra) ────────────────────────────────────────────────
function _modal(){
  let m = document.getElementById('imp-modal');
  if(!m){
    m = document.createElement('div');
    m.id = 'imp-modal'; m.className = 'modal';
    m.addEventListener('click', e => { if(e.target === m) window._impChiudi(); });
    document.body.appendChild(m);
  }
  return m;
}
window._impChiudi = function(){ const m = document.getElementById('imp-modal'); if(m) m.classList.remove('open'); };

function _apri(titolo, campi, onSalva, nota){
  const m = _modal();
  m.innerHTML = `<div class="modalBox imp-modalbox"><h3>${titolo}</h3>
    ${nota ? `<div class="imp-note">${nota}</div>` : ''}
    ${campi}
    <div class="imp-err" id="imp-modal-err"></div>
    <div class="modalActions">
      <button class="btnSecondary" onclick="window._impChiudi()">Annulla</button>
      <button class="btnPrimary" id="imp-modal-ok" style="flex:1;margin-top:0">Salva</button>
    </div></div>`;
  m.classList.add('open');
  const ok = document.getElementById('imp-modal-ok');
  ok.onclick = async () => {
    const errEl = document.getElementById('imp-modal-err');
    errEl.textContent = '';
    ok.disabled = true; ok.textContent = 'Salvataggio…';
    try{ await onSalva(); window._impChiudi(); }
    catch(e){ errEl.textContent = e.message || String(e); }
    finally{ ok.disabled = false; ok.textContent = 'Salva'; }
  };
  const first = m.querySelector('input:not([disabled]),select');
  if(first) setTimeout(() => first.focus(), 30);
}

const _val = id => (document.getElementById(id)?.value ?? '').trim();

window._impModifica = function(tipo, id){
  if(!_isAdmin()){ window.showToast('Operazione riservata all\'amministratore.','error'); return; }
  if(tipo === 'ribalta') return _formRibalta(id);
  if(tipo === 'posto')   return _formPosto(id);
  if(tipo === 'navetta') return _formNavetta(id);
};

// Ribalta: ID + reparto
function _formRibalta(id){
  const C = window.ParcheggiCore;
  const nuovo = !id;
  const repAtt = nuovo ? '' : (_findRepartoOf(id) || '');
  const order = _cfg.ordine || Object.keys(_cfg.reparti || {});
  const opts = `<option value="">— non assegnata —</option>` + order.map(c =>
    `<option value="${_esc(c)}" ${c===repAtt?'selected':''}>${_esc(_cfg.reparti[c]?.label||c)}</option>`).join('');
  const uso = !nuovo && C.ribaltaAttiva(id) ? _usoRibalta(id) : { uso:false };
  _apri(nuovo ? 'Nuova ribalta' : `Modifica ribalta ${_esc(id)}`, `
    <div class="formGroup"><label>ID ribalta</label>
      <input id="imp-f-id" value="${_esc(id||'')}" placeholder="PNT1-05" spellcheck="false" style="text-transform:uppercase"></div>
    <div class="formGroup"><label>Reparto</label><select id="imp-f-rep">${opts}</select></div>`,
  async () => {
    const nid = _val('imp-f-id').toUpperCase(), rep = _val('imp-f-rep');
    if(!_RE_RIBALTA.test(nid)) throw new Error('Formato ribalta non valido (es. PNT1-05)');
    if(nuovo){
      const tutte = Object.values(_cfg.reparti||{}).flatMap(r => r.ribalte||[]).concat(_cfg.nonAssegnate||[]);
      if(tutte.map(x=>String(x).toUpperCase()).includes(nid)) throw new Error(`Esiste già la ribalta ${nid}`);
    } else if(nid !== id){
      await C.rinominaRibalta(id, nid, window.currentUser);
      await _ricaricaConfig();
    }
    // reparto
    const attuale = _findRepartoOf(nid);
    if(nuovo || attuale !== (rep || null)){
      Object.keys(_cfg.reparti||{}).forEach(k => { _cfg.reparti[k].ribalte = (_cfg.reparti[k].ribalte||[]).filter(x => x !== nid); });
      _cfg.nonAssegnate = (_cfg.nonAssegnate||[]).filter(x => x !== nid);
      if(rep) _cfg.reparti[rep].ribalte = (_cfg.reparti[rep].ribalte||[]).concat(nid).sort(_sortId);
      else _cfg.nonAssegnate = _cfg.nonAssegnate.concat(nid);
      await _saveConfig();
      if(window.logHistory) try{ await window.logHistory({ spot:nid, ribalta:nid, action: nuovo ? 'Ribalta creata' : 'Ribalta modificata', reparto: rep || null }); }catch(e){}
    }
    window.showToast(nuovo ? `Ribalta ${nid} creata` : `Ribalta ${nid} aggiornata`, 'success');
  },
  uso.uso ? `In uso (${_esc(uso.txt)}): puoi cambiare il reparto, ma non l'ID.` : '');
}

// Posto: tutti i campi della tabella
function _formPosto(id){
  const C = window.ParcheggiCore;
  const nuovo = !id;
  const c = nuovo ? { zona: C.zone()[0] || '', ammessi:['container'], stato:'pieno', sotto:1, slide:null } : C.criterio(id);
  const d = nuovo ? { rect:[0,0,30,90] } : C.defPosto(id);
  const v = !nuovo ? (window.spots||{})[id] : null;
  const occupato = !!(v && v.occupanti && v.occupanti.length);
  const zoneOpts = C.zone().map(z => `<option value="${_esc(z)}">${_esc(_cfg.zone?.[z]?.label || z)}</option>`).join('');
  const chk = t => (c.ammessi||[]).includes(t) ? 'checked' : '';
  const [x,y,w,h] = d.rect || [0,0,0,0];
  _apri(nuovo ? 'Nuovo posto' : `Modifica posto ${_esc(id)}`, `
    <div class="imp-grid2">
      <div class="formGroup"><label>ID posto</label><input id="imp-f-id" value="${_esc(id||'')}" placeholder="A25" spellcheck="false" style="text-transform:uppercase"></div>
      <div class="formGroup"><label>Zona</label><input id="imp-f-zona" list="imp-zone-list" value="${_esc(c.zona||'')}" placeholder="ZONA A" style="text-transform:uppercase"><datalist id="imp-zone-list">${zoneOpts}</datalist></div>
    </div>
    <div class="formGroup"><label>Tipi ammessi</label>
      <div class="imp-checks"><label><input type="checkbox" id="imp-f-cont" ${chk('container')}> Container</label>
      <label><input type="checkbox" id="imp-f-cassa" ${chk('cassa')}> Casse</label></div></div>
    <div class="imp-grid3">
      <div class="formGroup"><label>Mezzi</label><select id="imp-f-stato">
        <option value="pieno" ${c.stato==='pieno'?'selected':''}>pieni</option><option value="vuoto" ${c.stato==='vuoto'?'selected':''}>vuoti</option></select></div>
      <div class="formGroup"><label>Sotto-posti</label><select id="imp-f-sotto">
        ${[1,2,3].map(n=>`<option value="${n}" ${c.sotto===n?'selected':''}>${n}</option>`).join('')}</select></div>
      <div class="formGroup"><label>Slide portineria</label><input id="imp-f-slide" type="number" min="1" value="${c.slide ?? ''}"></div>
    </div>
    <div class="formGroup"><label>Rettangolo sulla planimetria (x, y, larghezza, altezza)</label>
      <div class="imp-grid4">
        <input id="imp-f-x" type="number" min="0" value="${x}"><input id="imp-f-y" type="number" min="0" value="${y}">
        <input id="imp-f-w" type="number" min="0" value="${w}"><input id="imp-f-h" type="number" min="0" value="${h}">
      </div></div>`,
  async () => {
    const ammessi = [];
    if(document.getElementById('imp-f-cont').checked) ammessi.push('container');
    if(document.getElementById('imp-f-cassa').checked) ammessi.push('cassa');
    const riga = {
      id: _val('imp-f-id').toUpperCase(), zona: _val('imp-f-zona').toUpperCase(), ammessi,
      stato: _val('imp-f-stato'), sotto: Number(_val('imp-f-sotto')),
      slide: _val('imp-f-slide') === '' ? null : Number(_val('imp-f-slide')),
      rect: ['x','y','w','h'].map(k => Number(_val('imp-f-'+k))),
    };
    await C.salvaPosto(riga, nuovo ? null : id, window.currentUser);
    window.showToast(nuovo ? `Posto ${riga.id} creato` : `Posto ${riga.id} aggiornato`, 'success');
  },
  occupato ? 'Il posto ha mezzi sopra: puoi cambiare zona, pieni/vuoti, slide e rettangolo, ma non ID, tipi ammessi e sotto-posti.' : '');
}

// Navetta: nome (solo alla creazione), posizione, stato
function _formNavetta(id){
  const nuovo = !id;
  const n = nuovo ? { nome:'', posizione:'', stato:'vuoto' } : ((window.navette||{})[id] || { nome:id });
  const ribs = Object.values(window.REPARTI || {}).flat().map(r=>String(r).toUpperCase());
  if(n.posizione && !ribs.includes(n.posizione)) ribs.push(n.posizione);
  const posOpts = `<option value="">— nessuna —</option>` + [...new Set(ribs)].sort(_sortId)
    .map(r => `<option value="${_esc(r)}" ${r===n.posizione?'selected':''}>${_esc(r)}</option>`).join('');
  const statoOpts = ['vuoto','pieno','in_missione'].map(s => `<option value="${s}" ${n.stato===s?'selected':''}>${s.replace('_',' ')}</option>`).join('');
  _apri(nuovo ? 'Nuova navetta' : `Modifica navetta ${_esc(id)}`, `
    <div class="formGroup"><label>Nome</label><input id="imp-f-id" value="${_esc(n.nome||'')}" placeholder="NAV3" spellcheck="false" style="text-transform:uppercase" ${nuovo?'':'disabled'}></div>
    <div class="formGroup"><label>Posizione (ribalta)</label><select id="imp-f-pos">${posOpts}</select></div>
    <div class="formGroup"><label>Stato</label><select id="imp-f-stato">${statoOpts}</select></div>`,
  async () => {
    const NC = window.NavetteCore;
    if(!NC) throw new Error('Modulo navette non caricato');
    const pos = _val('imp-f-pos') || null, stato = _val('imp-f-stato');
    if(nuovo){
      const nome = _val('imp-f-id').toUpperCase();
      if(!nome) throw new Error('Inserisci il nome (es. NAV3)');
      await NC.creaNavetta({ nome, posizione: pos, stato });
      window.showToast(`Navetta ${nome} creata`, 'success');
    } else {
      if((pos||null) !== (n.posizione||null)) await NC.aggiornaNavetta(id, { posizione: pos });
      if(stato !== n.stato) await NC.setStatoManuale(id, stato);
      window.showToast(`Navetta ${id} aggiornata`, 'success');
    }
  },
  nuovo ? '' : 'Lo stato si aggiorna da solo con le missioni: cambialo a mano solo per correggere un errore. Il nome non si può cambiare.');
}

window.initImpostazioniConfig = initImpostazioniConfig;
window.stopImpostazioni = stopImpostazioni;

// Stili del tab (iniettati una sola volta)
(function _injectCss(){
  if(document.getElementById('imp-css')) return;
  const s = document.createElement('style'); s.id='imp-css';
  s.textContent = `
  #pageImpostazioni .imp-section{margin-bottom:26px}
  #pageImpostazioni .imp-section-title{font-size:16px;font-weight:600;margin:0 0 12px;color:var(--text)}
  .imp-note{font-size:12px;color:var(--muted,#94a3b8);background:var(--surface2,#1e2430);
    border:1px solid var(--border,#2a3140);border-radius:8px;padding:8px 12px;margin-bottom:12px;line-height:1.45}
  .imp-note.warn{border-color:#f59e0b55;color:#f5c26b}
  #pageImpostazioni .imp-cols{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px}
  @media (max-width:900px){ #pageImpostazioni .imp-cols{grid-template-columns:1fr} }
  #pageImpostazioni .imp-card{background:var(--surface,#161b22);border:1px solid var(--border,#2a3140);border-radius:10px;padding:12px 14px}
  #pageImpostazioni .imp-card-title{font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--muted);margin-bottom:8px;text-transform:uppercase}
  #pageImpostazioni .imp-chips{display:flex;flex-wrap:wrap;gap:6px}
  #pageImpostazioni .imp-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  #pageImpostazioni .imp-pills,#pageImpostazioni .imp-add{display:flex;gap:6px;flex-wrap:wrap}
  #pageImpostazioni .imp-add{margin-left:auto}
  #pageImpostazioni .imp-pill{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;
    color:var(--text);font-family:inherit;font-size:13px;cursor:pointer}
  #pageImpostazioni .imp-pill small{color:var(--muted);font-size:11px;margin-left:3px}
  #pageImpostazioni .imp-pill.active{background:#A4D20022;border-color:#A4D20088;color:var(--accent)}
  #pageImpostazioni .imp-search{flex:1;min-width:200px;max-width:340px}
  #pageImpostazioni .inputField{border-radius:8px;border:1px solid var(--border);padding:7px 10px;font-family:inherit;font-size:13px;
    background:var(--surface2);color:var(--text);outline:none}
  #pageImpostazioni .inputField:focus{border-color:var(--accent)}
  #pageImpostazioni .imp-addrep{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  #pageImpostazioni .imp-addrep .inputField{flex:1;min-width:140px}
  #pageImpostazioni .imp-tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px}
  #pageImpostazioni .imp-table{width:100%;border-collapse:collapse;font-family:'DM Sans',sans-serif;font-size:13px}
  #pageImpostazioni .imp-table th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
    color:var(--muted);padding:9px 10px;background:var(--surface2);position:sticky;top:0}
  #pageImpostazioni .imp-table td{padding:7px 10px;border-top:1px solid var(--border);vertical-align:middle}
  #pageImpostazioni .imp-table.compact td{padding:5px 6px;border-top:none}
  #pageImpostazioni .imp-table tr.is-off td{opacity:.55}
  #pageImpostazioni .imp-table tr.is-off td.imp-azioni{opacity:1}
  #pageImpostazioni .imp-table tbody tr:hover td{background:#ffffff06}
  #pageImpostazioni .mono{font-family:'DM Mono',monospace;font-weight:500}
  #pageImpostazioni .muted{color:var(--muted)}
  #pageImpostazioni .imp-azioni{white-space:nowrap;text-align:right}
  .imp-act{background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:5px 10px;margin-left:4px;
    color:var(--text);font-family:inherit;font-size:12px;cursor:pointer}
  .imp-act:hover{border-color:var(--accent)}
  .imp-act.danger{color:var(--red);border-color:#ef444440}
  .imp-act.danger:hover{background:#ef444418}
  .imp-act.primary{background:#A4D20018;border-color:#A4D20066;color:var(--accent);margin-left:0}
  #pageImpostazioni .imp-tipo{font-size:11px;font-weight:700;border-radius:5px;padding:2px 7px;letter-spacing:.03em}
  #pageImpostazioni .imp-tipo.ribalta{background:#3b82f620;color:#7fb0ff}
  #pageImpostazioni .imp-tipo.posto{background:#A4D20020;color:var(--accent)}
  #pageImpostazioni .imp-tipo.navetta{background:#f59e0b20;color:var(--orange)}
  #pageImpostazioni .imp-badge{font-size:11px;font-weight:600;border-radius:20px;padding:2px 8px}
  #pageImpostazioni .imp-badge.on{background:#A4D20020;color:var(--accent)}
  #pageImpostazioni .imp-badge.off{background:#ef444420;color:var(--red)}
  #pageImpostazioni .imp-uso{font-size:12px;color:var(--muted);margin-left:4px}
  #pageImpostazioni .imp-uso.busy{color:var(--orange)}
  .imp-modalbox{max-width:520px}
  .imp-modalbox .formGroup{margin-bottom:12px}
  .imp-modalbox .formGroup input,.imp-modalbox .formGroup select{width:100%;background:var(--surface2);border:1px solid var(--border);
    border-radius:8px;padding:9px 10px;color:var(--text);font-family:inherit;font-size:14px;outline:none}
  .imp-modalbox .formGroup input:disabled{opacity:.6}
  .imp-modalbox .imp-checks{display:flex;gap:18px}
  .imp-modalbox .imp-checks label{display:flex;align-items:center;gap:6px;text-transform:none;font-size:14px;color:var(--text);letter-spacing:0;margin:0}
  .imp-modalbox .imp-checks input{width:auto}
  .imp-modalbox .imp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .imp-modalbox .imp-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
  .imp-modalbox .imp-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .imp-err{color:var(--red);font-size:13px;min-height:4px;margin-top:4px}
  `;
  document.head.appendChild(s);
})();
