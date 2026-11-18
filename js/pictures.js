// Ready-made Christmas pictures for Blind Drawing, each built up one simple step at a time
// (finger-friendly: circles, triangles, boxes and lines — no fine detail).
// Coordinates are 0–1000 in a square. Each stroke is encoded as "x,y,x,y,…" (see draw.js).

const R = Math.round;
const enc = (pts) => pts.map(([x, y]) => `${R(x)},${R(y)}`).join(",");
const circle = (cx, cy, r, n = 28) => enc(Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]));
const oval = (cx, cy, rx, ry, n = 30) => enc(Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]));
const shape = (...pts) => enc([...pts, pts[0]]); // closed
const line = (...pts) => enc(pts);
const box = (x1, y1, x2, y2) => shape([x1, y1], [x2, y1], [x2, y2], [x1, y2]);
const star = (cx, cy, r) => shape(...Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r * 0.42 : r, a = -Math.PI / 2 + (i * Math.PI) / 5; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }));
const arc = (cx, cy, r, from, to, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const a = ((from + ((to - from) * i) / n) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

export const PICTURES = [
  { key: "snowman", name: "Snowman & tree", steps: [
    { text: "Draw a snowman: three circles stacked, biggest at the bottom", strokes: [circle(380, 790, 140), circle(380, 560, 100), circle(380, 390, 70)] },
    { text: "Draw a Christmas tree in the top right corner", strokes: [shape([800, 70], [670, 340], [930, 340]), box(775, 340, 825, 400)] },
    { text: "Give the snowman a carrot nose", strokes: [shape([388, 380], [470, 395], [388, 408])] },
  ] },
  { key: "tree", name: "Christmas tree", steps: [
    { text: "Draw a big triangle for the tree", strokes: [shape([500, 130], [230, 770], [770, 770])] },
    { text: "Add a trunk under the tree", strokes: [box(450, 770, 550, 900)] },
    { text: "Put a star on top", strokes: [star(500, 115, 75)] },
    { text: "Hang three round ornaments on the tree", strokes: [circle(430, 500, 28), circle(575, 590, 28), circle(470, 680, 28)] },
  ] },
  { key: "present", name: "Present", steps: [
    { text: "Draw a big square box", strokes: [box(250, 420, 750, 900)] },
    { text: "Draw a ribbon: one line down the middle, one across", strokes: [line([500, 420], [500, 900]), line([250, 660], [750, 660])] },
    { text: "Put a bow on top: two triangles", strokes: [shape([500, 420], [370, 320], [380, 440]), shape([500, 420], [630, 320], [620, 440])] },
  ] },
  { key: "candycane", name: "Candy cane", steps: [
    { text: "Draw a candy cane: a tall line with a hook at the top", strokes: [enc([[580, 900], [580, 360], ...arc(470, 360, 110, 0, -180, 18).slice(1), [360, 450]])] },
    { text: "Add four stripes across the stick", strokes: [500, 600, 700, 800].map((y) => line([530, y + 25], [630, y - 25])) },
  ] },
  { key: "stocking", name: "Stocking", steps: [
    { text: "Draw a stocking: a big boot shape", strokes: [shape([400, 260], [600, 260], [600, 640], [760, 700], [760, 860], [520, 860], [400, 760])] },
    { text: "Draw the fluffy cuff across the top", strokes: [box(370, 180, 630, 260)] },
    { text: "Put a star on the toe", strokes: [star(660, 780, 50)] },
  ] },
  { key: "ornament", name: "Ornament", steps: [
    { text: "Draw a big circle", strokes: [circle(500, 590, 260)] },
    { text: "Add a little square cap on top", strokes: [box(450, 285, 550, 335)] },
    { text: "Draw a small loop above the cap", strokes: [circle(500, 250, 35)] },
    { text: "Draw a zigzag across the middle", strokes: [line([250, 590], [320, 530], [390, 590], [460, 530], [530, 590], [600, 530], [670, 590], [745, 530])] },
  ] },
  { key: "gingerbread", name: "Gingerbread man", steps: [
    { text: "Draw a circle for the head", strokes: [circle(500, 240, 105)] },
    { text: "Draw a big oval body underneath", strokes: [oval(500, 555, 145, 195)] },
    { text: "Add two arms sticking out", strokes: [line([360, 470], [200, 390]), line([640, 470], [800, 390])] },
    { text: "Add two legs", strokes: [line([440, 735], [370, 910]), line([560, 735], [630, 910])] },
    { text: "Draw three buttons down his tummy", strokes: [circle(500, 470, 18), circle(500, 560, 18), circle(500, 650, 18)] },
  ] },
  { key: "santahat", name: "Santa hat", steps: [
    { text: "Draw a tall triangle hat leaning to the right", strokes: [shape([260, 700], [740, 700], [680, 210])] },
    { text: "Draw the fluffy band along the bottom", strokes: [box(220, 700, 780, 810)] },
    { text: "Add a pom-pom at the tip", strokes: [circle(680, 190, 60)] },
  ] },
  { key: "wreath", name: "Wreath", steps: [
    { text: "Draw a big circle", strokes: [circle(500, 500, 300)] },
    { text: "Draw a smaller circle inside it", strokes: [circle(500, 500, 165)] },
    { text: "Put a bow at the bottom: two triangles", strokes: [shape([500, 800], [370, 730], [370, 870]), shape([500, 800], [630, 730], [630, 870])] },
  ] },
  { key: "candle", name: "Candle", steps: [
    { text: "Draw a tall rectangle for the candle", strokes: [box(420, 400, 580, 900)] },
    { text: "Draw a flame on top", strokes: [shape([500, 220], [565, 320], [500, 380], [435, 320])] },
    { text: "Add a holly leaf on each side at the bottom", strokes: [shape([420, 870], [330, 800], [230, 860], [320, 930]), shape([580, 870], [670, 800], [770, 860], [680, 930])] },
  ] },
];

export const BUILTIN = "builtin:";
export const isBuiltin = (id) => String(id || "").startsWith(BUILTIN);
export const builtin = (id) => (isBuiltin(id) ? PICTURES.find((p) => BUILTIN + p.key === id) || null : null);
// Every stroke of a ready-made picture (what drawings are judged against).
export const builtinStrokes = (id) => { const p = builtin(id); return p ? p.steps.flatMap((s) => s.strokes) : null; };
