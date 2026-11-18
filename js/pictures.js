// Ready-made Christmas pictures for Blind Drawing. Every picture is built up in exactly
// 10 steps on the big screen. Smooth, hand-drawn-looking curves, but nothing tiny
// (no hair, eyelashes or fiddly bits) — it's drawn with a finger, phone on your head.
// Coordinates are 0–1000 in a square. Each stroke is encoded as "x,y,x,y,…" (see draw.js).

const R = Math.round;
const enc = (pts) => pts.map(([x, y]) => `${R(x)},${R(y)}`).join(",");

// --- smooth curves (Catmull-Rom) through the given points ---
function spline(pts, closed, per = 7) {
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(closed ? out[0] : pts[pts.length - 1]);
  return out;
}
const blob = (...pts) => enc(spline(pts, true));      // smooth closed shape
const curve = (...pts) => enc(spline(pts, false));    // smooth open line
const shape = (...pts) => enc([...pts, pts[0]]);      // straight-edged closed shape
const line = (...pts) => enc(pts);                    // straight line(s)
const arcPts = (cx, cy, r, from, to, n = 18) => Array.from({ length: n + 1 }, (_, i) => { const a = ((from + ((to - from) * i) / n) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const circle = (cx, cy, r) => enc(arcPts(cx, cy, r, 0, 360, Math.max(14, R(r / 6))));
const oval = (cx, cy, rx, ry) => enc(Array.from({ length: 33 }, (_, i) => [cx + rx * Math.cos((i / 32) * 2 * Math.PI), cy + ry * Math.sin((i / 32) * 2 * Math.PI)]));
const arc = (cx, cy, r, from, to) => enc(arcPts(cx, cy, r, from, to));
const box = (x1, y1, x2, y2) => shape([x1, y1], [x2, y1], [x2, y2], [x1, y2]);
const roundBox = (x1, y1, x2, y2, r = 30) => blob([x1 + r, y1], [x2 - r, y1], [x2, y1 + r], [x2, y2 - r], [x2 - r, y2], [x1 + r, y2], [x1, y2 - r], [x1, y1 + r]);
const star = (cx, cy, r) => shape(...Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / 5; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }));
const heart = (cx, cy, s) => blob([cx, cy - s * 0.35], [cx + s * 0.45, cy - s * 0.85], [cx + s, cy - s * 0.45], [cx + s * 0.6, cy + s * 0.25], [cx, cy + s * 0.85], [cx - s * 0.6, cy + s * 0.25], [cx - s, cy - s * 0.45], [cx - s * 0.45, cy - s * 0.85]);
// A snowflake: three crossing lines, each with little branches near both ends (one stroke each).
const snowflake = (cx, cy, r) => [0, 60, 120].map((deg) => {
  const a = (deg * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const at = (k) => [cx + ux * r * k, cy + uy * r * k];
  const branch = (k, s) => [cx + ux * r * (k + s * 0.28) + vx * r * 0.24, cy + uy * r * (k + s * 0.28) + vy * r * 0.24];
  const branch2 = (k, s) => [cx + ux * r * (k + s * 0.28) - vx * r * 0.24, cy + uy * r * (k + s * 0.28) - vy * r * 0.24];
  const P = at(0.6), Q = at(-0.6);
  return line(at(1), P, branch(0.6, 1), P, branch2(0.6, 1), P, Q, branch(-0.6, -1), Q, branch2(-0.6, -1), Q, at(-1));
});
const mirror = (pts) => pts.map(([x, y]) => [1000 - x, y]);
const wave = (x1, y1, x2, y2, bumps = 3, amp = 14) => { const n = bumps * 2; const pts = []; for (let i = 0; i <= n; i++) { const t = i / n, nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1; const s = (i % 2 ? 1 : -1) * (i === 0 || i === n ? 0 : amp); pts.push([x1 + (x2 - x1) * t + (nx / l) * s, y1 + (y2 - y1) * t + (ny / l) * s]); } return curve(...pts); };

// --- reused parts ---
const santaHat = (left, brimY, right, tipX, tipY) => blob([left, brimY], [left + 30, brimY - 120], [left + 120, brimY - 205], [left + 250, brimY - 215], [tipX - 70, tipY - 120], [tipX, tipY - 20], [tipX - 40, tipY - 25], [tipX - 110, tipY - 95], [right - 20, brimY - 120], [right, brimY]);
const gingerOutline = [[500, 105], [585, 125], [625, 195], [605, 270], [565, 310], [650, 325], [780, 335], [835, 375], [810, 430], [665, 440], [640, 560], [700, 790], [700, 865], [620, 885], [565, 850], [500, 655], [435, 850], [380, 885], [300, 865], [300, 790], [360, 560], [335, 440], [190, 430], [165, 375], [220, 335], [350, 325], [435, 310], [395, 270], [375, 195], [415, 125]];

export const PICTURES = [
  { key: "snowman", name: "Snowman", steps: [
    { text: "Draw a big circle for the bottom of the snowman", strokes: [circle(420, 770, 165)] },
    { text: "Draw a medium circle on top of it", strokes: [circle(420, 505, 115)] },
    { text: "Draw a small circle on top for his head", strokes: [circle(420, 310, 88)] },
    { text: "Give him a tall top hat", strokes: [shape([320, 238], [520, 238], [520, 212], [482, 212], [482, 95], [358, 95], [358, 212], [320, 212])] },
    { text: "Draw two eyes", strokes: [circle(388, 288, 19), circle(452, 288, 19)] },
    { text: "Add a carrot nose pointing to the right", strokes: [shape([418, 318], [505, 332], [418, 346])] },
    { text: "Give him a stick arm on each side", strokes: [line([318, 470], [160, 380]), line([205, 405], [185, 345]), line([522, 470], [690, 380]), line([645, 405], [668, 345])] },
    { text: "Wrap a scarf around his neck with the end hanging down", strokes: [blob([335, 378], [420, 392], [505, 378], [510, 412], [420, 428], [330, 412]), blob([455, 410], [492, 415], [530, 500], [490, 512])] },
    { text: "Draw three buttons down his middle", strokes: [circle(420, 462, 19), circle(420, 525, 19), circle(420, 588, 19)] },
    { text: "Draw a snowflake in the top right corner", strokes: snowflake(810, 175, 95) },
  ] },
  { key: "gingerbread", name: "Gingerbread man", steps: [
    { text: "Draw the gingerbread man's outline — head, arms and legs all in one shape", strokes: [blob(...gingerOutline)] },
    { text: "Give him two eyes", strokes: [circle(462, 192, 20), circle(538, 192, 20)] },
    { text: "Draw a big smile", strokes: [arc(500, 222, 48, 25, 155)] },
    { text: "Add rosy cheeks", strokes: [circle(438, 250, 20), circle(562, 250, 20)] },
    { text: "Put a bow tie under his chin", strokes: [shape([500, 345], [445, 318], [445, 372]), shape([500, 345], [555, 318], [555, 372])] },
    { text: "Draw three buttons down his tummy", strokes: [circle(500, 425, 20), circle(500, 495, 20), circle(500, 565, 20)] },
    { text: "Draw a wavy icing line across his left hand", strokes: [wave(245, 345, 245, 425, 2, 14)] },
    { text: "Draw a wavy icing line across his right hand", strokes: [wave(755, 345, 755, 425, 2, 14)] },
    { text: "Draw a wavy icing line across his left foot", strokes: [wave(310, 810, 405, 820, 2, 13)] },
    { text: "Draw a wavy icing line across his right foot", strokes: [wave(595, 820, 690, 810, 2, 13)] },
  ] },
  { key: "santa", name: "Santa", steps: [
    { text: "Draw Santa's face: a big circle", strokes: [circle(470, 520, 185)] },
    { text: "Draw his floppy hat on top, with the tip hanging down to the right", strokes: [blob([290, 400], [320, 270], [400, 175], [520, 140], [640, 165], [745, 250], [820, 360], [835, 430], [795, 420], [730, 335], [660, 290], [650, 400])] },
    { text: "Add the fluffy white band along the bottom of the hat", strokes: [roundBox(262, 365, 680, 440, 36)] },
    { text: "Put a pom-pom on the tip of the hat", strokes: [circle(840, 470, 52)] },
    { text: "Draw his big fluffy beard around the bottom of his face", strokes: [blob([288, 530], [270, 640], [315, 760], [395, 850], [470, 880], [545, 850], [625, 760], [670, 640], [652, 530], [580, 600], [470, 625], [360, 600])] },
    { text: "Draw a curly mustache under his nose", strokes: [blob([470, 590], [420, 568], [372, 578], [355, 612], [400, 622], [448, 606]), blob([470, 590], [520, 568], [568, 578], [585, 612], [540, 622], [492, 606])] },
    { text: "Give him a big round nose", strokes: [circle(470, 548, 32)] },
    { text: "Draw two eyes", strokes: [circle(405, 490, 21), circle(535, 490, 21)] },
    { text: "Add bushy eyebrows above his eyes", strokes: [blob([360, 465], [405, 445], [450, 462], [405, 470]), blob([490, 462], [535, 445], [580, 465], [535, 470])] },
    { text: "Draw his rosy cheeks", strokes: [circle(345, 535, 27), circle(595, 535, 27)] },
  ] },
  { key: "reindeer", name: "Reindeer", steps: [
    { text: "Draw the reindeer's head: a long rounded shape, narrow at the bottom", strokes: [blob([500, 270], [605, 295], [645, 385], [620, 515], [575, 630], [500, 680], [425, 630], [380, 515], [355, 385], [395, 295])] },
    { text: "Add an ear on each side", strokes: [blob([380, 345], [290, 300], [235, 320], [275, 375], [365, 395]), enc(mirror(spline([[380, 345], [290, 300], [235, 320], [275, 375], [365, 395]], true)))] },
    { text: "Draw the left antler", strokes: [curve([440, 290], [415, 205], [370, 140], [300, 95]), line([412, 200], [330, 185]), line([380, 152], [390, 70])] },
    { text: "Draw the right antler", strokes: [curve([560, 290], [585, 205], [630, 140], [700, 95]), line([588, 200], [670, 185]), line([620, 152], [610, 70])] },
    { text: "Draw two big eyes", strokes: [circle(450, 410, 24), circle(550, 410, 24)] },
    { text: "Give him a big round red nose", strokes: [circle(500, 590, 46)] },
    { text: "Draw a smile under his nose", strokes: [arc(500, 618, 42, 30, 150)] },
    { text: "Add rosy cheeks", strokes: [circle(415, 520, 22), circle(585, 520, 22)] },
    { text: "Draw his neck going down from his head", strokes: [line([445, 665], [420, 900]), line([555, 665], [580, 900])] },
    { text: "Give him a collar with a jingle bell", strokes: [curve([428, 770], [500, 790], [572, 770]), circle(500, 830, 38)] },
  ] },
  { key: "tree", name: "Christmas tree", steps: [
    { text: "Draw the top part of the tree: a small triangle with a curved bottom", strokes: [enc([[500, 130], ...arcPts(500, 120, 205, 118, 62, 10), [500, 130]])] },
    { text: "Draw the middle part under it, a bit wider", strokes: [enc([[400, 290], [330, 470], ...arcPts(500, 270, 260, 130, 50, 10).slice(1), [600, 290]])] },
    { text: "Draw the bottom part, the widest", strokes: [enc([[370, 450], [260, 680], ...arcPts(500, 400, 360, 129, 51, 12).slice(1), [630, 450]])] },
    { text: "Draw the trunk under the tree", strokes: [line([455, 720], [455, 820], [545, 820], [545, 720])] },
    { text: "Put a big star on top", strokes: [star(500, 110, 70)] },
    { text: "Draw a garland swooping across the top part", strokes: [curve([440, 255], [500, 285], [560, 252])] },
    { text: "Draw a garland across the middle part", strokes: [curve([365, 420], [500, 465], [635, 418])] },
    { text: "Draw a garland across the bottom part", strokes: [curve([295, 625], [500, 690], [705, 622])] },
    { text: "Hang five round ornaments on the tree", strokes: [circle(470, 325, 22), circle(572, 382, 22), circle(410, 530, 22), circle(600, 545, 22), circle(500, 612, 22)] },
    { text: "Draw a present under the tree", strokes: [box(590, 760, 730, 870), line([660, 760], [660, 870]), blob([660, 760], [620, 720], [610, 755]), blob([660, 760], [700, 720], [710, 755])] },
  ] },
  { key: "house", name: "Snowy cottage", steps: [
    { text: "Draw the house: a big square", strokes: [box(250, 470, 650, 800)] },
    { text: "Put a triangle roof on top", strokes: [shape([215, 480], [450, 260], [685, 480])] },
    { text: "Add a chimney on the right side of the roof", strokes: [line([560, 363], [560, 245], [620, 245], [620, 419])] },
    { text: "Draw a door with a rounded top in the middle", strokes: [enc([[400, 800], [400, 660], ...arcPts(450, 660, 50, 180, 360, 12), [500, 800]])] },
    { text: "Add a window on each side of the door", strokes: [box(285, 540, 365, 620), line([325, 540], [325, 620]), line([285, 580], [365, 580]), box(535, 540, 615, 620), line([575, 540], [575, 620]), line([535, 580], [615, 580])] },
    { text: "Pile bumpy snow along the roof", strokes: [curve([200, 470], [260, 438], [300, 400], [350, 378], [400, 318], [450, 248], [500, 318], [550, 345], [600, 400], [640, 425], [700, 470])] },
    { text: "Draw smoke curling up out of the chimney", strokes: [curve([590, 235], [560, 195], [610, 160], [575, 120], [625, 80])] },
    { text: "Draw a path from the door to the bottom", strokes: [curve([400, 800], [360, 880], [320, 960]), curve([500, 800], [545, 880], [590, 960])] },
    { text: "Draw a little pine tree to the right of the house", strokes: [shape([820, 520], [740, 720], [900, 720]), line([805, 720], [805, 770], [835, 770], [835, 720])] },
    { text: "Draw a crescent moon in the top left corner", strokes: [enc([...arcPts(170, 170, 95, 60, 300, 18), ...arcPts(215, 170, 75, 252, 108, 14)])] },
  ] },
  { key: "stocking", name: "Stocking", steps: [
    { text: "Draw a big stocking shape", strokes: [blob([400, 260], [600, 260], [600, 590], [650, 645], [770, 690], [805, 765], [760, 840], [620, 850], [480, 815], [400, 735], [390, 600])] },
    { text: "Draw the fluffy cuff across the top", strokes: [roundBox(370, 170, 630, 265, 35)] },
    { text: "Add a hanging loop on top of the cuff, on the left", strokes: [arc(405, 172, 38, 180, 360)] },
    { text: "Draw a curved patch on the heel", strokes: [curve([392, 690], [450, 702], [482, 765], [476, 822])] },
    { text: "Draw a curved patch on the toe", strokes: [curve([705, 668], [690, 755], [718, 846])] },
    { text: "Draw a candy cane sticking out of the top", strokes: [enc([[560, 168], [560, 70], ...arcPts(610, 70, 50, 180, 360, 12), [660, 108]])] },
    { text: "Add three stripes on the candy cane", strokes: [line([542, 158], [580, 130]), line([542, 120], [580, 92]), line([542, 84], [580, 58])] },
    { text: "Draw a present peeking out next to it", strokes: [box(430, 95, 520, 170), line([475, 95], [475, 170])] },
    { text: "Draw a star in the middle of the stocking", strokes: [star(500, 440, 62)] },
    { text: "Draw a snowflake on each side of the stocking", strokes: [...snowflake(200, 420, 70), ...snowflake(830, 330, 70)] },
  ] },
  { key: "penguin", name: "Penguin in a Santa hat", steps: [
    { text: "Draw the penguin's body: a big tall oval", strokes: [oval(500, 590, 205, 290)] },
    { text: "Draw a white belly inside it", strokes: [blob([500, 470], [590, 520], [630, 650], [600, 790], [500, 840], [400, 790], [370, 650], [410, 520])] },
    { text: "Draw a flipper on each side", strokes: [blob([310, 500], [245, 610], [250, 700], [300, 640]), blob([690, 500], [755, 610], [750, 700], [700, 640])] },
    { text: "Draw two feet at the bottom", strokes: [blob([440, 865], [370, 895], [390, 920], [470, 905]), blob([560, 865], [630, 895], [610, 920], [530, 905])] },
    { text: "Draw two eyes", strokes: [circle(450, 400, 20), circle(550, 400, 20)] },
    { text: "Give him a beak pointing down", strokes: [shape([468, 440], [532, 440], [500, 488])] },
    { text: "Put a floppy Santa hat on his head", strokes: [santaHat(345, 330, 655, 790, 360)] },
    { text: "Add the fluffy band on the hat", strokes: [roundBox(325, 302, 675, 360, 28)] },
    { text: "Put a pom-pom on the tip of the hat", strokes: [circle(790, 385, 42)] },
    { text: "Wrap a scarf around his neck with the end hanging down", strokes: [blob([340, 505], [500, 530], [660, 505], [665, 545], [500, 570], [335, 545]), blob([590, 540], [630, 545], [650, 640], [605, 648])] },
  ] },
  { key: "cocoa", name: "Hot cocoa", steps: [
    { text: "Draw a big mug", strokes: [blob([280, 380], [460, 380], [640, 380], [630, 600], [610, 760], [560, 800], [360, 800], [310, 760], [290, 600])] },
    { text: "Draw the handle on the right side", strokes: [curve([636, 450], [740, 450], [775, 540], [730, 640], [622, 680]), curve([634, 505], [700, 510], [715, 560], [690, 610], [626, 628])] },
    { text: "Draw the top of the cocoa: a flat oval", strokes: [oval(460, 380, 180, 38)] },
    { text: "Add three marshmallows floating on top", strokes: [roundBox(375, 345, 435, 390, 14), roundBox(450, 335, 510, 380, 14), roundBox(520, 352, 580, 397, 14)] },
    { text: "Draw steam rising: three wavy lines", strokes: [curve([390, 300], [365, 250], [400, 200], [375, 150]), curve([460, 300], [435, 245], [470, 190], [445, 130]), curve([530, 300], [505, 250], [540, 200], [515, 150])] },
    { text: "Put a candy cane in the mug, hook at the top", strokes: [enc([[595, 365], [615, 215], ...arcPts(660, 215, 45, 180, 360, 12), [705, 255]])] },
    { text: "Add three stripes on the candy cane", strokes: [line([590, 336], [628, 312]), line([595, 296], [633, 272]), line([600, 256], [638, 232])] },
    { text: "Draw a heart on the mug", strokes: [heart(460, 590, 70)] },
    { text: "Draw a plate under the mug", strokes: [oval(460, 815, 270, 45)] },
    { text: "Add a holly leaf and two berries on the plate", strokes: [blob([700, 795], [760, 760], [840, 770], [790, 815]), circle(690, 830, 20), circle(730, 842, 20)] },
  ] },
  { key: "presents", name: "Stack of presents", steps: [
    { text: "Draw a big present at the bottom", strokes: [box(230, 580, 770, 900)] },
    { text: "Draw its ribbon: one line down, one across", strokes: [line([500, 580], [500, 900]), line([230, 740], [770, 740])] },
    { text: "Draw a medium present on top of it", strokes: [box(320, 360, 680, 580)] },
    { text: "Draw its ribbon: one line down, one across", strokes: [line([500, 360], [500, 580]), line([320, 470], [680, 470])] },
    { text: "Draw a small present on the very top", strokes: [box(410, 210, 590, 360)] },
    { text: "Draw a ribbon down the small present", strokes: [line([500, 210], [500, 360])] },
    { text: "Put a big bow on top with two loops", strokes: [blob([500, 210], [430, 140], [395, 175], [455, 215]), blob([500, 210], [570, 140], [605, 175], [545, 215])] },
    { text: "Hang a gift tag off the corner of the big present", strokes: [line([770, 600], [830, 650]), shape([810, 640], [870, 615], [905, 690], [845, 715])] },
    { text: "Draw polka dots on the bottom present", strokes: [circle(320, 650, 22), circle(660, 650, 22), circle(320, 830, 22), circle(660, 830, 22)] },
    { text: "Draw a star on each side of the stack", strokes: [star(140, 300, 60), star(860, 330, 60)] },
  ] },
];

// Nudge a whole picture (used to centre one on the pad).
const shiftAll = (pic, dx, dy) => ({ ...pic, steps: pic.steps.map((st) => ({ ...st, strokes: st.strokes.map((str) => str.split(",").map((v, i) => R(Number(v) + (i % 2 ? dy : dx))).join(",")) })) });
{ const i = PICTURES.findIndex((p) => p.key === "santa"); PICTURES[i] = shiftAll(PICTURES[i], 35, -20); }

export const BUILTIN = "builtin:";
export const isBuiltin = (id) => String(id || "").startsWith(BUILTIN);
export const builtin = (id) => (isBuiltin(id) ? PICTURES.find((p) => BUILTIN + p.key === id) || null : null);
// Every stroke of a ready-made picture (what drawings are judged against).
export const builtinStrokes = (id) => { const p = builtin(id); return p ? p.steps.flatMap((s) => s.strokes) : null; };
