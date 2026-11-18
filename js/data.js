// Data layer: Firestore I/O, clock sync, and running engine actions in transactions.
import { db } from "./firebase.js";
import * as E from "./engine.js";
import * as B from "./bank.js";
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
let PCACHE = [];
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
  return onSnapshot(playersCol, (snap) => {
    PCACHE = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    cb(PCACHE);
  }, err);
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
    const m = E.migrate(snap.exists() ? snap.data() : null);
    if (!m) return;                          // already up to date
    if (m.full) tx.set(stateRef, m.full);    // brand new (or very old) game
    else tx.update(stateRef, m.patch);       // add new features without touching a game in progress
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
    outcome = fn(snap.data(), params, { now: serverNow(), questions: QCACHE, players: PCACHE, deviceId: deviceId() });
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
// On load: is this phone still in the game? If the host deleted its name (or started over),
// the phone is released and must enter a name again. Returns true if still registered.
export async function registerSelf() {
  const me = getLocalIdentity();
  if (!me) return false;
  const snap = await getDoc(doc(playersCol, deviceId()));
  if (snap.exists()) return true;
  clearLocalIdentity();
  return false;
}
// A player without a phone, added by the host (they can still be drawn for mini games).
export async function addPlayer(name, team) {
  const ref = doc(playersCol);
  await setDoc(ref, { name, team, deviceId: ref.id, joinedAt: serverNow(), manual: true });
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

// ---------------- question library ----------------
// Each set is one document: state/set-<id>. (The `state` collection is already allowed by
// the Firestore rules, so the library needs no rule changes.)
const stateCol = collection(db, "state");
const setRef = (id) => doc(db, "state", "set-" + id);

export function subscribeSets(cb, err) {
  return onSnapshot(query(stateCol, where("kind", "==", "set")), (snap) => {
    const sets = snap.docs.map((d) => d.data()).filter((s) => s && s.id && Array.isArray(s.clues));
    sets.sort((a, b) => (b.year || 0) - (a.year || 0) || (b.createdAt || 0) - (a.createdAt || 0));
    cb(sets);
  }, err);
}
export async function createSet(set) {
  await setDoc(setRef(set.id), set);
  return set;
}
export async function deleteSet(id) {
  await deleteDoc(setRef(id));
}
// Apply one edit to a set atomically, so two devices (or two quick edits) never overwrite
// each other. Returns true if something changed.
// Edits from this device are queued per set, so quick back-to-back changes (tabbing through
// fields) apply in order instead of racing each other.
const setQueues = new Map();
export function setOp(id, op, params = {}) {
  const run = (setQueues.get(id) || Promise.resolve()).catch(() => {}).then(() => setOpNow(id, op, params));
  setQueues.set(id, run);
  return run;
}
async function setOpNow(id, op, params) {
  let outcome = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(setRef(id));
    if (!snap.exists()) throw new GameError("That question set no longer exists.");
    outcome = B.applyOp(snap.data(), op, params);
    if (!outcome || outcome.error) return;
    tx.set(setRef(id), outcome);
  });
  if (outcome && outcome.error) throw new GameError(outcome.error);
  return !!outcome;
}
// Practice: put the built-in non-Christmas test game on the board and start fresh.
export async function loadTestGame() {
  const res = await fetch("./sets/test-game.txt", { cache: "no-store" });
  if (!res.ok) throw new GameError("Couldn't load the test game — check your connection and try again.");
  const set = B.newSet({ name: "Test game (not Christmas)", clues: B.parsePaste(await res.text()).clues });
  const { rows } = B.toGameRows(set);
  await replaceAllQuestions(rows);
  await newGameFull();
  await act("setLoaded", { id: "test-game", name: "Test game (not Christmas)" });
}
// Put a set's finished clues on the board (replaces the game's current questions).
export async function loadSetIntoGame(set) {
  const { rows, skipped, counts } = B.toGameRows(set);
  if (!counts.r1) throw new GameError("This set has no finished Jeopardy-round questions yet.");
  await replaceAllQuestions(rows);
  await act("setLoaded", { id: set.id, name: set.name });
  return { rows: rows.length, skipped, counts };
}
