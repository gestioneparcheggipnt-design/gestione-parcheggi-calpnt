import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
window.doLogin  = doLogin;
window.doLogout = doLogout;

["loginEmail","loginPass"].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener("keydown", e => { if(e.key==="Enter") doLogin(); });
});



// ââ AUTH ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
onAuthStateChanged(window.auth, async (fbUser) => {
  if (fbUser) {
    // Leggi ruolo da Firestore
    const snap = await getDoc(doc(window.db,"users",fbUser.uid));
    const role    = snap.exists() ? snap.data().role : "autista";
    const name    = snap.exists() ? (snap.data().name || fbUser.email) : fbUser.email;
    const reparto = snap.exists() ? (snap.data().reparto || null) : null;
    window.currentUser = { email: fbUser.email, uid: fbUser.uid, role, name, reparto };
    showApp();
  } else {
    window.currentUser = null;
    showLogin();
    stopListeners();
  }
});

async function doLogin(){
  const username = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pass     = document.getElementById("loginPass").value;
  const errEl    = document.getElementById("loginError");
  const btn      = document.getElementById("loginBtn");
  errEl.style.display="none";
  btn.textContent="Accesso in corso..."; btn.disabled=true;
  try {
    const q    = query(collection(window.db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if(snap.empty){
      errEl.textContent="Utente non trovato."; errEl.style.display="block";
      return;
    }
    const email = snap.docs[0].data().email;
    await signInWithEmailAndPassword(window.auth, email, pass);
    // onAuthStateChanged gestirà il resto
  } catch(e) {
    console.error("doLogin error:", e.code, e.message, e);
    let msg = "Credenziali non valide.";
    if(e.code==="auth/user-not-found"||e.code==="auth/wrong-password"||e.code==="auth/invalid-credential") msg="Username o password errata.";
    if(e.code==="auth/too-many-requests") msg="Troppi tentativi. Riprova tra qualche minuto.";
    if(e.code==="auth/network-request-failed") msg="Errore di rete. Verifica la connessione.";
    errEl.textContent=msg; errEl.style.display="block";
  } finally {
    btn.textContent="Accedi"; btn.disabled=false;
  }
}
async function doLogout(){
  await signOut(window.auth);
}

function showLogin(){
  document.getElementById("loginScreen").style.display="flex";
  document.getElementById("app").style.display="none";
  // Rimuove la classe active da tutte le pagine
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  // Ripristina modeToggle (nascosto per portineria)
  const modeToggleEl = document.getElementById("modeToggle");
  if(modeToggleEl) modeToggleEl.style.display="";
  // Resetta tutti i tab con id alla loro visibilità di default (hidden)
  ["tabStats","tabUtenti","tabPrenotazioni","tabPortineria"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.add("hidden");
  });
  // Ripristina visibilità dei tab Mappa/Ricerca/Storico (non hanno id ma servono sempre)
  document.querySelectorAll(".navTab").forEach(btn=>{
    const pg = btn.getAttribute("onclick") && btn.getAttribute("onclick").match(/'(\w+)'/);
    if(pg && ["Mappa","Ricerca","Storico"].includes(pg[1])){
      btn.classList.remove("hidden");
    }
  });
}

function showApp(){
  // Desktop accessibile ad amministratore, amministrativo e portineria
  const rolesDesktop = ["amministratore","amministrativo","portineria"];
  if(!rolesDesktop.includes(window.currentUser.role)){
    signOut(window.auth);
    const errEl = document.getElementById("loginError");
    if(errEl){
      errEl.textContent = 'Accesso non consentito da desktop per il ruolo "' + window.currentUser.role + '".';
      errEl.style.display = "block";
    }
    return;
  }
  document.getElementById("loginScreen").style.display="none";
  document.getElementById("app").style.display="flex";
  const rb=document.getElementById("navRole");
  rb.textContent=window.currentUser.role; rb.className="roleBadge "+window.currentUser.role;
  const un=document.getElementById("navUserName");
  if(un) un.textContent=window.currentUser.name||window.currentUser.email;

  // ── PORTINERIA ──────────────────────────────────────────────────────────────
  if(window.currentUser.role === "portineria"){
    // Nascondi tab Mappa/Ricerca/Storico (non servono alla portineria)
    document.querySelectorAll(".navTab").forEach(btn=>{
      const pg = btn.getAttribute("onclick") && btn.getAttribute("onclick").match(/'(\w+)'/);
      if(pg && ["Mappa","Ricerca","Storico"].includes(pg[1])){
        btn.classList.add("hidden");
      }
    });
    // Nascondi toggle modalità container/cassa (non serve alla portineria)
    const modeToggleEl = document.getElementById("modeToggle");
    if(modeToggleEl) modeToggleEl.style.display = "none";
    // Mostra tab Portineria
    document.getElementById("tabPortineria").classList.remove("hidden");
    startListeners();
    // Attiva pagina Portineria dopo aver preparato tutto
    showPage("Portineria", document.getElementById("tabPortineria"));
    return;
  }

  // ── AMMINISTRATORE / AMMINISTRATIVO ────────────────────────────────────────
  document.getElementById("tabStats").classList.remove("hidden");
  if(window.currentUser.role==="amministratore") document.getElementById("tabUtenti").classList.remove("hidden");
  document.getElementById("tabPrenotazioni").classList.remove("hidden");
  loadMode();
  initMap();

startListeners();
  renderStatistiche();
  renderUsers();
  showPage("Mappa", document.querySelector(".navTab"));
}



