// Local dev/test server.
//
//   node tests/server.js            -> http://localhost:8123  (site + in-memory Firestore stand-in)
//
// It serves the site and injects an import map so the Firebase SDK imports resolve to
// tests/mock/*.js, which talk to a tiny in-memory document store here (with transactions,
// merge semantics, server timestamps and live updates over Server-Sent Events).
// This lets several browser contexts (host, board, phones) play a real game locally
// without touching the live Firebase project.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8123);

const IMPORT_MAP = `<script type="importmap">${JSON.stringify({
  imports: {
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js": "/tests/mock/firebase-app.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js": "/tests/mock/firebase-firestore.js",
  },
})}</script>`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".mp3": "audio/mpeg", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// ---------------- in-memory store ----------------
const docs = new Map(); // "col/id" -> { data, version }
const streams = new Set();
let versionCounter = 0;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isSentinel = (v) => v && typeof v === "object" && !Array.isArray(v) && "__sv" in v;
const isTs = (v) => v && typeof v === "object" && !Array.isArray(v) && "__ts" in v;
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v) && !isSentinel(v) && !isTs(v);

function resolveValue(v, existing, now) {
  if (isSentinel(v)) {
    if (v.__sv === "ts") return { __ts: now };
    if (v.__sv === "inc") return (typeof existing === "number" ? existing : 0) + v.n;
    if (v.__sv === "del") return undefined;
    throw new Error("unknown sentinel " + v.__sv);
  }
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, undefined, now));
  if (isMap(v)) {
    const o = {};
    for (const k of Object.keys(v)) {
      const r = resolveValue(v[k], undefined, now);
      if (r !== undefined) o[k] = r;
    }
    return o;
  }
  return v;
}
function deepMerge(target, src, now) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (isSentinel(v) && v.__sv === "del") { delete target[k]; continue; }
    if (isMap(v) && Object.keys(v).length > 0 && isMap(target[k])) {
      target[k] = deepMerge(target[k], v, now);
    } else {
      target[k] = resolveValue(v, target[k], now);
    }
  }
  return target;
}
function applyUpdate(target, src, now) {
  for (const key of Object.keys(src)) {
    const segs = key.split(".");
    let node = target;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!isMap(node[segs[i]])) node[segs[i]] = {};
      node = node[segs[i]];
    }
    const last = segs[segs.length - 1];
    const r = resolveValue(src[key], node[last], now);
    if (r === undefined) delete node[last]; else node[last] = r;
  }
  return target;
}

function commit(writes, pre) {
  const now = Date.now();
  for (const [p, ver] of Object.entries(pre || {})) {
    const cur = docs.get(p);
    if ((cur ? cur.version : 0) !== ver) return { status: 409, body: { error: "aborted" } };
  }
  const staged = new Map();
  const get = (p) => (staged.has(p) ? staged.get(p) : docs.has(p) ? clone(docs.get(p).data) : null);
  for (const w of writes) {
    const cur = get(w.path);
    if (w.op === "set") {
      staged.set(w.path, w.merge && cur ? deepMerge(cur, w.data, now) : resolveValue(w.data, undefined, now));
    } else if (w.op === "update") {
      if (!cur) return { status: 404, body: { error: "not-found", message: "No document to update: " + w.path } };
      staged.set(w.path, applyUpdate(cur, w.data, now));
    } else if (w.op === "delete") {
      staged.set(w.path, null);
    }
  }
  const changes = [];
  for (const [p, data] of staged) {
    if (data === null) {
      if (docs.has(p)) { docs.delete(p); changes.push({ path: p, data: null, version: 0 }); }
    } else {
      const version = ++versionCounter;
      docs.set(p, { data, version });
      changes.push({ path: p, data, version });
    }
  }
  if (changes.length) broadcast(changes);
  return { status: 200, body: { ok: true } };
}

function broadcast(changes) {
  const msg = `event: change\ndata: ${JSON.stringify(changes)}\n\n`;
  for (const res of streams) res.write(msg);
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, url) {
  const op = url.pathname.slice("/__fs/".length);
  if (op === "stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const all = [...docs].map(([p, d]) => ({ path: p, data: d.data, version: d.version }));
    res.write(`event: init\ndata: ${JSON.stringify(all)}\n\n`);
    streams.add(res);
    const ka = setInterval(() => res.write(": ka\n\n"), 15000);
    req.on("close", () => { clearInterval(ka); streams.delete(res); });
    return;
  }
  const body = await readBody(req);
  if (op === "get") {
    const d = docs.get(body.path);
    return json(res, 200, d ? { exists: true, data: d.data, version: d.version } : { exists: false, version: 0 });
  }
  if (op === "list") {
    const prefix = body.collection + "/";
    const out = [];
    for (const [p, d] of docs) {
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) out.push({ path: p, data: d.data, version: d.version });
    }
    return json(res, 200, { docs: out });
  }
  if (op === "commit") {
    const r = commit(body.writes || [], body.pre || {});
    return json(res, r.status, r.body);
  }
  if (op === "reset") { docs.clear(); broadcast([{ reset: true }]); return json(res, 200, { ok: true }); }
  if (op === "dump") return json(res, 200, Object.fromEntries([...docs].map(([p, d]) => [p, d.data])));
  return json(res, 404, { error: "unknown op" });
}

// The page carries a Last-Modified date like GitHub Pages; tests can pretend a newer
// version was deployed (see tests/e2e-update.js).
let deployedAt = Math.floor(Date.now() / 1000) * 1000;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/__fs/")) return handleApi(req, res, url);
  if (url.pathname === "/__deploy") { deployedAt = Math.floor(Date.now() / 1000) * 1000 + 2000; return json(res, 200, { ok: true }); }
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  let body = fs.readFileSync(fp);
  if (p === "/index.html") body = Buffer.from(body.toString().replace("<head>", "<head>\n  " + IMPORT_MAP));
  const head = { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" };
  if (p === "/index.html") head["Last-Modified"] = new Date(deployedAt).toUTCString();
  res.writeHead(200, head);
  res.end(req.method === "HEAD" ? undefined : body);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}`));
}
module.exports = { server, docs, commit };
