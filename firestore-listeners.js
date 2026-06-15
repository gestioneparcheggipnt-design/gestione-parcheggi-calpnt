import { collection, doc, limit, onSnapshot, orderBy, query } from './firebase-config.js';
// ââ FIRESTORE LISTENERS âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function startListeners(){
  // Listener parcheggi: aggiornamento real-time
  window.unsubSpots = onSnapshot(collection(window.db,"spots"), (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      const id = change.doc.id;
      if(window.spots[id]){
        if(change.type==="removed"){
          window.spots[id].occupied=false; window.window.spots[id].plate=null;
          window.spots[id].since=null; window.spots[id].user=null; window.spots[id].full=false;
          window.spots[id].damaged=false; window.spots[id].unusable=false;
        }else{
          window.spots[id].occupied = data.occupied||false;
          window.window.spots[id].plate    = data.plate||null;
          window.spots[id].since    = data.since?.toDate()||null;
          window.spots[id].user     = data.user||null;
          window.spots[id].damaged  = data.damaged||false;
          window.spots[id].full     = data.full||false;
          window.spots[id].unusable = data.unusable||false;
        }
      }
    });
    if(window.currentUser?.role !== 'portineria'){
      renderMap();
      updateMapStats();
      renderSearch();
      renderStatistiche();
    }
  });

  // Listener storico: ultimi 200 movimenti
  const hq = query(collection(window.db,"history"), orderBy("ts","desc"), limit(200));
  window.unsubHistory = onSnapshot(hq, (snapshot) => {
    window.historyCache = snapshot.docs.map(d => ({ ...d.data(), ts: d.data().ts?.toDate() }));
    if(window.currentUser?.role !== 'portineria'){
      renderStorico();
      renderStatistiche();
    }
  });

}

function stopListeners(){
  if(window.unsubSpots)  { window.unsubSpots();  window.unsubSpots=null;  }
  if(window.unsubHistory){ window.unsubHistory();window.unsubHistory=null; }
}

