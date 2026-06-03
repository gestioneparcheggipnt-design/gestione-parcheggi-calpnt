// ── firebase-config.js ────────────────────────────────────────────────────────
// Inizializzazione Firebase + Auth + Firestore
// Importato da mobile.html e index.html

import { initializeApp }       from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection,
         query, orderBy, limit, where, onSnapshot, addDoc, serverTimestamp, getDocs, deleteDoc }
                                from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJK372CJBjsBoGRLiOjCcwpYxDJ5hpyls",
  authDomain: "gestione-parcheggi-calpnt.firebaseapp.com",
  projectId: "gestione-parcheggi-calpnt",
  storageBucket: "gestione-parcheggi-calpnt.firebasestorage.app",
  messagingSenderId: "977997780262",
  appId: "1:977997780262:web:759e979e5af89832049de7"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export {
  app, auth, db,
  // re-export Firebase functions usate dagli altri moduli
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection,
  query, orderBy, limit, where, onSnapshot, addDoc, serverTimestamp, getDocs, deleteDoc
};
