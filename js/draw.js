// Blind drawing: the drawing pad, how drawings are stored, and the judge that decides
// whose drawing is closest to the host's picture.
//
// A drawing is a list of strokes; each stroke is a string "x,y,x,y,…" with whole numbers
// 0–1000 (Firestore can't store arrays inside arrays, so strokes are strings).
//
// The judge compares SHAPES, not placement: both drawings are centred, scaled to the same
// size, and the player's drawing is tried at every angle (and mirrored, since drawing with a
// phone on your head often comes out backwards). The best fit is scored.

// ---------------------------------------------------------------- encoding
export function encodeStroke(points) {
  return points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(",");
}
export function decodeStroke(str) {
  const n = String(str || "").split(",").map(Number);
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) out.push([n[i], n[i + 1]]);
  return out;
}
export const decode = (strokes) => (Array.isArray(strokes) ? strokes.map(decodeStroke).filter((s) => s.length) : []);
export const inkCount = (strokes) => decode(strokes).reduce((n, s) => n + s.length, 0);

// ---------------------------------------------------------------- the judge
// Points spread evenly along every line (so a long line and a scribble of the same length
// count the same no matter how fast they were drawn).
function resample(strokes, spacing) {
  const pts = [];
  for (const s of strokes) {
    if (s.length === 1) { pts.push(s[0]); continue; }
    pts.push(s[0]);
    let carry = 0;
    for (let i = 1; i < s.length; i++) {
      const [x0, y0] = s[i - 1], [x1, y1] = s[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let d = spacing - carry;
      while (d <= len) { const t = d / len; pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); d += spacing; }
      carry = len - (d - spacing);
    }
  }
  return pts;
}
const lengthOf = (strokes) => strokes.reduce((n, s) => n + s.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0), 0);

// Centre on the middle of the ink and scale it to a standard size. Stray lines far from
// the rest are ignored when finding the middle and the size (a few wild scribbles from a
// phone on someone's head shouldn't shift the whole drawing).
export function normalize(strokesEncoded, maxPoints = 240) {
  const strokes = decode(strokesEncoded);
  const len = lengthOf(strokes);
  if (!strokes.length || len < 1) return null;
  let pts = resample(strokes, Math.max(len / maxPoints, 1));
  if (pts.length > maxPoints * 1.3) pts = pts.filter((_, i) => i % Math.ceil(pts.length / maxPoints) === 0);
  let core = pts, cx = 0, cy = 0, r = 0;
  for (let pass = 0; pass < 3; pass++) {
    cx = core.reduce((a, p) => a + p[0], 0) / core.length;
    cy = core.reduce((a, p) => a + p[1], 0) / core.length;
    const dist = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)).sort((x, y) => x - y);
    r = Math.sqrt(core.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / core.length);
    const cut = dist[Math.floor(dist.length * 0.85)]; // keep the closest 85% of the ink
    const next = pts.filter((p) => Math.hypot(p[0] - cx, p[1] - cy) <= cut);
    if (next.length < 8) break;
    core = next;
  }
  if (r < 8) return null; // a dot, not a drawing
  return pts.map(([x, y]) => [(x - cx) / r, (y - cy) / r]);
}
// How far each point is from the nearest point of the other drawing, averaged both ways:
// missing parts count against you, and so do extra lines — but the worst 20% of a player's
// ink is forgiven, so a couple of wild strokes don't sink an otherwise good drawing.
// (Points are kept in flat number arrays: judging 30 drawings has to be quick.)
const flat = (P) => {
  const n = P.length, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = P[i][0]; y[i] = P[i][1]; }
  return { x, y, n };
};
function nearest(A, B, out) {
  const ax = A.x, ay = A.y, bx = B.x, by = B.y, nb = B.n;
  for (let i = 0; i < A.n; i++) {
    const px = ax[i], py = ay[i];
    let best = Infinity;
    for (let j = 0; j < nb; j++) { const dx = px - bx[j], dy = py - by[j], d = dx * dx + dy * dy; if (d < best) best = d; }
    out[i] = Math.sqrt(best);
  }
  return out;
}
function chamfer(R, D, bufR, bufD) {
  nearest(R, D, bufR);
  let a = 0;
  for (let i = 0; i < R.n; i++) a += bufR[i];
  nearest(D, R, bufD);
  bufD.sort();
  const keep = Math.max(1, Math.round(D.n * 0.8));
  let b = 0;
  for (let i = 0; i < keep; i++) b += bufD[i];
  return (a / R.n + b / keep) / 2;
}
function place(D, deg, mirror, sc = 1, dx = 0, dy = 0, out) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a) * sc, s = Math.sin(a) * sc;
  for (let i = 0; i < D.n; i++) {
    const mx = mirror ? -D.x[i] : D.x[i], y = D.y[i];
    out.x[i] = mx * c - y * s + dx;
    out.y[i] = mx * s + y * c + dy;
  }
  return out;
}
// Lower = closer. Tries every 10° and the mirror image, then fine-tunes the best few fits
// (angle, size and position) and keeps the best.
export function shapeDistance(refEncoded, drawingEncoded) {
  const R0 = normalize(refEncoded), D0 = normalize(drawingEncoded);
  if (!R0 || !D0) return Infinity;
  const R = flat(R0), D = flat(D0);
  const P = { x: new Float64Array(D.n), y: new Float64Array(D.n), n: D.n };
  const bufR = new Float64Array(R.n), bufD = new Float64Array(D.n);
  const score = (deg, mirror, sc, dx, dy) => chamfer(R, place(D, deg, mirror, sc, dx, dy, P), bufR, bufD);
  const tries = [];
  for (const mirror of [false, true]) for (let deg = 0; deg < 360; deg += 10) tries.push({ d: score(deg, mirror, 1, 0, 0), deg, mirror, sc: 1, dx: 0, dy: 0 });
  tries.sort((x, y) => x.d - y.d);
  let best = tries[0];
  for (const t of tries.slice(0, 3)) {
    let cur = t;
    for (const step of [0.2, 0.1]) {
      let improved = true;
      while (improved) {
        improved = false;
        const moves = [
          { deg: cur.deg + step * 25 }, { deg: cur.deg - step * 25 },
          { sc: cur.sc * (1 + step) }, { sc: cur.sc / (1 + step) },
          { dx: cur.dx + step }, { dx: cur.dx - step }, { dy: cur.dy + step }, { dy: cur.dy - step },
        ];
        for (const m of moves) {
          const n = { ...cur, ...m };
          if (n.sc < 0.6 || n.sc > 1.6 || Math.abs(n.dx) > 0.8 || Math.abs(n.dy) > 0.8) continue;
          n.d = score(n.deg, n.mirror, n.sc, n.dx, n.dy);
          if (n.d < cur.d - 1e-6) { cur = n; improved = true; }
        }
      }
    }
    if (cur.d < best.d) best = cur;
  }
  return best.d;
}
// 0–100 "match" for showing on screen (the winner is simply the higher number).
export function matchPercent(refEncoded, drawingEncoded) {
  const d = shapeDistance(refEncoded, drawingEncoded);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-((d / 0.11) ** 1.6)))));
}

// ---------------------------------------------------------------- showing a drawing
export function svg(strokesEncoded, cls = "") {
  const lines = decode(strokesEncoded).map((s) =>
    s.length === 1 ? `<circle cx="${s[0][0]}" cy="${s[0][1]}" r="9"/>` : `<polyline points="${s.map((p) => p.join(",")).join(" ")}"/>`).join("");
  return `<svg class="drawing ${cls}" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${lines}</svg>`;
}

// A ready-made picture up to step `upto` (0-based): earlier steps in black, the newest in red.
export function svgSteps(steps, upto, cls = "") {
  const parts = [];
  steps.forEach((st, i) => {
    if (i > upto) return;
    for (const s of decode(st.strokes)) {
      const c = i === upto ? "now" : "done";
      parts.push(s.length === 1 ? `<circle class="${c}" cx="${s[0][0]}" cy="${s[0][1]}" r="9"/>` : `<polyline class="${c}" points="${s.map((p) => p.join(",")).join(" ")}"/>`);
    }
  });
  return `<svg class="drawing steps ${cls}" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------- the drawing pad (browser only)
// Strokes live here, not on the page, so the screen can refresh while someone draws.
const pads = new Map(); // key -> { strokes: [[x,y],…][] }
export const padStrokes = (key) => (pads.get(key) || { strokes: [] }).strokes.filter((s) => s.length).map(encodeStroke);
// A pad that's locked takes no ink (before the drawing starts, and after pencils down).
export function lockPad(key, locked) {
  if (!pads.has(key)) pads.set(key, { strokes: [] });
  pads.get(key).locked = !!locked;
}
// Pad pixels <-> drawing units. The drawing is a 0–1000 square; a pad that isn't square
// sits in the middle of it, so shapes keep their proportions on any screen.
function frame(rect) {
  const S = Math.max(1, rect.width, rect.height);
  return { S, ox: (S - rect.width) / 2, oy: (S - rect.height) / 2 };
}
export function clearPad(key) {
  const p = pads.get(key);
  if (p) p.strokes = [];
  const c = typeof document !== "undefined" && document.querySelector(`canvas[data-pad="${CSS.escape(key)}"]`);
  if (c) paint(c, key);
}
function paint(canvas, key) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#111";
  const f = frame(rect);
  const k = (f.S * dpr) / 1000;
  ctx.lineWidth = Math.max(3, (f.S * dpr) / 110);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const X = (x) => x * k - f.ox * dpr, Y = (y) => y * k - f.oy * dpr;
  for (const s of (pads.get(key) || { strokes: [] }).strokes) {
    if (!s.length) continue;
    ctx.beginPath();
    ctx.moveTo(X(s[0][0]), Y(s[0][1]));
    if (s.length === 1) ctx.lineTo(X(s[0][0]) + 0.1, Y(s[0][1]));
    for (let i = 1; i < s.length; i++) ctx.lineTo(X(s[i][0]), Y(s[i][1]));
    ctx.stroke();
  }
}
function bind(canvas) {
  const key = canvas.dataset.pad;
  if (!pads.has(key)) pads.set(key, { strokes: [] });
  const pad = pads.get(key);
  let cur = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect(), f = frame(r);
    const u = (v) => Math.max(0, Math.min(1000, (v / f.S) * 1000));
    return [u(e.clientX - r.left + f.ox), u(e.clientY - r.top + f.oy)];
  };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (pad.locked) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    cur = [at(e)];
    pad.strokes.push(cur);
    paint(canvas, key);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (cur && pad.locked) cur = null; // pencils down mid-line
    if (!cur) return;
    e.preventDefault();
    const p = at(e), last = cur[cur.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 4) return; // keep it light
    cur.push(p);
    if (pad.strokes.reduce((n, s) => n + s.length, 0) > 4000) { cur = null; return; } // plenty of ink
    paint(canvas, key);
  });
  const end = () => { cur = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  // No scrolling, zooming or long-press menus while drawing (the phone is on someone's head).
  for (const ev of ["touchstart", "touchmove", "touchend", "gesturestart"]) canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas._bound = true;
  paint(canvas, key);
}
// Call after every render: wires up any new pads and repaints resized ones.
export function mountPads() {
  if (typeof document === "undefined") return;
  for (const c of document.querySelectorAll("canvas[data-pad]")) {
    if (!c._bound) bind(c);
    else {
      const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (Math.round(r.width * dpr) !== c.width || Math.round(r.height * dpr) !== c.height) paint(c, c.dataset.pad);
    }
  }
}

// "Hold to submit": a press-and-hold button, so a stray touch can't send a drawing early.
export function initHoldButtons(onDone) {
  if (typeof document === "undefined") return;
  let timer = null, btn = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; if (btn) btn.classList.remove("holding"); btn = null; };
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest && e.target.closest("[data-hold]");
    if (!b || b.disabled) return;
    e.preventDefault();
    cancel();
    btn = b;
    b.classList.add("holding");
    timer = setTimeout(() => { const el = btn; cancel(); onDone(el.dataset.hold, el); }, 900);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(ev, (e) => { if (btn && (ev !== "pointerleave" || e.target === btn)) cancel(); }, true);
}
