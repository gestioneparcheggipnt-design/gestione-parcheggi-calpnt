import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from './firebase-config.js';
async function inlineAssign(id){
  const plate=(document.getElementById("inlineplate")?.value||"").trim().toUpperCase();
  if(!plate){ showToast(`Inserisci ${getModeLabel().toLowerCase()} o identificativo`,"error"); return; }

    // Check se il posto scelto e' gia' occupato
  if(window.spots[id] && window.spots[id].occupied){
    showToast(`⚠️ Il posto ${id} è già occupato da ${window.spots[id].plate || 'un veicolo'}`, "error");
    return;
  }

  // Check se la targa/ID Ã¨ giÃ  assegnata ad un altro posto
  const alreadySpot = Object.entries(window.spots).find(([sid, s]) => s.occupied && s.plate === plate && sid !== id);
  if(alreadySpot){
    showToast(`â ï¸ ${plate} giÃ  assegnato al posto ${alreadySpot[0]}`, "error");
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
    await addDoc(collection(window.db,"history"), {
      ts: serverTimestamp(), spot:id,
      action:"Assegnato", plate, user: window.currentUser.email, damaged,
      mode: window.currentMode
    });
    selectSpot(id);
    showToast(`Posto ${id} assegnato a ${plate}${damaged?" â ï¸ danneggiato":""}${full?" ð¡ pieno":""}`, "success");
  }catch(e){
    showToast("Errore salvataggio: "+e.message,"error");
    if(btn){ btn.textContent="â Assegna"; btn.disabled=false; }
  }
}

async function freeSpot(id){
  const sp=window.spots[id];
  const btn=document.querySelector(".btnFreeInline");
  if(btn){ btn.textContent="Liberazione..."; btn.disabled=true; }
  try{
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Liberato", plate:sp.plate, user: window.currentUser.email
    });
    await setDoc(doc(window.db,"spots",id),{
      occupied:false, plate:null, since:null, user:null, full:false
    });
    selectSpot(id);
    showToast(`Posto ${id} liberato`,"success");
  }catch(e){
    showToast("Errore: "+e.message,"error");
    if(btn){ btn.textContent="â Libera Posto"; btn.disabled=false; }
  }
}


// ââ TOGGLE PIENO/VUOTO ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function toggleFull(id, newFull){
  try{
    await updateDoc(doc(window.db,"spots",id),{ full: newFull });
    await addDoc(collection(window.db,"history"),{
      ts: serverTimestamp(), spot:id,
      action: newFull ? "Segnato Pieno" : "Segnato Vuoto",
      plate: window.spots[id].plate,
      user: window.currentUser.name || window.currentUser.email,
      userName: window.currentUser.name || window.currentUser.email

});
    showToast(`Posto ${id} ${newFull?"segnato come pieno":"segnato come vuoto"}`,"success");
    selectSpot(id);
  }catch(e){
    showToast("Errore: "+e.message,"error");
  }
}
window._toggleFull = toggleFull;
window._inlineAssign = inlineAssign;
window._freeSpot     = freeSpot;
