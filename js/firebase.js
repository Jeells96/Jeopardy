// Firebase initialization (modular SDK via CDN — no build step needed).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBQzn4hcka-PM4Ns7OO22p7OgvQ4iQ4do8",
  authDomain: "stocks-b13c5.firebaseapp.com",
  projectId: "stocks-b13c5",
  storageBucket: "stocks-b13c5.firebasestorage.app",
  messagingSenderId: "1011539617993",
  appId: "1:1011539617993:web:9732045209890951634518",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
