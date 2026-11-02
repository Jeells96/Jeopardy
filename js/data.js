// Data layer: all Firestore reads/writes and the buzzer race logic.
import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc,
  getDocs, writeBatch, query, where, orderBy, runTransaction,
  serverTimestamp, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Refs ----
const stateRef = doc(db, "state", "game");
const questionsCol = collection(db, "questions");
const playersCol = collection(db, "players");
const buzzesCol = collection(db, "buzzes");

// ---- Local identity (saved once per device) ----
export function deviceId() {
  let id = localStorage.getItem("jeop_device_id");
  if (!id) {
    id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("jeop_device_id", id);
  }
  return id;
}
export function getLocalIdentity() {
  const raw = localStorage.getItem("jeop_identity");
  return raw ? JSON.parse(raw) : null;
}
export function setLocalIdentity(name, team) {
  localStorage.setItem("jeop_identity", JSON.stringify({ name, team }));
}
export function clearLocalIdentity() {
  localStorage.removeItem("jeop_identity");
}

// ---- Default game state ----
export const DEFAULT_STATE = {
  phase: "lobby", // lobby | question | answering | final | done
  currentQuestionId: null,
  buzzOpen: false,
  buzzRound: 0,
  lockedBuzzer: null, // {deviceId,name,team}
  lockedAt: null, // ms epoch
  blockedTeams: [], // teams that already answered (wrong) this question
  revealAnswer: false,
  mcqSelection: null, // {index, correct}
  spokenAnswer: null, // {deviceId, name, team, text, at, final} — live speech-to-text
  sfx: null, // {sound, at} — one-shot sound cue for host/board devices
  resolved: false, // current question has been scored / closed
  scores: { team1: 0, team2: 0 },
  teamNames: { team1: "Team 1", team2: "Team 2" },
  settings: { answerSeconds: 30, finalSeconds: 60 },
  dailyDouble: null, // {team, wager} when an admin sets up a DD
  final: {
    active: false,
    stage: "idle", // idle | wager | question | reveal | done
    category: "",
    questionId: null,
    deadline: null,
    wagers: {}, // {team1: n, team2: n}
    results: {}, // {team1: 'correct'|'wrong', team2: ...}
  },
};

export async function ensureState() {
  const snap = await getDoc(stateRef);
  if (!snap.exists()) {
    await setDoc(stateRef, DEFAULT_STATE);
  }
  return (await getDoc(stateRef)).data();
}

export function subscribeState(cb, errCb) {
  return onSnapshot(stateRef, (s) => cb(s.exists() ? s.data() : null), errCb);
}
export async function patchState(patch) {
  await setDoc(stateRef, patch, { merge: true });
}
export async function getState() {
  const s = await getDoc(stateRef);
  return s.exists() ? s.data() : null;
}

// ---- Players ----
export async function joinGame(name, team) {
  const id = deviceId();
  setLocalIdentity(name, team);
  await setDoc(doc(playersCol, id), {
    name, team, joinedAt: Date.now(), deviceId: id,
  });
}
export function subscribePlayers(cb, errCb) {
  return onSnapshot(playersCol, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), errCb
  );
}
export async function adminUpdatePlayer(id, patch) {
  await updateDoc(doc(playersCol, id), patch);
}
export async function adminRemovePlayer(id) {
  await deleteDoc(doc(playersCol, id));
}

// ---- Questions ----
export function subscribeQuestions(cb, errCb) {
  return onSnapshot(questionsCol, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), errCb
  );
}
export async function replaceAllQuestions(rows) {
  // Clear existing, then write new in batches of <=450.
  const existing = await getDocs(questionsCol);
  let batch = writeBatch(db);
  let n = 0;
  const flush = async () => { await batch.commit(); batch = writeBatch(db); n = 0; };
  existing.forEach((d) => { batch.delete(d.ref); if (++n >= 450) flush(); });
  if (n > 0) { await batch.commit(); batch = writeBatch(db); n = 0; }
  for (const r of rows) {
    const ref = doc(questionsCol);
    batch.set(ref, r);
    if (++n >= 450) await flush();
  }
  if (n > 0) await batch.commit();
}
export async function setQuestionUsed(id, used) {
  await updateDoc(doc(questionsCol, id), { used });
}

// ---- Buzzers ----
// Log every press (for an ordered display) AND atomically claim "first" via a
// transaction, so the winner is decided on the server regardless of client clocks.
export async function buzz(me, round, answerSeconds) {
  // Record the press for the ordered queue (server timestamp = authoritative order).
  try {
    await addDoc(buzzesCol, {
      round, name: me.name, team: me.team, deviceId: me.deviceId,
      ts: serverTimestamp(), clientTs: Date.now(),
    });
  } catch (e) { /* non-fatal */ }

  // Claim first.
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    const s = snap.data();
    if (!s || !s.buzzOpen || s.buzzRound !== round) return { won: false, reason: "closed" };
    if (s.lockedBuzzer) return { won: false, reason: "taken" };
    if ((s.blockedTeams || []).includes(me.team)) return { won: false, reason: "blocked" };
    tx.update(stateRef, {
      lockedBuzzer: me,
      lockedAt: Date.now(),
      phase: "answering",
      mcqSelection: null,
      spokenAnswer: null,
      "settings.answerSeconds": answerSeconds,
    });
    return { won: true };
  });
}

export function subscribeBuzzes(round, cb, errCb) {
  // Equality-only query (no composite index needed); order on the client by the
  // server timestamp, falling back to the client time until the server resolves it.
  const q = query(buzzesCol, where("round", "==", round));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => {
      const at = a.ts && a.ts.toMillis ? a.ts.toMillis() : (a.clientTs || Infinity);
      const bt = b.ts && b.ts.toMillis ? b.ts.toMillis() : (b.clientTs || Infinity);
      return at - bt;
    });
    cb(rows);
  }, errCb);
}
export async function clearBuzzes() {
  const snap = await getDocs(buzzesCol);
  let batch = writeBatch(db);
  let n = 0;
  snap.forEach((d) => { batch.delete(d.ref); if (++n >= 450) { batch.commit(); batch = writeBatch(db); n = 0; } });
  if (n > 0) await batch.commit();
}

// ---- Sound cues ----
// Sets a one-shot sound event; host/board devices watch `sfx.at` and play it.
export async function playSfx(sound) {
  await patchState({ sfx: { sound, at: Date.now() } });
}

// ---- Scoring ----
export async function addScore(team, delta) {
  const s = await getState();
  const scores = { ...(s.scores || { team1: 0, team2: 0 }) };
  scores[team] = (scores[team] || 0) + delta;
  await patchState({ scores });
}
