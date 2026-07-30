import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
async function inlineAssign(id){
  const plate=(document.getElementById("inlineplate")?.value||"").trim().toUpperCase();
  if(!plate){ window.showToast(`Inserisci ${window.getModeLabel().toLowerCase()} o identificativo`,"error"); return; }

    // Check se il posto scelto e' gia' occupato
  if(window.spots[id] && window.spots[id].occupied){
    window.showToast(`⚠️ Il posto ${id} è già occupato da ${window.spots[id].plate || 'un veicolo'}`, "error");
    return;
  }

  // Check se la targa/ID è già assegnata ad un altro posto
  const alreadySpot = Object.entries(window.spots).find(([sid, s]) => s.occupied && s.plate === plate && sid !== id);
  if(alreadySpot){
    window.showToast(`⚠️ ${plate} già assegnato al posto ${alreadySpot[0]}`, "error");
    return;
  }

  const damaged=document.getElementById("inlineDamaged")?.checked||false;
  const full=document.getElementById("inlineFull")?.checked||false;
  const btn=document.querySelector(".btnAssign");
  if(btn){ btn.textContent="Salvataggio..."; btn.disabled=true; }
  try{
    await setDoc(doc(window.db,"spots",id), {
      occupied: true, plate, since: serverTimestamp(), user: window.currentUser.email, damaged, full
    });
    await window.logHistory({
      spot:id, action:"Assegnato", plate, damaged, mode: window.currentMode
    });
    window.selectSpot(id);
    window.showToast(`Posto ${id} assegnato a ${plate}${damaged?" ⚠️ danneggiato":""}${full?" 🟡 pieno":""}`, "success");
  }catch(e){
    window.showToast("Errore salvataggio: "+e.message,"error");
    if(btn){ btn.textContent="✓ Assegna"; btn.disabled=false; }
  }
}

async function freeSpot(id){
  const sp=window.spots[id];
  const btn=document.querySelector(".btnFreeInline");
  if(btn){ btn.textContent="Liberazione..."; btn.disabled=true; }
  try{
    await window.logHistory({
      spot:id, action:"Liberato", plate:sp.plate
    });
    await setDoc(doc(window.db,"spots",id),{
      occupied:false, plate:null, since:null, user:null, full:false
    });
    window.selectSpot(id);
    window.showToast(`Posto ${id} liberato`,"success");
  }catch(e){
    window.showToast("Errore: "+e.message,"error");
    if(btn){ btn.textContent="✗ Libera Posto"; btn.disabled=false; }
  }
}


// ââ TOGGLE PIENO/VUOTO ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function toggleFull(id, newFull){
  try{
    await updateDoc(doc(window.db,"spots",id),{ full: newFull });
    await window.logHistory({
      spot:id,
      action: newFull ? "Segnato Pieno" : "Segnato Vuoto",
      plate: window.spots[id].plate
    });
    window.showToast(`Posto ${id} ${newFull?"segnato come pieno":"segnato come vuoto"}`,"success");
    window.selectSpot(id);
  }catch(e){
    window.showToast("Errore: "+e.message,"error");
  }
}
window._toggleFull = toggleFull;

window._inlineAssign = inlineAssign;
window._freeSpot     = freeSpot;
