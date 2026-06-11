}

function stopListeners(){
  if(unsubSpots)  { unsubSpots();  unsubSpots=null;  }
  if(unsubHistory){ unsubHistory();unsubHistory=null; }
}



// ââ OPERAZIONI PARCHEGGI ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function inlineAssign(id){
  const plate=(document.getElementById("inlineplate")?.value||"").trim().toUpperCase();
  if(!plate){ showToast(`Inserisci ${getModeLabel().toLowerCase()} o identificativo`,"error"); return; }

  // Check se il posto scelto e' gia' occupato
  if(spots[id] && spots[id].occupied){
    showToast(`⚠️ Il posto ${id} è già occupato da ${spots[id].plate || 'un veicolo'}`, "error");
    return;
  }

  // Check se la targa/ID Ã¨ giÃ  assegnata ad un altro posto
  const alreadySpot = Object.entries(spots).find(([sid, s]) => s.occupied && s.plate === plate && sid !== id);
  if(alreadySpot){
    showToast(`â ï¸ ${plate} giÃ  assegnato al posto ${alreadySpot[0]}`, "error");
    return;
  }

  const damaged=document.getElementById("inlineDamaged")?.checked||false;
  const full=document.getElementById("inlineFull")?.checked||false;
  const btn=document.querySelector(".btnAssign");
  if(btn){ btn.textContent="Salvataggio..."; btn.disabled=true; }
  try{
    await setDoc(doc(db,"spots",id), {
      occupied: true, plate, since: serverTimestamp(), user: currentUser.email, damaged, full
    });
    await addDoc(collection(db,"history"), {
      ts: serverTimestamp(), spot:id,
      action:"Assegnato", plate, user: currentUser.email, damaged,
      mode: currentMode
    });
    selectSpot(id);
    showToast(`Posto ${id} assegnato a ${plate}${damaged?" â ï¸ danneggiato":""}${full?" ð¡ pieno":""}`, "success");
  }catch(e){
    showToast("Errore salvataggio: "+e.message,"error");
    if(btn){ btn.textContent="â Assegna"; btn.disabled=false; }
  }
}

async function freeSpot(id){
  const sp=spots[id];
  const btn=document.querySelector(".btnFreeInline");
  if(btn){ btn.textContent="Liberazione..."; btn.disabled=true; }
  try{
    await addDoc(collection(db,"history"),{
      ts: serverTimestamp(), spot:id,
      action:"Liberato", plate:sp.plate, user: currentUser.email
    });
    await setDoc(doc(db,"spots",id),{
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
    await updateDoc(doc(db,"spots",id),{ full: newFull });
    await addDoc(collection(db,"history"),{
      ts: serverTimestamp(), spot:id,
      action: newFull ? "Segnato Pieno" : "Segnato Vuoto",
      plate: spots[id].plate,
      user: currentUser.name || currentUser.email,
      userName: currentUser.name || currentUser.email
