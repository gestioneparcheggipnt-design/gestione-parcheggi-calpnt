// ── MAP-RENDERER.JS ─────────────────────────────────────────────────────────
function initPanZoom(){
  const vp=document.getElementById("mapViewport");
  vp.addEventListener("wheel",e=>{
    e.preventDefault();
    const r=vp.getBoundingClientRect();
    zoom(e.deltaY<0?0.2:-0.2,e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  vp.addEventListener("mousedown",e=>{
    if(e.button!==0)return;
    window.isPanning=true; window.pSX=e.clientX; window.pSY=e.clientY; window.pSPX=window.panX; window.pSPY=window.panY;
    vp.style.cursor="grabbing";
  });
  window.addEventListener("mousemove",e=>{
    if(!window.isPanning)return;
    window.panX=window.pSPX+(e.clientX-window.pSX); window.panY=window.pSPY+(e.clientY-window.pSY); window.clampP(); window.applyT();
  });
  window.addEventListener("mouseup",()=>{
    window.isPanning=false;
    const v=document.getElementById("mapViewport"); if(v) v.style.cursor="grab";
  });
  let ld=null,lmx=0,lmy=0,t1x=0,t1y=0;
  vp.addEventListener("touchstart",e=>{
    if(e.touches.length===2){
      const a=e.touches[0],b=e.touches[1];
      ld=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
      const r=vp.getBoundingClientRect();
      lmx=((a.clientX+b.clientX)/2)-r.left; lmy=((a.clientY+b.clientY)/2)-r.top;
    }else{ t1x=e.touches[0].clientX; t1y=e.touches[0].clientY; window.pSPX=window.panX; window.pSPY=window.panY; }
  },{passive:true});
  vp.addEventListener("touchmove",e=>{
    e.preventDefault();
    if(e.touches.length===2){
      const a=e.touches[0],b=e.touches[1];
      const d=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
      if(ld) zoom((d-ld)*0.012,lmx,lmy); ld=d;
    }else{
      window.panX=window.pSPX+(e.touches[0].clientX-t1x);
      window.panY=window.pSPY+(e.touches[0].clientY-t1y);
      window.clampP(); window.applyT();
    }
  },{passive:false});
  vp.addEventListener("touchend",()=>{ ld=null; });
}


// ââ MAPPA âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

// Riconosce tipo mezzo dal plate
function _tipoMezzo(plate) {
  if (!plate) return null;
  if (/^\d{3}$/.test(plate)) return 'cassa';
  if (window.RE_CONTAINER.test(plate)) return 'container';
  return null;
}
function _labelMezzo(plate) {
  const t = _tipoMezzo(plate);
  if (t === 'cassa')     return { label: 'Cassa',     icon: '&#x1F4E6;' };
  if (t === 'container') return { label: 'Container', icon: '&#x1F69B;' };
  return { label: 'Mezzo', icon: '&#x1F697;' };
}

function initMap(){
  const img=document.getElementById("mapImg"),vp=document.getElementById("mapViewport");
if(img.complete){ renderMap(); initPanZoom(); }
  else { img.onload=()=>{ renderMap(); initPanZoom(); }; }
}

function renderMap(){
  const svg=document.getElementById("mapSvg");
  svg.setAttribute("viewBox",`0 0 ${window.IMG_W} ${window.IMG_H}`);
  let s="";
  window.PATCHES.forEach(([px,py,pw,ph])=>{ s+=`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="white"/>`; });
  window.SPOT_DEFS.forEach(([id,,px,py,pw,ph])=>{
    const sp=window.spots[id]; if(!sp) return;
    const cls=sp.statoOcc==='pieno'?"occupied":sp.statoOcc==='parziale'?"partial":"free";
    const hl=window.selectedSpotId===id?" highlight":"";
    const unusCls=(sp.inutilizzabile||(sp.occupanti||[]).some(o=>o.unusable))?" unusable":"";
    const cx=px+pw/2, cy=py+ph/2, fs=Math.min(pw,ph)*0.44;
    s+=`<g class="spot ${cls}${unusCls}${hl}" onclick="window._selectSpot('${id}')" data-id="${id}">` +
       `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="2"/>` +
       `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" style="font-size:${fs.toFixed(1)}px">${id}</text>` +
       `</g>`;
  });
  svg.innerHTML=s;
}

// Formattazione durata per il pannello mappa
function _fmtDurMap(ts){
  if(!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const ms = Date.now() - d.getTime();
  if(ms < 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  const days  = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins  = totalMin % 60;
  if(days  > 0) return days  + 'g ' + hours + 'h ' + mins + 'min';
  if(hours > 0) return hours + 'h ' + mins + 'min';
  return mins + 'min';
}
function _fmtDateMap(ts){
  if(!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

// Quota sicura per argomenti stringa negli onclick inline
function _q(v){ return "'" + String(v ?? '').replace(/[\\'"<>&]/g,'') + "'"; }
function _escM(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Badge di stato del posto: Libero / 1 di 2 occupati / Occupato
function _badgePosto(sp){
  if(sp.statoOcc==='libero') return '<span class="statusBadge free">&#9679; Libero</span>';
  if(sp.statoOcc==='parziale') return `<span class="statusBadge partial">&#9679; Parziale · ${sp.sotto - sp.slotLiberi.length}/${sp.sotto}</span>`;
  return '<span class="statusBadge occupied">&#9679; Occupato</span>';
}

// Scheda di un mezzo parcheggiato, con le sue azioni
function _schedaMezzo(id, o, perm){
  const ml = _labelMezzo(o.plate);
  const P  = _q(o.plate);
  const rowStyle = 'margin-top:6px;font-size:14px;color:var(--text);font-weight:400;';
  const valStyle = 'color:var(--text);font-family:"DM Mono",monospace;font-size:14px;font-weight:500;';
  const fullBadge = o.full
    ? '<span style="color:#f59e0b;font-weight:500;font-size:14px">&#x1F7E1; Piena/o</span>'
    : '<span style="color:#22c55e;font-weight:500;font-size:14px">&#x1F7E2; Vuota/o</span>';
  return `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:6px;line-height:2">
      <div style="${rowStyle}">${ml.icon} ${ml.label}: <span style="${valStyle}">${_escM(o.plate)}</span></div>
      ${o.damaged ? `<div style="color:#ef4444;font-size:14px;font-weight:500;margin-top:4px">&#9888;&#65039; Veicolo danneggiato</div>` : ''}
      ${o.unusable ? `<div style="color:#a78bfa;font-size:14px;font-weight:500;margin-top:4px">&#x1F6AB; Veicolo inutilizzabile</div>` : ''}
      <div style="${rowStyle}">Stato: ${fullBadge}</div>
      <div style="${rowStyle}">Da: <span style="${valStyle}">${_fmtDateMap(o.since)}</span></div>
      <div style="${rowStyle}">Durata: <span style="color:var(--accent);font-size:14px;font-weight:500">${_fmtDurMap(o.since)}</span></div>
      <div style="${rowStyle}">Utente: <span style="color:var(--text);font-size:13px">${_escM(o.user || '—')}</span></div>
    </div>
    ${o.full
      ? `<button class="fullToggleBtn pieno" style="margin-top:12px" onclick="window._toggleFull('${id}',false,${P})">&#x1F7E2; Segna come Vuota/o</button>`
      : `<button class="fullToggleBtn vuoto" style="margin-top:12px" onclick="window._toggleFull('${id}',true,${P})">&#x1F7E1; Segna come Piena/o</button>`}
    ${perm.unusable ? (o.unusable
      ? `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9)" onclick="window._removeUnusable('${id}',${P})">&#10003; Rimuovi inutilizzabile</button>`
      : o.damaged
        ? `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#f59e0b,#d97706)" onclick="window._removeDamaged('${id}',${P})">&#10003; Rimuovi segnalazione guasto</button>`
        : `<span>
            <button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#ef4444,#dc2626)" onclick="window._addDamaged('${id}',${P})">&#9888;&#65039; Segna come guasto</button>
            <button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9)" onclick="window._addUnusable('${id}',${P})">&#x1F6AB; Segna come inutilizzabile</button>
           </span>`)
    : ''}
    ${perm.gestire ? `<button class="btnFreeInline" style="background:#fff;color:#1C1F26;border:1px solid var(--border);font-weight:700;margin-top:8px" onclick="window._freeSpot('${id}',${P})">&#10005; Libera ${_escM(o.plate)}</button>` : ''}`;
}

function selectSpot(id){
  if(!id) return;
  window.selectedSpotId=id; renderMap();
  const sp=window.spots[id], panel=document.getElementById("spotPanel");
  if(!sp){ return; }
  const role = window.currentUser && window.currentUser.role;
  const perm = {
    gestire:  role === 'amministratore',
    unusable: role === 'amministrativo' || role === 'amministratore',
    assegna:  role === 'autista' || role === 'amministratore',
  };
  const tipoMode = window.currentMode === 'cassa' ? 'cassa' : 'container';
  const placeholderInput = tipoMode === 'cassa' ? 'Es. 001' : 'Es. ABCD1234567 / AB123CD';
  const inputLabel = tipoMode === 'cassa' ? 'Numero cassa' : 'ID Container';
  const ammessiTxt = sp.ammessi.map(t => t === 'cassa' ? 'casse' : 'container').join(' / ');
  const capienza = sp.sotto > 1 ? ` · ${sp.sotto} sotto-posti` : '';

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
      <h3 style="margin:0;color:var(--text);font-size:16px">${id}</h3>
      <button onclick="window._cancelSelect()" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1">&#10005;</button>
    </div>
    ${_badgePosto(sp)}
    ${perm.gestire && window._impModifica ? `<button class="imp-act" style="float:right;margin-top:-2px" title="Modifica caratteristiche e posizione" onclick="window._impModifica('posto','${id}')">✏️ Modifica</button>` : ''}
    <div style="color:var(--muted);font-size:12px;margin-top:-4px">Accetta: ${ammessiTxt}${capienza} · ${sp.statoPosto === 'pieno' ? 'mezzi pieni' : 'mezzi vuoti'}</div>`;

  if (sp.inutilizzabile) {
    html += `<div style="color:#a78bfa;font-size:14px;font-weight:600;margin-top:10px">&#x1F6AB; Posto segnato come inutilizzabile</div>`;
    if (perm.unusable) html += `<button class="fullToggleBtn" style="margin-top:8px;background:linear-gradient(135deg,#7c3aed,#6d28d9)" onclick="window._sbloccaPosto('${id}')">&#10003; Rimuovi stato inutilizzabile</button>`;
  }

  (sp.occupanti || []).forEach(o => { html += _schedaMezzo(id, o, perm); });

  // Form di assegnazione: solo se il posto può ancora ricevere un mezzo del tipo in vista
  const puoRicevere = window.ParcheggiCore.disponibilePer(sp, tipoMode);
  if (puoRicevere && perm.assegna) {
    html += `<div style="${sp.occupanti.length ? 'border-top:1px solid var(--border);margin-top:14px;padding-top:6px' : ''}">
      <div class="formGroup" style="margin-bottom:9px;margin-top:12px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">${inputLabel}</label>
        <input class="plateInput" id="inlineplate" type="text" placeholder="${placeholderInput}" maxlength="15"
          oninput="this.value=this.value.toUpperCase()"
          onkeydown="if(event.key==='Enter')window._inlineAssign('${id}')">
      </div>
      <label style="display:flex;align-items:center;gap:9px;font-size:14px;color:var(--text);margin-bottom:9px;cursor:pointer;user-select:none;">
        <input type="checkbox" id="inlineDamaged" style="width:16px;height:16px;accent-color:#ef4444;cursor:pointer;">
        <span>&#9888;&#65039; Veicolo danneggiato</span>
      </label>
      <label style="display:flex;align-items:center;gap:9px;font-size:14px;color:var(--text);margin-bottom:13px;cursor:pointer;user-select:none;">
        <input type="checkbox" id="inlineFull" style="width:16px;height:16px;accent-color:#f59e0b;cursor:pointer;">
        <span>&#x1F7E1; Piena/o (carico completo)</span>
      </label>
      <button class="btnAssign" onclick="window._inlineAssign('${id}')">&#10003; Assegna</button>
    </div>`;
  } else if (!sp.occupanti.length && !perm.assegna) {
    html += `<div style="color:var(--muted);font-size:13px;margin-top:10px">Solo gli autisti possono assegnare veicoli.</div>`;
  } else if (!sp.occupanti.length && !sp.ammessi.includes(tipoMode)) {
    html += `<div style="color:var(--muted);font-size:13px;margin-top:10px">Il posto non accetta ${tipoMode === 'cassa' ? 'casse' : 'container'}: cambia modalità per assegnare.</div>`;
  }
  panel.innerHTML = html;
  if (puoRicevere && perm.assegna) setTimeout(()=>document.getElementById("inlineplate")?.focus(),50);
}

// Rimuove il blocco temporaneo del posto (segnato dal mobile)
window._sbloccaPosto = async function(id){
  try{
    await window.ParcheggiCore.impostaInutilizzabile(id, false);
    await window.logHistory({ spot:id, action:'Posto inutilizzabile rimosso', plate:null });
    window.showToast(`Stato inutilizzabile rimosso per ${id}`, 'success');
    selectSpot(id);
  }catch(e){ window.showToast('Errore: '+e.message, 'error'); }
};

// Esponi per onclick SVG
window._selectSpot   = selectSpot;

window.initMap = initMap;
window.renderMap = renderMap;
window.selectSpot = selectSpot;
