  startListeners();
  renderStatistiche();
  renderUsers();
  showPage("Mappa", document.querySelector(".navTab"));
}



// ââ FIRESTORE LISTENERS âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function startListeners(){
  // Listener parcheggi: aggiornamento real-time
  unsubSpots = onSnapshot(collection(db,"spots"), (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      const id = change.doc.id;
      if(spots[id]){
        if(change.type==="removed"){
          spots[id].occupied=false; spots[id].plate=null;
          spots[id].since=null; spots[id].user=null; spots[id].full=false;
          spots[id].damaged=false; spots[id].unusable=false;
        }else{
          spots[id].occupied = data.occupied||false;
          spots[id].plate    = data.plate||null;
          spots[id].since    = data.since?.toDate()||null;
          spots[id].user     = data.user||null;
          spots[id].damaged  = data.damaged||false;
          spots[id].full     = data.full||false;
          spots[id].unusable = data.unusable||false;
        }
      }
    });
    if(currentUser?.role !== 'portineria'){
      renderMap();
      updateMapStats();
      renderSearch();
      renderStatistiche();
    }
  });

  // Listener storico: ultimi 200 movimenti
  const hq = query(collection(db,"history"), orderBy("ts","desc"), limit(200));
  unsubHistory = onSnapshot(hq, (snapshot) => {
    historyCache = snapshot.docs.map(d => ({ ...d.data(), ts: d.data().ts?.toDate() }));
    if(currentUser?.role !== 'portineria'){
      renderStorico();
      renderStatistiche();
    }
  });
