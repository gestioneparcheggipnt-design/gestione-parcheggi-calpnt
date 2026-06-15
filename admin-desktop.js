import { addDoc, collection, createUserWithEmailAndPassword, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from './firebase-config.js';

// ââ UI HELPERS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function showPage(id,btn){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".navTab").forEach(t=>t.classList.remove("active"));
  document.getElementById("page"+id).classList.add("active"); btn.classList.add("active");
if (id === 'Prenotazioni') initPrenotazioni();
}
window.showPage = showPage;

function updateMapStats(){
  const all=Object.values(window.spots), occ=all.filter(s=>s.occupied).length;
  document.getElementById("mapStats").innerHTML=`
    <div class="statCard blue"><div class="val">${all.length}</div><div class="lbl">Totali</div></div>
    <div class="statCard green"><div class="val">${all.length-occ}</div><div class="lbl">Liberi</div></div>
    <div class="statCard red"><div class="val">${occ}</div><div class="lbl">Occupati</div></div>
    <div class="statCard orange"><div class="val">${Math.round(occ/all.length*100)}%</div><div class="lbl">Occupazione</div></div>`;
}

let sortCol='id', sortDir='asc';

function sortTable(col){
  if(sortCol===col){ sortDir=sortDir==='asc'?'desc':'asc'; }
  else{ sortCol=col; sortDir='asc'; }
  // update header classes
  document.querySelectorAll('#searchTable th.sortable').forEach(th=>{
    th.classList.remove('sort-asc','sort-desc');
  });
  const cols=['id','stato','plate','since'];
  const idx=cols.indexOf(col);
  if(idx>=0){
    const ths=document.querySelectorAll('#searchTable thead tr:first-child th.sortable');
    if(ths[idx]) ths[idx].classList.add('sort-'+sortDir);
  }
  doSearch();
}
window.sortTable=sortTable;

function doSearch(){
  const q=(document.getElementById("searchInput")?.value||"").trim().toUpperCase();
  const type=document.querySelector("input[name=stype]:checked")?.value||"posto";
  const fPosto=(document.getElementById("fPosto")?.value||"").trim().toUpperCase();
  const fTarga=(document.getElementById("fTarga")?.value||"").trim().toUpperCase();
  const fStato=(document.getElementById("fStato")?.value||"");
  let res=Object.values(window.spots);
  // global search bar
  if(q) res=res.filter(s=>type==="posto"?s.id.includes(q):s.plate&&s.plate.includes(q));
  // column filters
  if(fPosto) res=res.filter(s=>s.id.includes(fPosto));
  if(fTarga) res=res.filter(s=>s.plate&&s.plate.includes(fTarga));
  if(fStato==="libero")             res=res.filter(s=>!s.occupied);
  if(fStato==="occupato")           res=res.filter(s=>s.occupied);
  if(fStato==="occupato-cassa")     res=res.filter(s=>s.occupied && s.plate && /^\d{3}$/.test(s.plate.trim()));
  if(fStato==="occupato-container") res=res.filter(s=>s.occupied && s.plate && /^[A-Z]{4}\d{7}$/.test(s.plate.trim()));
  const fDanneggiato=(document.getElementById("fDanneggiato")?.value||"");
  if(fDanneggiato==="si")        res=res.filter(s=>s.damaged);
  if(fDanneggiato==="no")        res=res.filter(s=>!s.damaged && !s.unusable);
  if(fDanneggiato==="inutilizzabile") res=res.filter(s=>s.unusable);
  const fPieno=(document.getElementById("fPieno")?.value||"");
  if(fPieno==="pieno") res=res.filter(s=>s.full);
  if(fPieno==="vuoto") res=res.filter(s=>!s.full);
  // sort
  res.sort((a,b)=>{
    let va,vb;
    if(sortCol==='id')   { va=a.id; vb=b.id; }
    else if(sortCol==='stato') { va=a.occupied?1:0; vb=b.occupied?1:0; }
    else if(sortCol==='plate') { va=a.plate||""; vb=b.plate||""; }
    else if(sortCol==='since') { va=a.since?a.since.getTime():0; vb=b.since?b.since.getTime():0; }
    else if(sortCol==='damaged'){ va=a.damaged?1:0; vb=b.damaged?1:0; }
    else if(sortCol==='full')  { va=a.full?1:0; vb=b.full?1:0; }
    if(va<vb) return sortDir==='asc'?-1:1;
    if(va>vb) return sortDir==='asc'?1:-1;
    return 0;
  });
  document.getElementById("searchResults").innerHTML=res.map(s=>{
    const tipoMezzo = s.plate
      ? (/^\d{3}$/.test(s.plate.trim()) ? '<span style="color:#f59e0b;font-size:11px;font-weight:600">📦 Cassa</span>'
        : (/^[A-Z]{4}\d{7}$/.test(s.plate.trim()) ? '<span style="color:#60a5fa;font-size:11px;font-weight:600">🚢 Container</span>' : '<span style="color:var(--muted);font-size:11px">&mdash;</span>'))
      : '<span style="color:var(--muted);font-size:11px">&mdash;</span>';
    const nomeUtente = s.userName || s.user || '&mdash;';
    return `
    <tr onclick="window._goToSpot('${s.id}')" style="cursor:pointer">
      <td class="mono">${s.id}</td>
      <td>${s.occupied ? '<span class="tagOcc">Occupato</span>' : '<span class="tagFree">Libero</span>'}</td>
      <td class="mono">${s.plate||"&mdash;"}</td>
      <td>${tipoMezzo}</td>
      <td>${s.since?fmtDate(s.since):"&mdash;"}</td>
      <td style="text-align:center">${s.unusable ? '<span style="color:#a78bfa;font-weight:600;font-size:13px">🚫 Inutilizzabile</span>' : s.damaged ? '<span style="color:#ef4444;font-weight:600;font-size:13px">⚠️ Guasto</span>' : '<span style="color:var(--muted);font-size:12px">&mdash;</span>'}</td>
      <td style="text-align:center">${s.occupied ? (s.full ? '<span class="tagPieno">🔴 Piena/o</span>' : '<span class="tagVuoto">🟢 Vuota/o</span>') : '<span style="color:var(--muted);font-size:12px">&mdash;</span>'}</td>
      <td style="color:var(--muted);font-size:11px">${nomeUtente}</td>
    </tr>`;}).join("");
}
window.doSearch=doSearch;
window.clearSearch=()=>{document.getElementById("searchInput").value="";doSearch();};

function goToSpot(id){
  showPage("Mappa",document.querySelectorAll(".navTab")[0]);
  setTimeout(()=>selectSpot(id),80);
}
window._goToSpot=goToSpot;

function renderSearch(){ doSearch(); }

function renderStorico(){
  const actionBadge = (action) => {
    if(action==="Assegnato") return '<span class="tagAss">Assegnato</span>';
    if(action==="Liberato")  return '<span class="tagLib">Liberato</span>';
    if(action==="Segnato Pieno") return '<span style="color:#f59e0b;font-size:11px;font-weight:600;background:#f59e0b13;padding:2px 8px;border-radius:20px">🔴 Pieno</span>';
    if(action==="Segnato Vuoto") return '<span style="color:#22c55e;font-size:11px;font-weight:600;background:#22c55e13;padding:2px 8px;border-radius:20px">🟢 Vuoto</span>';
    return `<span style="color:var(--muted);font-size:11px">${action}</span>`;
  };
  document.getElementById("storicoBody").innerHTML=window.historyCache.map(h=>{
    const tipoMezzo = h.plate
      ? (/^\d{3}$/.test(String(h.plate).trim()) ? '<span style="color:#f59e0b;font-size:11px;font-weight:600">📦 Cassa</span>'
        : (/^[A-Z]{4}\d{7}$/.test(String(h.plate).trim()) ? '<span style="color:#60a5fa;font-size:11px;font-weight:600">🚢 Container</span>' : '<span style="color:var(--muted);font-size:11px">&mdash;</span>'))
      : '<span style="color:var(--muted);font-size:11px">&mdash;</span>';
    const nomeUtente = h.userName || h.user || '&mdash;';
    return `
    <tr>
      <td class="mono" style="font-size:11px">${fmtDate(h.ts)}</td>
      <td class="mono">${h.spot}</td>
      <td>${actionBadge(h.action)}</td>
      <td class="mono">${h.plate||"&mdash;"}</td>
      <td>${tipoMezzo}</td>
      <td style="color:var(--muted);font-size:11px">${nomeUtente}</td>
    </tr>`;}).join("");
}

function renderStatistiche(){
  const all=Object.values(window.spots), occ=all.filter(s=>s.occupied).length;
  document.getElementById("globalStats").innerHTML=`
    <div class="statCard blue"><div class="val">${all.length}</div><div class="lbl">Totali</div></div>
    <div class="statCard green"><div class="val">${all.length-occ}</div><div class="lbl">Liberi</div></div>
    <div class="statCard red"><div class="val">${occ}</div><div class="lbl">Occupati</div></div>
    <div class="statCard orange"><div class="val">${historyCache.length}</div><div class="lbl">Movimenti</div></div>`;
  const cnt={};
  window.historyCache.filter(h=>h.action==="Assegnato").forEach(h=>{cnt[h.spot]=(cnt[h.spot]||0)+1;});
  const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8), mx=top[0]?.[1]||1;
  document.getElementById("chartTopSpots").innerHTML=top.map(([id,n])=>`
    <div class="barRow"><div class="barLabel">${id}</div>
    <div class="barTrack"><div class="barFill" style="width:${n/mx*100}%"></div></div>
    <div class="barVal">${n}x</div></div>`).join("")||'<div style="color:var(--muted);font-size:13px">Nessun dato</div>';
  const oL=all.filter(s=>s.occupied&&s.since).sort((a,b)=>a.since-b.since);
  document.getElementById("chartVehicles").innerHTML=oL.map(s=>{
    const h=((Date.now()-s.since)/3600000).toFixed(1);
    return `<div class="barRow"><div class="barLabel mono">${s.plate?.slice(0,6)||""}</div>
      <div style="flex:1;font-size:11px;color:var(--muted)">${s.id} &mdash; ${h}h</div></div>`;
  }).join("")||'<div style="color:var(--muted);font-size:13px">Nessun veicolo</div>';
  const dmg=all.filter(s=>s.occupied&&s.damaged&&s.since).sort((a,b)=>a.since-b.since);
  document.getElementById("chartDamaged").innerHTML=dmg.length===0
    ? '<div style="color:var(--muted);font-size:13px">Nessun veicolo danneggiato</div>'
    : dmg.map(s=>{
        const tot=Date.now()-s.since;
        const gg=Math.floor(tot/86400000);
        const hh=Math.floor((tot%86400000)/3600000);
        const mm=Math.floor((tot%3600000)/60000);
        const dur=gg>0?`${gg}g ${hh}h`:hh>0?`${hh}h ${mm}m`:`${mm}m`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <span style="color:#ef4444;font-size:13px;margin-right:6px">â ï¸</span>
            <span class="mono" style="font-weight:600;font-size:14px">${s.plate||"â"}</span>
            <span style="color:var(--muted);font-size:11px;margin-left:8px">Posto ${s.id}</span>
          </div>
          <div style="font-size:12px;color:#ef4444;font-weight:600;white-space:nowrap">${dur}</div>
        </div>`;
      }).join("");
  const hrs=[8,9,10,11,12,13,14,15,16,17,18], pk=[3,8,12,14,10,9,13,15,11,7,4], mxp=Math.max(...pk);
  document.getElementById("chartHours").innerHTML=hrs.map((h,i)=>`
    <div class="barRow"><div class="barLabel">${h}:00</div>
    <div class="barTrack"><div class="barFill" style="width:${pk[i]/mxp*100}%"></div></div>
    <div class="barVal">${pk[i]}</div></div>`).join("");
  renderHeatmap(cnt);
}

function renderHeatmap(cnt){
  const mainImg = document.getElementById("mapImg");
  const hmImg   = document.getElementById("heatmapImg");
  if(mainImg && mainImg.src) hmImg.src = mainImg.src;
  const maxVal = cnt && Object.keys(cnt).length ? Math.max(...Object.values(cnt)) : 1;
  function heatColor(val, max){
    if(!max||!val) return "rgba(255,255,255,0.08)";
    const t = val / max; // 0..1
    // bianco(0) -> giallo(0.33) -> arancione(0.66) -> rosso(1)
    let r, g, b;
    if(t < 0.33){
      const s = t / 0.33;
      r = 255; g = 255; b = Math.round(255 * (1 - s));
    } else if(t < 0.66){
      const s = (t - 0.33) / 0.33;
      r = 255; g = Math.round(255 - s * 85); b = 0;
    } else {
      const s = (t - 0.66) / 0.34;
      r = 255; g = Math.round(170 - s * 170); b = 0;
    }
    const a = 0.18 + t * 0.72;
    return `rgba(${r},${g},${b},${a})`;
  }
  function drawRects(){
    const img = document.getElementById("heatmapImg");
    const nW = img.naturalWidth  || 2048;
    const nH = img.naturalHeight || 2048;
    const dW = img.clientWidth   || img.offsetWidth  || nW;
    const dH = img.clientHeight  || img.offsetHeight || nH;
    const scX = dW / nW;
    const scY = dH / nH;
    const svg = document.getElementById("heatmapSvg");
    svg.setAttribute("viewBox", `0 0 ${dW} ${dH}`);
    const PATCHES_HM=[
      [1291,351,302,177],[1658,139,221,97],[324,1012,89,384],
      [348,1002,63,13],[317,1395,96,45],[413,1010,32,388],
      [324,1565,89,385],[317,1470,60,100],[317,1949,65,65],
      [413,1563,32,388]
    ];
    let html = "";
    PATCHES_HM.forEach(([x,y,w,h])=>{
      html += `<rect x="${x*scX}" y="${y*scY}" width="${w*scX}" height="${h*scY}" fill="#aaaaaa" opacity="0.18" rx="2"/>`;
    });
    SPOT_DEFS.forEach(([id,,x,y,w,h])=>{
      const val  = cnt ? (cnt[id]||0) : 0;
      const fill = heatColor(val, maxVal);
      const stroke = val > 0 ? `rgba(160,0,0,0.55)` : `rgba(120,120,120,0.25)`;
      html += `<rect x="${x*scX}" y="${y*scY}" width="${w*scX}" height="${h*scY}" fill="${fill}" stroke="${stroke}" stroke-width="0.8" rx="1"><title>${id}: ${val} accessi</title></rect>`;
      if(val > 0){
        const fs = Math.max(6, Math.min(w*scX, h*scY) * 0.42);
        html += `<text x="${(x+w/2)*scX}" y="${(y+h/2)*scY}" text-anchor="middle" dominant-baseline="middle" font-family="DM Mono,monospace" font-size="${fs}" font-weight="700" fill="rgba(80,0,0,0.9)">${val}</text>`;
      }
    });
    svg.innerHTML = html;
  }
  const img = document.getElementById("heatmapImg");
  if(img.complete && img.naturalWidth){ drawRects(); }
  else { img.onload = drawRects; }
  setTimeout(drawRects, 350);
}

// ── GESTIONE UTENTI (solo amministratore) ────────────────────────────────
async function renderUsers(){
  if(!window.currentUser||window.currentUser.role!=="amministratore") return;
  const snap = await getDocs(collection(window.db,"users"));
  const users = snap.docs.map(d=>({uid:d.id,...d.data()}));
  document.getElementById("userList").innerHTML=users.map(u=>`
    <div class="userCard">
      <div class="avatar">${(u.name||u.email||"?").charAt(0).toUpperCase()}</div>
      <div class="userInfo">
        <div class="userField">
          <span class="userFieldLabel">Nome</span>
          <span class="userFieldValue" id="uname-${u.uid}">${_esc(u.name||"—")}</span>
          <button class="btnEdit" title="Modifica nome" onclick="window._editUserField('${u.uid}','name','uname-${u.uid}','${(u.name||"").replace(/'/g,"\'")}')">✏️</button>
        </div>
        <div class="userField">
          <span class="userFieldLabel">Email</span>
          <span class="userFieldValue" id="uemail-${u.uid}">${_esc(u.email||u.uid)}</span>
          <button class="btnEdit" title="Modifica email" onclick="window._editUserField('${u.uid}','email','uemail-${u.uid}','${(u.email||"").replace(/'/g,"\'")}')">✏️</button>
        </div>
        <div class="userField">
          <span class="userFieldLabel">Password</span>
          <span class="userFieldValue" style="color:var(--muted);letter-spacing:2px">••••••</span>
          <button class="btnEdit" title="Cambia password" onclick="window._editUserField('${u.uid}','password','','')">✏️</button>
        </div>
      </div>
      <select class="roleSelect" onchange="window._changeRole('${u.uid}',this.value)">
        <option value="autista"       ${u.role==="autista"?"selected":""}>Autista</option>
        <option value="operativo"     ${u.role==="operativo"?"selected":""}>Operativo</option>
        <option value="amministrativo"${u.role==="amministrativo"?"selected":""}>Amministrativo</option>
        <option value="amministratore"${u.role==="amministratore"?"selected":""}>Amministratore</option>
      </select>
      <select class="roleSelect" onchange="window._changeReparto('${u.uid}',this.value)" title="Reparto ribalte">
        <option value="" ${!u.reparto?"selected":""}>— Reparto —</option>
        <option value="RICEVIMENTO"  ${u.reparto==="RICEVIMENTO"?"selected":""}>Ricevimento</option>
        <option value="SPEDIZIONI"   ${u.reparto==="SPEDIZIONI"?"selected":""}>Spedizioni</option>
        <option value="CAPI APPESI"  ${u.reparto==="CAPI APPESI"?"selected":""}>Capi appesi</option>
        <option value="LAV MAN"      ${u.reparto==="LAV MAN"?"selected":""}>Lav man</option>
        <option value="REVERSE"      ${u.reparto==="REVERSE"?"selected":""}>Reverse</option>
        <option value="ESTERO"       ${u.reparto==="ESTERO"?"selected":""}>Estero</option>
        <option value="E-COMMERCE"   ${u.reparto==="E-COMMERCE"?"selected":""}>E-commerce</option>
        <option value="TGW"          ${u.reparto==="TGW"?"selected":""}>TGW</option>
      </select>
      <button class="btnDanger" onclick="window._deleteUser('${u.uid}','${(u.name||u.email).replace(/'/g,"\'")}')">🗑</button>
    </div>`).join("")||'<div style="color:var(--muted);font-size:13px">Nessun utente trovato</div>';
}

// ── Modifica inline singolo campo utente ─────────────────────────────────
window._editUserField = async function(uid, field, spanId, currentVal) {
  const existingInput = document.getElementById('edit-input-' + uid + '-' + field);
  if (existingInput) return;

  if (field === 'password') {
    const allBtns = [...document.querySelectorAll('.btnEdit')];
    const btn = allBtns.find(b => {
      const oc = b.getAttribute('onclick') || '';
      return oc.includes(uid) && oc.includes("'password'");
    });
    if (!btn) return;
    const row = btn.closest('.userField');
    btn.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.id = 'edit-input-' + uid + '-password';
    wrap.style.cssText = 'display:flex;gap:5px;margin-top:5px;align-items:center;flex-wrap:wrap;';
    wrap.innerHTML =
      '<input type="password" id="pwdinput-' + uid + '" placeholder="Nuova password (min. 6 car.)"' +
      ' style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text);font-family:inherit;font-size:12px;outline:none;" />' +
      '<button class="btnEdit" style="color:var(--accent)" onclick="window._saveUserField(\'' + uid + '\',\'password\',\'pwdinput-' + uid + '\',\'\')">✔</button>' +
      '<button class="btnEdit" onclick="window._cancelEditField(\'' + uid + '\',\'password\',\'\')">✖</button>';
    row.appendChild(wrap);
    const pwdInput = document.getElementById('pwdinput-' + uid);
    if (pwdInput) {
      pwdInput.focus();
      pwdInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter')  window._saveUserField(uid, 'password', 'pwdinput-' + uid, '');
        if (e.key === 'Escape') window._cancelEditField(uid, 'password', '');
      });
    }
    return;
  }

  // Nome / Email: input inline
  const span = document.getElementById(spanId);
  if (!span) return;
  span.style.display = 'none';
  const editBtn = span.nextElementSibling;
  if (editBtn) editBtn.style.display = 'none';

  const input = document.createElement('input');
  input.type = field === 'email' ? 'email' : 'text';
  input.id = 'edit-input-' + uid + '-' + field;
  input.value = currentVal;
  input.style.cssText = 'flex:1;min-width:100px;background:var(--bg);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text);font-family:inherit;font-size:13px;outline:none;';
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  window._saveUserField(uid, field, input.id, spanId);
    if (e.key === 'Escape') window._cancelEditField(uid, field, spanId);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btnEdit';
  confirmBtn.style.color = 'var(--accent)';
  confirmBtn.textContent = '✔';
  confirmBtn.onclick = function() { window._saveUserField(uid, field, input.id, spanId); };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btnEdit';
  cancelBtn.textContent = '✖';
  cancelBtn.onclick = function() { window._cancelEditField(uid, field, spanId); };

  span.parentNode.insertBefore(input, span);
  span.parentNode.insertBefore(confirmBtn, span);
  span.parentNode.insertBefore(cancelBtn, span);
  input.focus();
  input.select();
};

window._saveUserField = async function(uid, field, inputId, spanId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const newVal = input.value.trim();
  if (!newVal) { showToast("Il campo non può essere vuoto","error"); return; }
  if (field === 'password' && newVal.length < 6) { showToast("Password di almeno 6 caratteri","error"); return; }
  try {
    if (field === 'password') {
      showToast("La modifica password richiede che l'utente effettui il reset dal login","info");
    } else {
      await updateDoc(doc(window.db,"users",uid), { [field]: newVal });
      const span = document.getElementById(spanId);
      if (span) span.textContent = newVal;
      showToast(field === 'name' ? "Nome aggiornato" : "Email aggiornata","success");
    }
    window._cancelEditField(uid, field, spanId);
  } catch(e) {
    showToast("Errore: "+e.message,"error");
  }
};

window._cancelEditField = function(uid, field, spanId) {
  if (field === 'password') {
    const wrap = document.getElementById('edit-input-' + uid + '-password');
    if (wrap) {
      const row = wrap.closest('.userField');
      const hiddenBtn = row ? row.querySelector('.btnEdit[style*="display: none"], .btnEdit[style*="display:none"]') : null;
      if (hiddenBtn) hiddenBtn.style.display = '';
      wrap.remove();
    }
    return;
  }
  const tempInput = document.getElementById('edit-input-' + uid + '-' + field);
  if (tempInput) {
    const c1 = tempInput.nextElementSibling;
    const c2 = c1 ? c1.nextElementSibling : null;
    tempInput.remove();
    if (c1) c1.remove();
    if (c2) c2.remove();
  }
  const span = document.getElementById(spanId);
  if (span) {
    span.style.display = '';
    const editBtn = span.nextElementSibling;
    if (editBtn) editBtn.style.display = '';
  }
};

async function changeRole(uid,role){
  await updateDoc(doc(window.db,"users",uid),{role});
  showToast("Ruolo aggiornato","success");
  renderUsers();
}
window._changeRole=changeRole;

async function changeReparto(uid, reparto) {
  await updateDoc(doc(window.db,"users",uid), { reparto: reparto || null });
  showToast("Reparto aggiornato","success");
}
window._changeReparto = changeReparto;
window.renderUsers=renderUsers;

async function deleteUser(uid, nome) {
  if(!confirm(`Eliminare l'utente "${nome}"? Questa operazione non Ã¨ reversibile.`)) return;
  try {
    await deleteDoc(doc(window.db,"users",uid));
    showToast("Utente eliminato","success");
    renderUsers();
  } catch(e) {
    showToast("Errore eliminazione: "+e.message,"error");
  }
}
window._deleteUser = deleteUser;

window.addUser = async function(){
  const name  = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const pass  = document.getElementById("newUserPass").value.trim();
  const role   = document.getElementById("newUserRole").value;
  const reparto = document.getElementById("newUserReparto")?.value || null;
  if(!name||!email||!pass){ showToast("Compila tutti i campi","error"); return; }
  if(pass.length < 6){ showToast("La password deve essere di almeno 6 caratteri","error"); return; }
  const btn = document.querySelector("#modalAddUser .btnPrimary");
  btn.textContent = "Creazione..."; btn.disabled = true;
  try {
    // Crea una seconda istanza Firebase temporanea per non disconnettere l'admin
    const secondaryApp = initializeApp(firebaseConfig, "secondary-" + Date.now());
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    const uid = cred.user.uid;
    // Salva profilo su Firestore
    await setDoc(doc(window.db, "users", uid), { name, email, role, reparto: reparto || null });
    // Disconnetti e distruggi l'istanza secondaria
    await signOut(secondaryAuth);
    await secondaryApp.delete();
    showToast(`Utente ${name} creato con successo!`, "success");
    closeModal("modalAddUser");
    // Reset campi
    document.getElementById("newUserName").value = "";
    document.getElementById("newUserEmail").value = "";
    document.getElementById("newUserPass").value = "";
    document.getElementById("newUserRole").value = "autista";
    renderUsers();
  } catch(e) {
    let msg = "Errore: " + e.message;
    if(e.code === "auth/email-already-in-use") msg = "Email giÃ  registrata";
    if(e.code === "auth/invalid-email") msg = "Email non valida";
    if(e.code === "auth/weak-password") msg = "Password troppo debole (min. 6 caratteri)";
    showToast(msg, "error");
  } finally {
    btn.textContent = "Crea Utente"; btn.disabled = false;
  }
};

async function removeDamaged(id){
  try{
    await updateDoc(doc(window.db,"spots",id),{ damaged: false });
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Danno rimosso", plate:window.spots[id].plate,
      user: window.currentUser.name || window.currentUser.email,
      userName: window.currentUser.name || window.currentUser.email
    });
    selectSpot(id);
    showToast(`Segnalazione danno rimossa per posto ${id}`,"success");
  }catch(e){
    showToast("Errore: "+e.message,"error");
  }
}
window._removeDamaged=removeDamaged;

async function addDamaged(id){
  try{
    await updateDoc(doc(window.db,"spots",id),{ damaged: true });
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Danno segnalato", plate:window.spots[id].plate,
      user: window.currentUser.name || window.currentUser.email,
      userName: window.currentUser.name || window.currentUser.email
    });
    selectSpot(id);
    showToast(`Veicolo danneggiato segnalato per posto ${id}`,"success");
  }catch(e){
    showToast("Errore: "+e.message,"error");
  }
}
window._addDamaged=addDamaged;

async function addUnusable(id){
  try{
    await updateDoc(doc(window.db,"spots",id),{ unusable: true });
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Inutilizzabile segnalato", plate:window.spots[id].plate,
      user: window.currentUser.name || window.currentUser.email,
      userName: window.currentUser.name || window.currentUser.email
    });
    selectSpot(id);
    showToast(`Veicolo segnato come inutilizzabile: posto ${id}`,"success");
  }catch(e){
    showToast("Errore: "+e.message,"error");
  }
}
window._addUnusable=addUnusable;

async function removeUnusable(id){
  try{
    await updateDoc(doc(window.db,"spots",id),{ unusable: false });
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Inutilizzabile rimosso", plate:window.spots[id].plate,
      user: window.currentUser.name || window.currentUser.email,
      userName: window.currentUser.name || window.currentUser.email
    });
    selectSpot(id);
    showToast(`Segnalazione inutilizzabile rimossa: posto ${id}`,"success");
  }catch(e){
    showToast("Errore: "+e.message,"error");
  }
}
window._removeUnusable=removeUnusable;

function cancelSelect(){
  window.selectedSpotId=null; renderMap();
  document.getElementById("spotPanel").innerHTML=
    '<div style="color:var(--muted);font-size:13px;text-align:center;padding:18px 0">Clicca un parcheggio sulla mappa</div>';
}
window._cancelSelect=cancelSelect;
function openModal(id){ document.getElementById(id).classList.add("open"); }
function closeModal(id){ document.getElementById(id).classList.remove("open"); }
window.openModal=openModal; window.closeModal=closeModal;

function fmtDate(d){
  if(!d) return "â";
  return new Date(d).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function fmtDur(since){
  if(!since) return "â";
  const m=Math.floor((Date.now()-new Date(since))/60000);
  return m<60?`${m} min`:`${Math.floor(m/60)}h ${m%60}m`;
}
let toastT;
function showToast(msg,type="success"){
  const t=document.getElementById("toast");
  const icon = type==="success"?"✓ ":type==="error"?"✗ ":"ℹ ";
  t.textContent=icon+msg;
  t.className="toast "+type+" show";
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),3500);
}
window.addEventListener("resize",()=>{ applyT(); });

const RE_CASSA     = /^\d{3}$/;           // 3 cifre  → cassa
const RE_CONTAINER = /^[A-Z]{4}\d{7}$/;  // 4 lettere + 7 cifre → container

function riconosciTipoMezzo(id) {
  if (RE_CASSA.test(id))     return 'cassa';
  if (RE_CONTAINER.test(id)) return 'container';
  return null;
}

