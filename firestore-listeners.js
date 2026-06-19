import { collection, doc, limit, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── FIRESTORE LISTENERS ──────────────────────────────────────────────────────
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

  // Listener ribalte: aggiornamento real-time
  window.ribalte = window.ribalte || {};
  window.unsubRibalte = onSnapshot(collection(window.db,"ribalte"), (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const id = change.doc.id;
      if(change.type==="removed"){
        delete window.ribalte[id];
      }else{
        const data = change.doc.data();
        window.ribalte[id] = {
          id,
          occupied: data.occupied||false,
          plate:    data.plate||null,
          since:    data.since?.toDate()||null,
          user:     data.user||null,
          full:     data.full||false,
        };
      }
    });
    if(window.currentUser?.role !== 'portineria'){
      renderSearch();
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
  if(window.unsubRibalte){ window.unsubRibalte();window.unsubRibalte=null;}
  if(window.unsubHistory){ window.unsubHistory();window.unsubHistory=null; }
}

window.startListeners = startListeners;
window.stopListeners  = stopListeners;
