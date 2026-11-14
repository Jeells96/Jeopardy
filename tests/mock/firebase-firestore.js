// Test stand-in for firebase-firestore.js, backed by tests/server.js.
// Implements the subset of the modular Firestore API the app uses, with the same
// semantics that matter: transactions (optimistic, retried), merge vs update,
// server timestamps, rejecting `undefined`, and live onSnapshot listeners.

const API = "/__fs/";
const params = new URLSearchParams(location.search);
const LATENCY = Number(params.get("lat") || 0); // simulate network latency (ms) for buzz tests

export class Timestamp {
  constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromMillis(ms) { return new Timestamp(ms); }
}
export function serverTimestamp() { return { __sv: "ts" }; }
export function increment(n) { return { __sv: "inc", n }; }
export function deleteField() { return { __sv: "del" }; }

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }

function encode(v, where = "data") {
  if (v === undefined) throw err("invalid-argument", `Unsupported field value: undefined (found in ${where})`);
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map((x, i) => encode(x, `${where}[${i}]`));
  if (v && typeof v === "object") {
    if ("__sv" in v) return v;
    const o = {};
    for (const k of Object.keys(v)) o[k] = encode(v[k], `${where}.${k}`);
    return o;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw err("invalid-argument", `Unsupported number in ${where}`);
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    if ("__ts" in v) return new Timestamp(v.__ts);
    const o = {};
    for (const k of Object.keys(v)) o[k] = decode(v[k]);
    return o;
  }
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(op, body) {
  if (LATENCY) await sleep(LATENCY * (0.5 + Math.random()));
  const r = await fetch(API + op, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// ---------------- refs ----------------
class DocumentReference {
  constructor(segs) { this.type = "document"; this._segs = segs; this.id = segs[segs.length - 1]; this.path = segs.join("/"); this.parent = new CollectionReference(segs.slice(0, -1)); }
}
class CollectionReference {
  constructor(segs) { this.type = "collection"; this._segs = segs; this.id = segs[segs.length - 1]; this.path = segs.join("/"); }
}
class Query {
  constructor(col, constraints) { this.type = "query"; this._col = col; this._constraints = constraints; this.path = col.path; }
}
const DB = { type: "firestore" };
export function getFirestore() { return DB; }

const split = (parts) => parts.flatMap((p) => String(p).split("/")).filter(Boolean);
function autoId() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
export function collection(parent, ...segs) {
  const base = parent && parent._segs ? parent._segs : [];
  return new CollectionReference([...base, ...split(segs)]);
}
export function doc(parent, ...segs) {
  if (parent instanceof CollectionReference && segs.length === 0) return new DocumentReference([...parent._segs, autoId()]);
  const base = parent && parent._segs ? parent._segs : [];
  return new DocumentReference([...base, ...split(segs)]);
}
export function where(field, op, value) { return { kind: "where", field, op, value }; }
export function orderBy(field, dir = "asc") { return { kind: "orderBy", field, dir }; }
export function limit(n) { return { kind: "limit", n }; }
export function query(col, ...constraints) { return new Query(col, constraints); }

// ---------------- snapshots ----------------
function docSnap(ref, entry) {
  return {
    id: ref.id, ref, metadata: { hasPendingWrites: false, fromCache: false },
    exists: () => !!entry,
    data: () => (entry ? decode(JSON.parse(JSON.stringify(entry.data))) : undefined),
    get: (f) => (entry ? f.split(".").reduce((o, k) => (o == null ? o : o[k]), decode(entry.data)) : undefined),
  };
}
const fieldVal = (data, f) => f.split(".").reduce((o, k) => (o == null ? undefined : o[k]), data);
function matches(data, c) {
  const v = fieldVal(data, c.field);
  switch (c.op) {
    case "==": return JSON.stringify(v) === JSON.stringify(c.value);
    case "!=": return JSON.stringify(v) !== JSON.stringify(c.value);
    case "<": return v < c.value; case "<=": return v <= c.value;
    case ">": return v > c.value; case ">=": return v >= c.value;
    case "in": return (c.value || []).some((x) => JSON.stringify(x) === JSON.stringify(v));
    case "array-contains": return Array.isArray(v) && v.some((x) => JSON.stringify(x) === JSON.stringify(c.value));
    default: return false;
  }
}
function runQuery(colPath, constraints, entries) {
  let rows = entries.filter((e) => e.path.startsWith(colPath + "/") && !e.path.slice(colPath.length + 1).includes("/"));
  for (const c of constraints) if (c.kind === "where") rows = rows.filter((e) => matches(e.data, c));
  const orders = constraints.filter((c) => c.kind === "orderBy");
  if (orders.length) {
    rows.sort((a, b) => {
      for (const o of orders) {
        let x = fieldVal(a.data, o.field), y = fieldVal(b.data, o.field);
        if (x && x.__ts !== undefined) x = x.__ts; if (y && y.__ts !== undefined) y = y.__ts;
        if (x < y) return o.dir === "desc" ? 1 : -1;
        if (x > y) return o.dir === "desc" ? -1 : 1;
      }
      return 0;
    });
  }
  const lim = constraints.find((c) => c.kind === "limit");
  if (lim) rows = rows.slice(0, lim.n);
  return rows;
}
function querySnap(rows) {
  const docs = rows.map((e) => docSnap(new DocumentReference(e.path.split("/")), e));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}

// ---------------- live cache ----------------
const cache = new Map(); // path -> {path, data, version}
const listeners = new Set();
let ready = false;
const es = new EventSource(API + "stream");
es.addEventListener("init", (ev) => {
  cache.clear();
  for (const e of JSON.parse(ev.data)) cache.set(e.path, e);
  ready = true;
  for (const l of listeners) fire(l);
});
es.addEventListener("change", (ev) => {
  const changes = JSON.parse(ev.data);
  const touched = new Set();
  for (const c of changes) {
    if (c.reset) { cache.clear(); for (const l of listeners) touched.add(l); continue; }
    if (c.data === null) cache.delete(c.path); else cache.set(c.path, c);
    for (const l of listeners) if (affects(l, c.path)) touched.add(l);
  }
  for (const l of touched) fire(l);
});
function affects(l, p) {
  if (l.kind === "doc") return l.path === p;
  return p.startsWith(l.colPath + "/") && !p.slice(l.colPath.length + 1).includes("/");
}
function fire(l) {
  if (!l.active) return;
  try {
    if (l.kind === "doc") l.next(docSnap(l.ref, cache.get(l.path)));
    else l.next(querySnap(runQuery(l.colPath, l.constraints, [...cache.values()])));
  } catch (e) { console.error(e); }
}
export function onSnapshot(target, next, error) {
  const l = target.type === "document"
    ? { kind: "doc", ref: target, path: target.path, next, error, active: true }
    : { kind: "query", colPath: target.type === "query" ? target._col.path : target.path, constraints: target.type === "query" ? target._constraints : [], next, error, active: true };
  listeners.add(l);
  if (ready) queueMicrotask(() => fire(l));
  return () => { l.active = false; listeners.delete(l); };
}

// ---------------- reads/writes ----------------
export async function getDoc(ref) {
  const r = await post("get", { path: ref.path });
  return docSnap(ref, r.body.exists ? { data: r.body.data } : null);
}
export async function getDocs(target) {
  const col = target.type === "query" ? target._col : target;
  const r = await post("list", { collection: col.path });
  return querySnap(runQuery(col.path, target.type === "query" ? target._constraints : [], r.body.docs));
}
async function commitWrites(writes, pre) {
  const r = await post("commit", { writes, pre });
  if (r.status === 200) return;
  throw err(r.body.error || "unknown", r.body.message);
}
const w = {
  set: (ref, data, opts) => ({ op: "set", path: ref.path, data: encode(data), merge: !!(opts && opts.merge) }),
  update: (ref, data) => ({ op: "update", path: ref.path, data: encode(data) }),
  del: (ref) => ({ op: "delete", path: ref.path }),
};
export async function setDoc(ref, data, opts) { await commitWrites([w.set(ref, data, opts)]); }
export async function updateDoc(ref, data) { await commitWrites([w.update(ref, data)]); }
export async function deleteDoc(ref) { await commitWrites([w.del(ref)]); }
export async function addDoc(col, data) { const ref = doc(col); await setDoc(ref, data); return ref; }
export function writeBatch() {
  const writes = [];
  const b = {
    set(ref, data, opts) { writes.push(w.set(ref, data, opts)); return b; },
    update(ref, data) { writes.push(w.update(ref, data)); return b; },
    delete(ref) { writes.push(w.del(ref)); return b; },
    commit() { return commitWrites(writes); },
  };
  return b;
}
export async function runTransaction(_db, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const reads = {};
    const writes = [];
    const tx = {
      async get(ref) {
        const r = await post("get", { path: ref.path });
        reads[ref.path] = r.body.version || 0;
        return docSnap(ref, r.body.exists ? { data: r.body.data } : null);
      },
      set(ref, data, opts) { writes.push(w.set(ref, data, opts)); return tx; },
      update(ref, data) { writes.push(w.update(ref, data)); return tx; },
      delete(ref) { writes.push(w.del(ref)); return tx; },
    };
    const result = await fn(tx);
    if (!writes.length) return result;
    const r = await post("commit", { writes, pre: reads });
    if (r.status === 200) return result;
    if (r.body.error !== "aborted") throw err(r.body.error, r.body.message);
    await sleep(10 + Math.random() * 40 * (attempt + 1));
  }
  throw err("aborted", "Transaction failed after retries");
}
