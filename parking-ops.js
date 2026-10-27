// ── parking-ops.js ─ Operazioni dirette sul posto (pannello mappa desktop) ────
// Tutte le scritture passano da window.ParcheggiCore (transazioni, sotto-posti).
async function inlineAssign(id){
  const plate=window.normalizzaId(document.getElementById("inlineplate")?.value||"");
  if(!plate){ window.showToast(`Inserisci ${window.getModeLabel().toLowerCase()} o identificativo`,"error"); return; }

  // Check se la targa/ID è già su un altro posto
  const gia = window.ParcheggiCore.trovaMezzo(window.spots, plate);
  if(gia && gia.posto !== id){
    window.showToast(`⚠️ ${plate} già assegnato al posto ${gia.posto}`, "error");
    return;
  }

  const damaged=document.getElementById("inlineDamaged")?.checked||false;
  const full=document.getElementById("inlineFull")?.checked||false;
  const btn=document.querySelector(".btnAssign");
  if(btn){ btn.textContent="Salvataggio..."; btn.disabled=true; }
  try{
    await window.ParcheggiCore.assegna(id, {
      plate, user: window.currentUser.email, damaged, full
    });
    await window.logHistory({
      spot:id, action:"Assegnato", plate, damaged, full, mode: window.currentMode
    });
    window.selectSpot(id);
    window.showToast(`Posto ${id} assegnato a ${plate}${damaged?" ⚠️ danneggiato":""}${full?" 🟡 pieno":""}`, "success");
  }catch(e){
    window.showToast("⚠️ "+e.message,"error");
    if(btn){ btn.textContent="✓ Assegna"; btn.disabled=false; }
  }
}

async function freeSpot(id, plate){
  const btn=document.querySelector(".btnFreeInline");
  if(btn){ btn.textContent="Liberazione..."; btn.disabled=true; }
  try{
    const rimosso = await window.ParcheggiCore.libera(id, plate || null);
    if(rimosso) await window.logHistory({ spot:id, action:"Liberato", plate:rimosso.plate });
    window.selectSpot(id);
    window.showToast(rimosso ? `${rimosso.plate} rimosso dal posto ${id}` : `Posto ${id} già libero`,"success");
  }catch(e){
    window.showToast("Errore: "+e.message,"error");
    if(btn){ btn.textContent="✗ Libera Posto"; btn.disabled=false; }
  }
}


// ── TOGGLE PIENO/VUOTO ───────────────────────────────────────────────────────
async function toggleFull(id, newFull, plate){
  try{
    const m = await window.ParcheggiCore.aggiorna(id, plate || null, { full: newFull });
    await window.logHistory({
      spot:id,
      action: newFull ? "Segnato Pieno" : "Segnato Vuoto",
      plate: m.plate
    });
    window.showToast(`${m.plate} (${id}) ${newFull?"segnato come pieno":"segnato come vuoto"}`,"success");
    window.selectSpot(id);
  }catch(e){
    window.showToast("Errore: "+e.message,"error");
  }
}
window._toggleFull = toggleFull;

window._inlineAssign = inlineAssign;
window._freeSpot     = freeSpot;
