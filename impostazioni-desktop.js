// ── impostazioni-desktop.js ─ Tab Impostazioni magazzino (solo amministratore) ──
// Migra la config del magazzino (reparti → ribalte, zone → parcheggi) su Firestore
// nel documento config/magazzino. Fallback sui dati statici di spots-data-desktop.js
// (window.REPARTI / window.ZONES / window.SPOT_DEFS) se il documento non esiste.
import { doc, getDoc, setDoc, onSnapshot }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CFG_REF = () => doc(window.db, 'config', 'magazzino');

// Etichette di default per i reparti conosciuti (per il primo seed)
const _DEFAULT_REPARTO_LABELS = {
  'RICEVIMENTO': 'Ricevimento', 'SPEDIZIONI': 'Spedizioni', 'CAPI APPESI': 'Capi appesi',
  'LAV MAN': 'Lav man', 'REVERSE': 'Reverse', 'ESTERO': 'Estero',
  'E-COMMERCE': 'E-commerce', 'TGW': 'TGW'
};
const _DEFAULT_ZONE = {
  'ZONA A': { label: 'P Verde (A)', tipo: 'container' },
  'ZONA B': { label: 'P Blu (B)',   tipo: 'cassa' },
  'ZONA C': { label: 'Zona C',      tipo: 'cassa' },
  'ZONA D': { label: 'Zona D',      tipo: 'cassa' },
};

const _RE_RIBALTA = /^PNT[12]-\d{2}$/;

let _cfg = null;          // copia locale della config Firestore
let _unsub = null;        // unsubscribe listener
let _seeding = false;

function _titleCase(s){ return s.toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()); }

// Costruisce la config di default a partire dai dati statici
function _buildDefaultConfig(){
  const reparti = {}, ordine = [];
  Object.keys(window.REPARTI || {}).forEach(code => {
    reparti[code] = {
      label: _DEFAULT_REPARTO_LABELS[code] || _titleCase(code),
      ribalte: (window.REPARTI[code] || []).slice()
    };
    ordine.push(code);
  });
  const zone = {};
  Object.keys(window.ZONES || {}).forEach(z => {
    zone[z] = {
      label: (_DEFAULT_ZONE[z] && _DEFAULT_ZONE[z].label) || z,
      tipo:  (_DEFAULT_ZONE[z] && _DEFAULT_ZONE[z].tipo)  || 'cassa'
    };
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
  window.REPARTI = REPARTI;
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

// ── Caricamento / listener config ──────────────────────────────────────────────
async function initImpostazioniConfig(){
  if(_unsub) return;                       // già inizializzato
  try{
    const snap = await getDoc(CFG_REF());
    if(!snap.exists()){
      // Primo avvio: seed dai dati statici (solo amministratore può scrivere)
      _cfg = _buildDefaultConfig();
      if(window.currentUser && window.currentUser.role === 'amministratore'){
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
    // completa eventuali zone mancanti (per never-used) dai dati statici
    _cfg.zone = _cfg.zone || {};
    Object.keys(window.ZONES || {}).forEach(z => { if(!_cfg.zone[z]) _cfg.zone[z] = { label:z, tipo:(_DEFAULT_ZONE[z]?.tipo||'cassa') }; });
    _applyToGlobals(_cfg);
    _refreshDependents();
  }, ()=>{});
}
function stopImpostazioni(){ if(_unsub){ _unsub(); _unsub=null; } }

async function _saveConfig(){
  if(!_cfg) return;
  if(!window.currentUser || window.currentUser.role !== 'amministratore'){
    window.showToast('Solo un amministratore può modificare la configurazione', 'error');
    return;
  }
  try{
    _cfg.ordine = _cfg.ordine || Object.keys(_cfg.reparti || {});
    await setDoc(CFG_REF(), _cfg);
    // il listener onSnapshot aggiorna globals e viste
  }catch(e){
    window.showToast('Errore salvataggio: ' + e.message, 'error');
  }
}

// ── Operazioni sui reparti / ribalte ───────────────────────────────────────────
function _findRepartoOf(code){
  const rr = _cfg.reparti || {};
  return Object.keys(rr).find(k => (rr[k].ribalte || []).includes(code));
}

function _dropFromNonAssegnate(code){
  if(_cfg.nonAssegnate) _cfg.nonAssegnate = _cfg.nonAssegnate.filter(x=>x!==code);
}

window._impAddRibalta = function(repCode, inputId){
  const el = document.getElementById(inputId);
  if(!el) return;
  const val = (el.value || '').trim().toUpperCase();
  if(!val) return;
  if(!_RE_RIBALTA.test(val)){
    window.showToast('Formato ribalta non valido (es. PNT1-05)', 'error'); return;
  }
  const prev = _findRepartoOf(val);
  if(prev === repCode){ el.value=''; return; }
  if(prev){ _cfg.reparti[prev].ribalte = _cfg.reparti[prev].ribalte.filter(x=>x!==val); }
  _dropFromNonAssegnate(val);
  _cfg.reparti[repCode].ribalte = (_cfg.reparti[repCode].ribalte || []).concat(val)
      .sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}));
  el.value='';
  _saveConfig();
};

window._impRemoveRibalta = function(repCode, code){
  if(!_cfg.reparti[repCode]) return;
  _cfg.reparti[repCode].ribalte = (_cfg.reparti[repCode].ribalte || []).filter(x=>x!==code);
  _cfg.nonAssegnate = (_cfg.nonAssegnate || []).filter(x=>x!==code).concat(code);
  _saveConfig();
};

window._impAssignRibalta = function(code, selId){
  const sel = document.getElementById(selId);
  if(!sel || !sel.value) return;
  const target = sel.value;
  const prev = _findRepartoOf(code);
  if(prev) _cfg.reparti[prev].ribalte = _cfg.reparti[prev].ribalte.filter(x=>x!==code);
  _dropFromNonAssegnate(code);
  _cfg.reparti[target].ribalte = (_cfg.reparti[target].ribalte || []).concat(code)
      .sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}));
  _saveConfig();
};

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
  _saveConfig();
};

window._impRenameReparto = function(code){
  const cur = _cfg.reparti[code]?.label || '';
  const nl = prompt('Nuova etichetta per il reparto ' + code + ':', cur);
  if(nl===null) return;
  const v = nl.trim();
  if(!v) return;
  _cfg.reparti[code].label = v;
  _saveConfig();
};

window._impDeleteReparto = function(code){
  const n = (_cfg.reparti[code]?.ribalte || []).length;
  if(!confirm('Eliminare il reparto "'+(_cfg.reparti[code]?.label||code)+'"?\n'
      + (n ? ('Le sue '+n+' ribalte diventeranno "non assegnate".') : '') )) return;
  delete _cfg.reparti[code];
  _cfg.ordine = (_cfg.ordine || []).filter(x=>x!==code);
  _saveConfig();
};

window._impRenameZona = function(z){
  const cur = (_cfg.zone?.[z]?.label) || z;
  const nl = prompt('Etichetta per la zona ' + z + ':', cur);
  if(nl===null) return;
  _cfg.zone = _cfg.zone || {};
  _cfg.zone[z] = _cfg.zone[z] || { tipo: (_DEFAULT_ZONE[z]?.tipo||'cassa') };
  _cfg.zone[z].label = nl.trim() || z;
  _saveConfig();
};

// Opzioni <option> per i dropdown reparto (usato anche da admin-desktop.js)
window._repartoOptionsHTML = function(selected){
  const order = window.REPARTI_ORDER || Object.keys(window.REPARTI || {});
  const labels = window.REPARTI_LABELS || {};
  const esc = window._esc || (s=>s);
  let out = '<option value="" '+(!selected?'selected':'')+'>— Reparto —</option>';
  order.forEach(code=>{
    out += '<option value="'+esc(code)+'" '+(selected===code?'selected':'')+'>'+esc(labels[code]||code)+'</option>';
  });
  return out;
};

function _populateNewUserReparto(){
  const sel = document.getElementById('newUserReparto');
  if(sel) sel.innerHTML = window._repartoOptionsHTML('');
}
window._populateNewUserReparto = _populateNewUserReparto;

// ── Render del tab ─────────────────────────────────────────────────────────────
function renderImpostazioni(){
  const wrap = document.getElementById('pageImpostazioni');
  if(!wrap) return;
  if(!_cfg){
    wrap.querySelector('#imp-body').innerHTML =
      '<div style="color:var(--muted);font-size:13px">Caricamento configurazione…</div>';
    return;
  }
  const esc = window._esc || (s=>s);
  const order = _cfg.ordine || Object.keys(_cfg.reparti || {});

  // Reparti + ribalte
  let repHTML = order.map(code=>{
    const r = _cfg.reparti[code]; if(!r) return '';
    const chips = (r.ribalte||[]).map(rb =>
      '<span class="imp-chip">'+esc(rb)+
      '<button class="imp-chip-x" title="Rimuovi" onclick="window._impRemoveRibalta(\''+esc(code)+'\',\''+esc(rb)+'\')">&times;</button></span>'
    ).join('') || '<span style="color:var(--muted);font-size:12px">Nessuna ribalta</span>';
    const inId = 'imp-add-'+code.replace(/\W/g,'_');
    return `
    <div class="imp-card">
      <div class="imp-card-head">
        <div><span class="imp-rep-label">${esc(r.label||code)}</span>
          <span class="imp-rep-code">${esc(code)}</span>
          <span class="imp-count">${(r.ribalte||[]).length} ribalte</span></div>
        <div>
          <button class="btnEdit" title="Rinomina" onclick="window._impRenameReparto('${esc(code)}')">✏️</button>
          <button class="btnDanger" title="Elimina reparto" onclick="window._impDeleteReparto('${esc(code)}')">🗑</button>
        </div>
      </div>
      <div class="imp-chips">${chips}</div>
      <div class="imp-addrow">
        <input id="${inId}" class="inputField" placeholder="PNT1-05" spellcheck="false"
          onkeydown="if(event.key==='Enter')window._impAddRibalta('${esc(code)}','${inId}')">
        <button class="btnSecondary" onclick="window._impAddRibalta('${esc(code)}','${inId}')">+ Aggiungi</button>
      </div>
    </div>`;
  }).join('');

  // Ribalte non assegnate (buffer persistente meno quelle già riassegnate)
  const assigned = new Set();
  order.forEach(c => (_cfg.reparti[c]?.ribalte||[]).forEach(x=>assigned.add(x)));
  const naSet = new Set((_cfg.nonAssegnate||[]).filter(x=>!assigned.has(x)));
  const repSelOpts = order.map(c=>'<option value="'+esc(c)+'">'+esc(_cfg.reparti[c]?.label||c)+'</option>').join('');
  let naHTML = '';
  if(naSet.size){
    naHTML = '<div class="imp-card"><div class="imp-card-head"><div><span class="imp-rep-label">Non assegnate</span>'
      +'<span class="imp-count">'+naSet.size+'</span></div></div><div class="imp-chips">'
      + [...naSet].map(rb=>{
          const sid='imp-na-'+rb.replace(/\W/g,'_');
          return '<span class="imp-chip">'+esc(rb)+' <select id="'+sid+'" class="roleSelect" style="height:24px;padding:0 4px" onchange="window._impAssignRibalta(\''+esc(rb)+'\',\''+sid+'\')"><option value="">→…</option>'+repSelOpts+'</select></span>';
        }).join('')
      + '</div></div>';
  }

  // Zone / parcheggi (overview; label editabile)
  const zone = _cfg.zone || {};
  const zoneHTML = Object.keys(window.ZONES||{}).map(z=>{
    const spots = (window.ZONES[z]||[]);
    const meta = zone[z] || {label:z, tipo:'cassa'};
    return `
    <div class="imp-card">
      <div class="imp-card-head">
        <div><span class="imp-rep-label">${esc(meta.label||z)}</span>
          <span class="imp-rep-code">${esc(z)}</span>
          <span class="imp-count">${spots.length} posti · ${esc(meta.tipo||'cassa')}</span></div>
        <button class="btnEdit" title="Rinomina zona" onclick="window._impRenameZona('${esc(z)}')">✏️</button>
      </div>
      <div class="imp-chips">${spots.map(s=>'<span class="imp-chip imp-chip-ro">'+esc(s)+'</span>').join('')}</div>
    </div>`;
  }).join('');

  wrap.querySelector('#imp-body').innerHTML = `
    <div class="imp-section">
      <div class="imp-section-title">Reparti e ribalte</div>
      <div class="imp-addrep">
        <input id="imp-new-rep-code"  class="inputField" placeholder="CODICE (es. PACKING)" spellcheck="false" style="text-transform:uppercase">
        <input id="imp-new-rep-label" class="inputField" placeholder="Etichetta (es. Packing)">
        <button class="btnPrimary" style="margin-top:0" onclick="window._impAddReparto()">+ Nuovo reparto</button>
      </div>
      ${repHTML}
      ${naHTML}
    </div>
    <div class="imp-section">
      <div class="imp-section-title">Parcheggi e zone</div>
      <div class="imp-note">Gli ID posto e le coordinate sono legati alla planimetria e ai criteri della portineria:
        qui è modificabile solo l'etichetta della zona. La gestione strutturale dei posti richiede l'editor sulla mappa.</div>
      ${zoneHTML}
    </div>`;
}
window.renderImpostazioni = renderImpostazioni;
window.initImpostazioniConfig = initImpostazioniConfig;
window.stopImpostazioni = stopImpostazioni;

// Stili minimi del tab (iniettati una sola volta)
(function _injectCss(){
  if(document.getElementById('imp-css')) return;
  const s = document.createElement('style'); s.id='imp-css';
  s.textContent = `
  #pageImpostazioni .imp-section{margin-bottom:26px}
  #pageImpostazioni .imp-section-title{font-size:16px;font-weight:600;margin:0 0 12px;color:var(--text)}
  #pageImpostazioni .imp-note{font-size:12px;color:var(--muted,#94a3b8);background:var(--surface2,#1e2430);
    border:1px solid var(--border,#2a3140);border-radius:8px;padding:8px 12px;margin-bottom:12px}
  #pageImpostazioni .imp-card{background:var(--surface,#161b22);border:1px solid var(--border,#2a3140);
    border-radius:10px;padding:12px 14px;margin-bottom:10px}
  #pageImpostazioni .imp-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
  #pageImpostazioni .imp-rep-label{font-weight:600;font-size:15px}
  #pageImpostazioni .imp-rep-code{font-size:11px;color:var(--muted,#94a3b8);margin-left:8px;
    border:1px solid var(--border,#2a3140);border-radius:4px;padding:1px 6px}
  #pageImpostazioni .imp-count{font-size:12px;color:var(--muted,#94a3b8);margin-left:8px}
  #pageImpostazioni .imp-chips{display:flex;flex-wrap:wrap;gap:6px}
  #pageImpostazioni .imp-chip{display:inline-flex;align-items:center;gap:4px;background:var(--surface2,#1e2430);
    border:1px solid var(--border,#2a3140);border-radius:6px;padding:2px 6px;font-size:12px;font-family:var(--mono,monospace)}
  #pageImpostazioni .imp-chip-ro{opacity:.85}
  #pageImpostazioni .imp-chip-x{background:none;border:none;color:var(--red,#ef4444);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
  #pageImpostazioni .imp-addrow,#pageImpostazioni .imp-addrep{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  #pageImpostazioni .imp-addrow .inputField{max-width:160px}
  #pageImpostazioni .imp-addrep .inputField{max-width:220px}
  `;
  document.head.appendChild(s);
})();
