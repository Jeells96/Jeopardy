// Data layer: Firestore I/O, clock sync, and running engine actions in transactions.
import { db } from "./firebase.js";
import * as E from "./engine.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, getDocs, writeBatch,
  query, where, runTransaction, serverTimestamp, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const stateRef = doc(db, "state", "game");
const spokenRef = doc(db, "state", "spoken");
const questionsCol = collection(db, "questions");
const playersCol = collection(db, "players");
const buzzesCol = collection(db, "buzzes");

// ---------------- device identity ----------------
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export function deviceId() {
  let id = safeGet("jeop_device_id");
  if (!id) {
    id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    safeSet("jeop_device_id", id);
  }
  return id;
}
export function getLocalIdentity() {
  try { return JSON.parse(safeGet("jeop_identity") || "null"); } catch { return null; }
}
export function setLocalIdentity(name, team) { safeSet("jeop_identity", JSON.stringify({ name, team })); }
export function clearLocalIdentity() { safeDel("jeop_identity"); }

// ---------------- server clock ----------------
// Every countdown uses serverNow() so all phones, the board and the host agree to within
// a few tens of milliseconds, regardless of how wrong each device's own clock is.
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;
export async function syncClock() {
  const ref = doc(db, "state", "clock-" + deviceId());
  let best = null;
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      await setDoc(ref, { t: serverTimestamp() });
      const t1 = Date.now();
      const snap = await getDoc(ref);
      const t = snap.exists() ? snap.data().t : null;
      if (t && t.toMillis) {
        const rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, offset: t.toMillis() - (t0 + t1) / 2 };
      }
    } catch { /* offline or rules not set yet */ }
  }
  if (best) clockOffset = best.offset;
  return best;
}

// ---------------- subscriptions ----------------
let QCACHE = [];
export const questionsCache = () => QCACHE;

export function subscribeState(cb, err) {
  return onSnapshot(stateRef, (s) => cb(s.exists() ? s.data({ serverTimestamps: "estimate" }) : null), err);
}
export function subscribeSpoken(cb, err) {
  return onSnapshot(spokenRef, (s) => cb(s.exists() ? s.data() : null), err);
}
export function subscribeQuestions(cb, err) {
  return onSnapshot(questionsCol, (snap) => {
    QCACHE = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    cb(QCACHE);
  }, err);
}
export function subscribePlayers(cb, err) {
  return onSnapshot(playersCol, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))), err);
}
export function subscribeBuzzes(key, cb, err) {
  const q = query(buzzesCol, where("key", "==", key));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const t = (r) => (r.ts && r.ts.toMillis ? r.ts.toMillis() : r.at || Infinity);
    rows.sort((a, b) => t(a) - t(b));
    cb(rows);
  }, err);
}

// ---------------- game state ----------------
export async function ensureState() {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    if (snap.exists() && snap.data().v === 2) return;
    const old = snap.exists() ? snap.data() : {};
    tx.set(stateRef, E.defaultState({ teamNames: old.teamNames }));
  });
}

export class GameError extends Error {}

// Run an engine action atomically. Returns true if it changed anything.
export async function act(name, params = {}) {
  const fn = E.ACTIONS[name];
  if (!fn) throw new Error("Unknown action " + name);
  let outcome = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    if (!snap.exists()) throw new GameError("The game isn't set up yet — reload the page.");
    outcome = fn(snap.data(), params, { now: serverNow(), questions: QCACHE, deviceId: deviceId() });
    if (!outcome || outcome.error) return;
    if (Object.keys(outcome.set).length) tx.update(stateRef, outcome.set);
    for (const u of outcome.questions || []) tx.update(doc(questionsCol, u.id), u.data);
  });
  if (outcome && outcome.error) throw new GameError(outcome.error);
  return !!outcome;
}

// ---------------- players ----------------
export async function joinGame(name, team) {
  const id = deviceId();
  setLocalIdentity(name, team);
  await setDoc(doc(playersCol, id), { name, team, deviceId: id, joinedAt: serverNow() });
}
export async function registerSelf() {
  const me = getLocalIdentity();
  if (!me) return;
  const ref = doc(playersCol, deviceId());
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { name: me.name, team: me.team, deviceId: deviceId(), joinedAt: serverNow() });
}
export const updatePlayer = (id, patch) => updateDoc(doc(playersCol, id), patch);
export const removePlayer = (id) => deleteDoc(doc(playersCol, id));
export async function clearPlayers() {
  const snap = await getDocs(playersCol);
  await commitInChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
}

// ---------------- questions ----------------
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}
export async function replaceAllQuestions(rows) {
  const existing = await getDocs(questionsCol);
  await commitInChunks(existing.docs.map((d) => (b) => b.delete(d.ref)));
  await commitInChunks(rows.map((r) => (b) => b.set(doc(questionsCol), r)));
}
export async function resetUsed() {
  const snap = await getDocs(questionsCol);
  await commitInChunks(snap.docs.filter((d) => d.data().used).map((d) => (b) => b.update(d.ref, { used: false })));
}

// ---------------- buzzes / live answers ----------------
export async function logBuzz(key, me) {
  try {
    await addDoc(buzzesCol, { key, deviceId: me.deviceId, name: me.name, team: me.team, ts: serverTimestamp(), at: serverNow() });
  } catch { /* the order list is cosmetic; the transaction decides the winner */ }
}
export async function clearBuzzes() {
  const snap = await getDocs(buzzesCol);
  await commitInChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
}
export async function writeSpoken(data) {
  await setDoc(spokenRef, data);
}

export async function newGameFull() {
  await act("newGame");
  await resetUsed();
  await clearBuzzes();
  await writeSpoken({ key: "" }).catch(() => {});
}
