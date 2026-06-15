// ── firebase-config.js ────────────────────────────────────────────────────────
import { initializeApp }           from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
         createUserWithEmailAndPassword }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: "AIzaSyCJK372CJBjsBoGRLiOjCcwpYxDJ5hpyls",
  authDomain: "gestione-parcheggi-calpnt.firebaseapp.com",
  projectId: "gestione-parcheggi-calpnt",
  storageBucket: "gestione-parcheggi-calpnt.firebasestorage.app",
  messagingSenderId: "977997780262",
  appId: "1:977997780262:web:759e979e5af89832049de7",
  measurementId: "G-FMT349YN05"
};

const app   = initializeApp(firebaseConfig);
window.auth = getAuth(app);
window.db   = getFirestore(app);
