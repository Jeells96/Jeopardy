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
function nearest(P, Q) {
  return P.map(([x, y]) => {
    let best = Infinity;
    for (const [u, v] of Q) { const d = (x - u) * (x - u) + (y - v) * (y - v); if (d < best) best = d; }
    return Math.sqrt(best);
  });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function trimmedMean(a, keep) { const s = a.slice().sort((x, y) => x - y); return mean(s.slice(0, Math.max(1, Math.round(s.length * keep)))); }
function chamfer(R, D) {
  return (mean(nearest(R, D)) + trimmedMean(nearest(D, R), 0.8)) / 2;
}
function place(P, deg, mirror, sc = 1, dx = 0, dy = 0) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return P.map(([x, y]) => { const mx = mirror ? -x : x; return [(mx * c - y * s) * sc + dx, (mx * s + y * c) * sc + dy]; });
}
// Lower = closer. Tries every 10° and the mirror image, then fine-tunes the best few fits
// (angle, size and position) and keeps the best.
export function shapeDistance(refEncoded, drawingEncoded) {
  const R = normalize(refEncoded), D = normalize(drawingEncoded);
  if (!R || !D) return Infinity;
  const tries = [];
  for (const mirror of [false, true]) for (let deg = 0; deg < 360; deg += 10) tries.push({ d: chamfer(R, place(D, deg, mirror)), deg, mirror, sc: 1, dx: 0, dy: 0 });
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
          n.d = chamfer(R, place(D, n.deg, n.mirror, n.sc, n.dx, n.dy));
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

// ---------------------------------------------------------------- the drawing pad (browser only)
// Strokes live here, not on the page, so the screen can refresh while someone draws.
const pads = new Map(); // key -> { strokes: [[x,y],…][] }
export const padStrokes = (key) => (pads.get(key) || { strokes: [] }).strokes.filter((s) => s.length).map(encodeStroke);
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
  ctx.lineWidth = Math.max(3, w / 110);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const sx = w / 1000, sy = h / 1000;
  for (const s of (pads.get(key) || { strokes: [] }).strokes) {
    if (!s.length) continue;
    ctx.beginPath();
    ctx.moveTo(s[0][0] * sx, s[0][1] * sy);
    if (s.length === 1) ctx.lineTo(s[0][0] * sx + 0.1, s[0][1] * sy);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0] * sx, s[i][1] * sy);
    ctx.stroke();
  }
}
function bind(canvas) {
  const key = canvas.dataset.pad;
  if (!pads.has(key)) pads.set(key, { strokes: [] });
  const pad = pads.get(key);
  let cur = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)), Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000))];
  };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    cur = [at(e)];
    pad.strokes.push(cur);
    paint(canvas, key);
  });
  canvas.addEventListener("pointermove", (e) => {
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
