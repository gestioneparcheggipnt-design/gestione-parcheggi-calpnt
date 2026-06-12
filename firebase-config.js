// ── IMPORTS FIREBASE ─────────────────────────────────────────────────────────
import { initializeApp }           from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
         query, orderBy, limit, where, onSnapshot, serverTimestamp, getDocs, deleteDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── FIREBASE CONFIG ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCJK372CJBjsBoGRLiOjCcwpYxDJ5hpyls",
  authDomain: "gestione-parcheggi-calpnt.firebaseapp.com",
  projectId: "gestione-parcheggi-calpnt",
  storageBucket: "gestione-parcheggi-calpnt.firebasestorage.app",
  messagingSenderId: "977997780262",
  appId: "1:977997780262:web:759e979e5af89832049de7",
  measurementId: "G-FMT349YN05"
};

// ââ FIREBASE SDK âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const app  = initializeApp(firebaseConfig);
window.auth = getAuth(app);
window.db   = getFirestore(app);



const IMG_W = 3000, IMG_H = 2250;

