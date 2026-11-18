// Unit tests for Blind Drawing: the shape judge and the game rules — run with:  node tests/draw.test.mjs
import * as Dr from "../js/draw.js";
import * as E from "../js/engine.js";

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.log("  ✗ " + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
console.log("blind drawing tests");

const enc = (strokes) => strokes.map(Dr.encodeStroke);
const ring = (cx, cy, r, n = 30) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const tree = [[[500, 150], [300, 450], [420, 450], [250, 700], [750, 700], [580, 450], [700, 450], [500, 150]], [[460, 700], [460, 850], [540, 850], [540, 700]]];
const snowman = [ring(500, 650, 200), ring(500, 330, 120)];
function mangle(sh, { dx = 0, dy = 0, sc = 1, deg = 0, mirror = false, jitter = 0, extra = 0 }) {
  const a = (deg * Math.PI) / 180;
  const out = sh.map((s) => s.flatMap((p, i) => (i < s.length - 1 ? [0, 1, 2, 3].map((k) => [p[0] + ((s[i + 1][0] - p[0]) * k) / 4, p[1] + ((s[i + 1][1] - p[1]) * k) / 4]) : [p])).map(([x, y]) => {
    let X = (x - 500) * sc, Y = (y - 500) * sc; if (mirror) X = -X;
    return [Math.max(0, Math.min(1000, 500 + dx + X * Math.cos(a) - Y * Math.sin(a) + (rnd() - 0.5) * jitter)), Math.max(0, Math.min(1000, 500 + dy + X * Math.sin(a) + Y * Math.cos(a) + (rnd() - 0.5) * jitter))];
  }));
  for (let e = 0; e < extra; e++) { const x = rnd() * 1000, y = rnd() * 1000; out.push([[x, y], [x + (rnd() - 0.5) * 400, y + (rnd() - 0.5) * 400]]); }
  return out;
}
// ---------- encoding ----------
eq(Dr.decodeStroke(Dr.encodeStroke([[1.4, 2.6], [10, 20]])), [[1, 3], [10, 20]], "strokes round-trip as whole numbers in a string");
ok(typeof enc(tree)[0] === "string", "strokes are strings (Firestore can't store arrays in arrays)");
ok(Dr.svg(enc(tree)).includes("<polyline"), "a drawing renders as a picture");
// ---------- the judge ----------
const T = enc(tree);
eq(Dr.matchPercent(T, T), 100, "an exact copy is a 100% match");
ok(Dr.matchPercent(T, enc(mangle(tree, { dx: 250, dy: -200, sc: 0.45 }))) >= 90, "off center and tiny still matches (placement and size don't count)");
ok(Dr.matchPercent(T, enc(mangle(tree, { deg: 180, jitter: 30 }))) >= 80, "upside down still matches");
ok(Dr.matchPercent(T, enc(mangle(tree, { mirror: true, deg: 30, jitter: 30 }))) >= 80, "mirrored and tilted still matches");
const messy = Dr.matchPercent(T, enc(mangle(tree, { jitter: 70, extra: 3, deg: 160, sc: 0.7 })));
const wrong = Dr.matchPercent(T, enc(mangle(snowman, { jitter: 40 })));
const scribble = Dr.matchPercent(T, enc([Array.from({ length: 40 }, () => [rnd() * 1000, rnd() * 1000])]));
ok(messy > wrong && messy > scribble, `a wobbly, upside-down copy with stray lines (${messy}%) beats a different shape (${wrong}%) and a scribble (${scribble}%)`);
eq(Dr.matchPercent(T, []), 0, "no drawing scores 0");
eq(Dr.matchPercent(T, enc([[[500, 500]]])), 0, "a single dot scores 0");

// ---------- game rules ----------
const players = [{ id: "h1", name: "Jake", team: "team1" }, { id: "w1", name: "Emma", team: "team2" }, { id: "g1", name: "Grandpa", team: "team1", manual: true }];
let st = E.defaultState();
const run = (name, p, now = 1000) => { const r = E.ACTIONS[name](st, p, { now, questions: [], players, rand: rnd }); if (r && !r.error) st = { ...st, ...r.set }; return r; };
run("miniAdd", { game: { name: "Blind Drawing", type: "draw" } });
const g0 = st.minis.list[0];
eq([g0.type, g0.mode, g0.pics], ["h2h", "draw", []], "Blind Drawing is a head-to-head game judged from drawings");
run("miniPlay", { id: g0.id });
ok(!!run("miniNext", { id: g0.id }).error, "can't start without a picture to describe");
run("miniUpdate", { id: g0.id, patch: { pics: ["drawpic-a", "drawpic-b"] } });
eq(st.minis.list[0].pics, ["drawpic-a", "drawpic-b"], "pictures are kept on the game");
for (let i = 0; i < 6; i++) {
  run("miniNext", { id: g0.id });
  const m = E.openMatch(st.minis.list[0]);
  ok(m.p1.id === "h1", "only players with a phone are picked to draw");
  run("miniMatch", { id: g0.id, matchId: m.id, winner: "tie" });
}
eq(st.minis.list[0].matches.map((m) => m.pic).slice(0, 3), ["drawpic-a", "drawpic-b", "drawpic-a"], "pictures are used in turn");
run("miniNext", { id: g0.id });
let m = E.openMatch(st.minis.list[0]);
run("miniDrawSubmitted", { id: g0.id, matchId: m.id, team: "team1" });
eq(E.openMatch(st.minis.list[0]).done, { team1: true }, "a sent drawing is marked done");
ok(!!run("miniRepick", { id: g0.id, matchId: m.id }).error, "can't re-draw players once someone has sent a drawing");
run("miniDrawJudge", { id: g0.id, matchId: m.id, scores: { team1: 81, team2: null } });
m = st.minis.list[0].matches.find((x) => x.id === m.id);
eq([m.winner, m.scores], ["team1", { team1: 81, team2: null }], "the website's verdict: the closest drawing wins (a missing drawing loses)");
ok(E.ACTIONS.miniDrawJudge(st, { id: g0.id, matchId: m.id, scores: { team1: 0, team2: 99 } }, { now: 2000, questions: [], players }) === null, "a verdict can't be changed afterwards");
run("miniNext", { id: g0.id });
const m2 = E.openMatch(st.minis.list[0]);
run("miniDrawJudge", { id: g0.id, matchId: m2.id, scores: { team1: 40, team2: 40 } });
eq(st.minis.list[0].matches.find((x) => x.id === m2.id).winner, "tie", "equal scores tie");
ok(!!E.ACTIONS.miniUpdate(st, { id: g0.id, patch: { type: "best" } }, { now: 1 }).error, "can't change the game type once it's started");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
