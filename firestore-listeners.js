import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// ── FIRESTORE LISTENERS ──────────────────────────────────────────────────────
function startListeners(){
  // Listener parcheggi (posti + config/parcheggi): uno solo, in ParcheggiCore.
  // window.spots contiene SOLO i posti attivi, come viste normalizzate
  // (occupanti[], statoOcc, slotLiberi + campi del primo mezzo per compatibilità).
  window.unsubSpots = window.ParcheggiCore.ascolta(() => {
    window.ParcheggiCore.riempi(window.spots, { date: true });
    // Pannello Parcheggi in Impostazioni: riflette subito attivazioni e occupazione
    if(window.renderImpostazioni && document.getElementById('pageImpostazioni')?.classList.contains('active')){
      try { window.renderImpostazioni(); } catch(e){}
    }
    if(window.currentUser?.role !== 'portineria'){
      renderMap();
      updateMapStats();
      renderSearch();
      renderStatistiche();
      // Vista casse del tab Prenotazioni: aggiornata anche ai cambi dei posti
      if(window.currentMode==='cassa' && window.renderCasse &&
         document.getElementById('pagePrenotazioni')?.classList.contains('active')){
        try { window.renderCasse(); } catch(e){}
      }
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
          inUscita: data.inUscita||false,
          ribaltaRichiesta: data.ribaltaRichiesta||null,
        };
      }
    });
    if(window.currentUser?.role !== 'portineria'){
      renderSearch();
    }
  });

  // Listener navette (navettaggi interni): stato real-time dei mezzi dedicati
  if (window.NavetteCore) {
    window.NavetteCore.startNavetteListener(() => {
      if (window.currentUser?.role !== 'portineria') {
        try { renderSearch(); } catch(e){}
        if (window._aggiornaVistaPrenotazioni) try { window._aggiornaVistaPrenotazioni(); } catch(e){}
        if (window.renderNavettePanel) try { window.renderNavettePanel(); } catch(e){}
        if (window.renderImpostazioni && document.getElementById('pageImpostazioni')?.classList.contains('active'))
          try { window.renderImpostazioni(); } catch(e){}
      }
    });
  }

  // Listener prenotazioni APERTE: serve al tab Ricerca per sapere quali veicoli
  // sono già impegnati in una missione. Solo where di uguaglianza, nessun
  // orderBy → nessun indice composito richiesto.
  window.prenotazioniAperte = window.prenotazioniAperte || [];
  window.unsubPrenAperte = onSnapshot(
    query(collection(window.db,"prenotazioni"), where("stato","==","creata")),
    (snapshot) => {
      window.prenotazioniAperte = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
      if(window.currentUser?.role !== 'portineria') renderSearch();
    },
    err => console.error('Errore listener prenotazioni aperte:', err)
  );

  // Listener veicoli non trovati (statistiche): solo orderBy, nessun indice composito
  window.nonTrovatiCache = window.nonTrovatiCache || [];
  const ntq = query(collection(window.db,"veicoliNonTrovati"), orderBy("ts","desc"), limit(200));
  window.unsubNonTrovati = onSnapshot(ntq, (snapshot) => {
    window.nonTrovatiCache = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
    if(window.currentUser?.role !== 'portineria') renderStatistiche();
  }, err => console.error('Errore listener veicoli non trovati:', err));

  // Listener missioni completate (statistiche "Missioni per tipo"): una sola
  // equality → nessun indice composito. Volumi contenuti dal backup mensile.
  window.prenCompletateCache = window.prenCompletateCache || [];
  window.unsubPrenCompletate = onSnapshot(
    query(collection(window.db,"prenotazioni"), where("stato","==","completata")),
    (snapshot) => {
      window.prenCompletateCache = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
      if(window.currentUser?.role !== 'portineria') renderStatistiche();
    },
    err => console.error('Errore listener missioni completate:', err)
  );

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
  if(window.unsubNonTrovati){ window.unsubNonTrovati();window.unsubNonTrovati=null; }
  if(window.unsubPrenAperte){ window.unsubPrenAperte();window.unsubPrenAperte=null; }
  if(window.unsubPrenCompletate){ window.unsubPrenCompletate();window.unsubPrenCompletate=null; }
  if(window.NavetteCore) window.NavetteCore.stopNavetteListener();
}

window.startListeners = startListeners;
window.stopListeners  = stopListeners;
