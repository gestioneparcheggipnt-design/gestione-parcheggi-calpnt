function initPanZoom(){
  const vp=document.getElementById("mapViewport");
  vp.addEventListener("wheel",e=>{
    e.preventDefault();
    const r=vp.getBoundingClientRect();
    zoom(e.deltaY<0?0.2:-0.2,e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  vp.addEventListener("mousedown",e=>{
    if(e.button!==0)return;
    isPanning=true; pSX=e.clientX; pSY=e.clientY; pSPX=panX; pSPY=panY;
    vp.style.cursor="grabbing";
  });
  window.addEventListener("mousemove",e=>{
    if(!isPanning)return;
    panX=pSPX+(e.clientX-pSX); panY=pSPY+(e.clientY-pSY); clampP(); applyT();
  });
  window.addEventListener("mouseup",()=>{
    isPanning=false;
    const v=document.getElementById("mapViewport"); if(v) v.style.cursor="grab";
  });
  let ld=null,lmx=0,lmy=0,t1x=0,t1y=0;
  vp.addEventListener("touchstart",e=>{
    if(e.touches.length===2){
      const a=e.touches[0],b=e.touches[1];
      ld=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
      const r=vp.getBoundingClientRect();
      lmx=((a.clientX+b.clientX)/2)-r.left; lmy=((a.clientY+b.clientY)/2)-r.top;
    }else{ t1x=e.touches[0].clientX; t1y=e.touches[0].clientY; pSPX=panX; pSPY=panY; }
  },{passive:true});
  vp.addEventListener("touchmove",e=>{
    e.preventDefault();
    if(e.touches.length===2){
      const a=e.touches[0],b=e.touches[1];
      const d=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
      if(ld) zoom((d-ld)*0.012,lmx,lmy); ld=d;
    }else{
      panX=pSPX+(e.touches[0].clientX-t1x);
      panY=pSPY+(e.touches[0].clientY-t1y);
      clampP(); applyT();
    }
  },{passive:false});
  vp.addEventListener("touchend",()=>{ ld=null; });
}


// ââ MAPPA âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

// Riconosce tipo mezzo dal plate
function _tipoMezzo(plate) {
  if (!plate) return null;
  if (/^\d{3}$/.test(plate)) return 'cassa';
  if (/^[A-Z]{4}\d{7}$/.test(plate)) return 'container';
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
  if(img.complete && img.naturalWidth > 0){
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      renderMap(); initPanZoom();
    }));
  } else {
    img.onload=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      renderMap(); initPanZoom();
    }));
  }
}

function renderMap(){
  const svg=document.getElementById("mapSvg");
  svg.setAttribute("viewBox",`0 0 ${IMG_W} ${IMG_H}`);
  let s="";
  PATCHES.forEach(([px,py,pw,ph])=>{ s+=`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="white"/>`; });
  SPOT_DEFS.forEach(([id,,px,py,pw,ph])=>{
    const sp=spots[id], cls=sp.occupied?"occupied":"free", hl=selectedSpotId===id?" highlight":"", unusCls=sp.unusable?" unusable":"";
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

function selectSpot(id){
  if(!id) return;
  selectedSpotId=id; renderMap();
  const sp=spots[id], panel=document.getElementById("spotPanel");
  if(!sp){ return; }
  const puoGestire  = currentUser && currentUser.role === 'amministratore';
  const puoUnusable = currentUser && (currentUser.role === 'amministrativo' || currentUser.role === 'amministratore');
  const puoAssegna  = currentUser && (currentUser.role === 'autista' || currentUser.role === 'amministratore');
  const ml = _labelMezzo(sp.plate);
  const placeholderInput = currentMode === 'cassa' ? 'Es. 001' : 'Es. ABCD1234567';
  const inputLabel = currentMode === 'cassa' ? 'Numero cassa' : 'ID Container';

  // Stili condivisi per le righe info
  const rowStyle = 'margin-top:6px;font-size:14px;color:var(--text);font-weight:400;';
  const valStyle = 'color:var(--text);font-family:"DM Mono",monospace;font-size:14px;font-weight:500;';

  if(!sp.occupied){
    if(!puoAssegna){
      panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
        <h3 style="margin:0;color:var(--text);font-size:16px">${id}</h3>
        <button onclick="window._cancelSelect()" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1">&#10005;</button>
      </div>
      <span class="statusBadge free">&#9679; Libero</span>
      <div style="color:var(--muted);font-size:13px;margin-top:10px">Solo gli autisti possono assegnare veicoli.</div>`;
      return;
    }
    panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
      <h3 style="margin:0;color:var(--text);font-size:16px">${id}</h3>
      <button onclick="window._cancelSelect()" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1">&#10005;</button>
      </div>
      <span class="statusBadge free">&#9679; Libero</span>
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
      <button class="btnAssign" onclick="window._inlineAssign('${id}')">&#10003; Assegna</button>`;
    setTimeout(()=>document.getElementById("inlineplate")?.focus(),50);
  }else{
    const fullBadge = sp.full
      ? '<span style="color:#f59e0b;font-weight:500;font-size:14px">&#x1F7E1; Piena/o</span>'
      : '<span style="color:#22c55e;font-weight:500;font-size:14px">&#x1F7E2; Vuota/o</span>';
    panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
      <h3 style="margin:0;color:var(--text);font-size:16px">${id}</h3>
      <button onclick="window._cancelSelect()" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1">&#10005;</button>
      </div>
      <span class="statusBadge occupied">&#9679; Occupato</span>
      <div style="margin-top:12px;line-height:2">
        <div style="${rowStyle}">${ml.icon} ${ml.label}: <span style="${valStyle}">${sp.plate}</span></div>
        ${sp.damaged ? `<div style="color:#ef4444;font-size:14px;font-weight:500;margin-top:4px">&#9888;&#65039; Veicolo danneggiato</div>` : ''}
        ${sp.unusable ? `<div style="color:#a78bfa;font-size:14px;font-weight:500;margin-top:4px">&#x1F6AB; Veicolo inutilizzabile</div>` : ''}
        <div style="${rowStyle}">Stato: ${fullBadge}</div>
        <div style="${rowStyle}">Da: <span style="${valStyle}">${_fmtDateMap(sp.since)}</span></div>
        <div style="${rowStyle}">Durata: <span style="color:var(--accent);font-size:14px;font-weight:500">${_fmtDurMap(sp.since)}</span></div>
        <div style="${rowStyle}">Utente: <span style="color:var(--text);font-size:13px">${sp.user}</span></div>
      </div>
      ${sp.full
        ? `<button class="fullToggleBtn pieno" style="margin-top:12px" onclick="window._toggleFull('${id}',false)">&#x1F7E2; Segna come Vuota/o</button>`
        : `<button class="fullToggleBtn vuoto" style="margin-top:12px" onclick="window._toggleFull('${id}',true)">&#x1F7E1; Segna come Piena/o</button>`}
      ${puoUnusable ? (sp.damaged
        ? `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#f59e0b,#d97706)" onclick="window._removeDamaged('${id}')">&#10003; Rimuovi segnalazione guasto</button>`
        : `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#ef4444,#dc2626)" onclick="window._addDamaged('${id}')">&#9888;&#65039; Segna come guasto</button>`)
      : ''}
      ${puoUnusable ? (sp.unusable
        ? `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9)" onclick="window._removeUnusable('${id}')">&#10003; Rimuovi inutilizzabile</button>`
        : `<button class="fullToggleBtn" style="margin-top:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9)" onclick="window._addUnusable('${id}')">&#x1F6AB; Segna come inutilizzabile</button>`)
      : ''}
      ${puoGestire ? `<button class="btnFreeInline" style="background:#fff;color:#1C1F26;border:1px solid var(--border);font-weight:700;margin-top:8px" onclick="window._freeSpot('${id}')">&#10005; Libera Posto</button>` : ''}`;
  }
}

// Esponi funzioni richiamate da onclick nell'SVG (module scope)
window._selectSpot  = selectSpot;
window._inlineAssign = inlineAssign;
window._freeSpot    = freeSpot;
