// Unit tests for Blind Drawing: the shape judge and the game rules — run with:  node tests/draw.test.mjs
import * as Dr from "../js/draw.js";
import * as E from "../js/engine.js";
import { PICTURES, builtinStrokes, isBuiltin } from "../js/pictures.js";

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

// ---------- game rules: everyone draws at once ----------
const players = [
  { id: "h1", name: "Jake", team: "team1" }, { id: "h2", name: "Sam", team: "team1" },
  { id: "w1", name: "Emma", team: "team2" }, { id: "w2", name: "Lily", team: "team2" },
  { id: "g1", name: "Grandpa", team: "team1", manual: true },
];
let st = E.defaultState();
const run = (name, p, now = 1000, who = players) => { const r = E.ACTIONS[name](st, p, { now, questions: [], players: who, rand: rnd }); if (r && !r.error) st = { ...st, ...r.set }; return r; };
const game = () => st.minis.list[0];
run("miniAdd", { game: { name: "Blind Drawing", type: "draw" } });
const g0 = game();
eq([g0.type, g0.mode, g0.better, g0.pics], ["best", "draw", "high", []], "Blind Drawing is a Best overall game judged from the drawings");
run("miniPlay", { id: g0.id });
ok(!!run("miniDrawRound", { id: g0.id }).error, "can't start without a picture to describe");
run("miniUpdate", { id: g0.id, patch: { pics: ["drawpic-a", "drawpic-b"] } });
eq(game().pics, ["drawpic-a", "drawpic-b"], "pictures are kept on the game");
ok(!!E.ACTIONS.miniDrawRound(st, { id: g0.id }, { now: 1, players: [players[4]] }).error, "nobody with a phone → nobody can draw");
run("miniDrawRound", { id: g0.id });
let r = E.drawRound(game());
eq(r.drawers.map((d) => d.id), ["h1", "h2", "w1", "w2"], "everyone with a phone draws at once (both teams, no tables)");
ok(!("table" in r) && !r.p1 && !r.p2, "no tables, no one-on-one matchups");
eq(E.currentPick(st), null, "nobody is picked — no name shuffle");
eq(r.pic, "drawpic-a", "the first round uses the first picture");
ok(run("miniDrawRound", { id: g0.id }) === null, "one round at a time");
ok(run("miniNext", { id: g0.id }) === null, "the old draw-who's-next button does nothing while a round is going");
// Undo a round set up by mistake
run("miniDrawCancel", { id: g0.id, matchId: r.id });
eq([E.drawRound(game()), game().matches.length], [null, 0], "↶ Undo round: as if it never happened");
run("miniNext", { id: g0.id });
r = E.drawRound(game());
eq(r.pic, "drawpic-a", "…and the same picture is used again");
// A latecomer who joins before the start draws too
run("miniDrawStart", { id: g0.id }, 5000, [...players, { id: "w3", name: "Kim", team: "team2" }]);
r = E.drawRound(game());
eq([r.startedAt, r.drawers.length], [5000 + E.DRAW_COUNTDOWN_MS, 5], "starting begins step 1 after a countdown — and anyone who just joined draws too");
ok(run("miniDrawStart", { id: g0.id }, 9000) === null, "starting again changes nothing");
run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid: "h1" });
run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid: "w1" });
ok(run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid: "g1" }) === null, "someone who isn't drawing can't send");
eq(E.drawRound(game()).done, { h1: true, w1: true }, "each sent drawing is ticked off");
// Undo a started round (drawings thrown away)
run("miniDrawCancel", { id: g0.id });
eq(E.drawRound(game()), null, "a started round can be undone too");
run("miniDrawRound", { id: g0.id });
r = E.drawRound(game());
eq(r.done, {}, "a fresh round starts with nobody done");
for (const pid of ["h1", "h2", "w1", "w2"]) run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid });
run("miniDrawJudge", { id: g0.id, matchId: r.id, scores: { h1: 55, h2: 31, w1: 87.4, w2: 12, g1: 99 } });
let done = game().matches.find((x) => x.id === r.id);
eq(done.winner, "team2", "the best drawing (Emma, 87%) wins the round for her team");
eq(E.drawRanking(done).map((d) => [d.name, d.score]), [["Emma", 87], ["Jake", 55], ["Sam", 31], ["Lily", 12]], "everyone ranked best to worst");
eq(E.miniStanding(game()).sorted.map((e) => [e.name, e.score]), [["Emma", 87], ["Jake", 55], ["Sam", 31], ["Lily", 12]], "every drawing is a score in the standings");
eq(E.miniStanding(game()).leader, "team2", "the best drawing of the night is leading it for her team");
ok(E.ACTIONS.miniDrawJudge(st, { id: g0.id, matchId: r.id, scores: { h1: 100 } }, { now: 2000, questions: [], players }) === null, "a verdict can't be changed afterwards");
run("miniDrawRound", { id: g0.id });
r = E.drawRound(game());
eq(r.pic, "drawpic-b", "the next round uses the next picture");
run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid: "h2" });
run("miniDrawSubmitted", { id: g0.id, matchId: r.id, pid: "w2" });
run("miniDrawJudge", { id: g0.id, matchId: r.id, scores: { h2: 64, w2: 64, h1: 99 } });
done = game().matches.find((x) => x.id === r.id);
eq([done.winner, done.scores.h1], ["tie", null], "both teams share the best score → a tie (a drawing that wasn't sent scores nothing)");
eq(E.drawRanking(done).slice(-2).map((d) => d.score), [null, null], "no drawing = bottom of the list");
ok(!!E.ACTIONS.miniUpdate(st, { id: g0.id, patch: { type: "h2h" } }, { now: 1 }).error, "can't change the game type once it's started");
// Undoing a judged round takes its scores back out of the standings
{
  const first = game().matches.find((x) => x.scores && x.scores.w1 === 87);
  const back = E.ACTIONS.miniMatchRemove(st, { id: g0.id, matchId: first.id }, { now: 3000, players });
  eq(E.miniStanding({ ...game(), ...back.set.minis.list[0] }).sorted.filter((e) => e.roundId === first.id).length, 0, "↶ a round that's taken out takes its scores with it");
}
// The best drawing of the night wins the points for its team
{
  let s3 = E.defaultState();
  const r3 = (name, p) => { const x = E.ACTIONS[name](s3, p, { now: 1000, questions: [], players, rand: rnd }); if (x && !x.error) s3 = { ...s3, ...x.set }; return x; };
  r3("miniAdd", { game: { name: "Blind Drawing", type: "draw", points: 300, pics: ["builtin:tree"] } });
  const id = s3.minis.list[0].id;
  r3("miniPlay", { id });
  r3("miniDrawRound", { id });
  const rr = E.drawRound(s3.minis.list[0]);
  r3("miniDrawSubmitted", { id, matchId: rr.id, pid: "h2" });
  r3("miniDrawSubmitted", { id, matchId: rr.id, pid: "w2" });
  r3("miniDrawJudge", { id, matchId: rr.id, scores: { h2: 40, w2: 70 } });
  eq(s3.scores.team1, 0, "no points while it's being played — it's scored like any Best overall game");
  r3("miniFinish", { id });
  eq([s3.scores.team2, s3.scores.team1, s3.minis.list[0].result.winner], [300, 0, "team2"], "the best drawing of the night wins the points for its team");
  r3("miniReset", { id });
  eq(s3.scores.team2, 0, "↺ Reset hands the points back");
  r3("miniPlay", { id });
  r3("miniDrawRound", { id });
  const r4 = E.drawRound(s3.minis.list[0]);
  r3("miniDrawSubmitted", { id, matchId: r4.id, pid: "h2" });
  r3("miniDrawJudge", { id, matchId: r4.id, scores: { h2: 40 } });
  // Undo starting the whole game: back to not played yet, points handed back
  r3("miniReset", { id });
  eq([s3.minis.list[0].status, s3.minis.list[0].matches.length, s3.scores.team1, s3.minis.current], ["pending", 0, 0, null], "↶ Undo start: the game is back to not played yet, its points are taken back, and you're back at the games list");
}

// ---------- ready-made pictures ----------
eq(PICTURES.length, 10, "10 ready-made pictures");
ok(PICTURES.every((p) => p.steps.length === 10), "every picture is built up in exactly 10 steps");
ok(PICTURES.every((p) => p.steps.every((st) => st.text.length > 10 && st.strokes.length >= 1 && st.strokes.length <= 6)), "every step says what to draw and is only a few strokes");
ok(PICTURES.every((p) => Dr.decode(builtinStrokes("builtin:" + p.key)).every((s) => { const xs = s.map((q) => q[0]), ys = s.map((q) => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= 36; })), "no tiny details (every line is at least finger-sized)");
ok(PICTURES.every((p) => Dr.decode(builtinStrokes("builtin:" + p.key)).flat().every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000)), "everything fits on the pad");
ok(PICTURES.every((p) => Dr.matchPercent(builtinStrokes("builtin:" + p.key), builtinStrokes("builtin:" + p.key)) === 100), "each picture matches itself perfectly");
ok(isBuiltin("builtin:tree") && !isBuiltin("drawpic-x"), "ready-made vs hand-drawn ids");
eq(Dr.svgSteps(PICTURES[0].steps, 1).match(/class="now"/g).length, PICTURES[0].steps[1].strokes.length, "the example highlights the current step");

// ---------- steps and timing ----------
{
  let s2 = E.defaultState();
  const r = (name, p, now = 1000) => { const x = E.ACTIONS[name](s2, p, { now, questions: [], players, rand: rnd }); if (x && !x.error) s2 = { ...s2, ...x.set }; return x; };
  r("miniAdd", { game: { name: "Blind Drawing", type: "draw" } });
  const gid = s2.minis.list[0].id;
  eq(s2.minis.list[0].stepSeconds, 20, "a new step every 20 seconds by default");
  r("miniUpdate", { id: gid, patch: { stepSeconds: 2, pics: ["builtin:tree", "drawpic-mine"], picSteps: { "drawpic-mine": 4, "builtin:tree": 9 } } });
  eq([s2.minis.list[0].stepSeconds, s2.minis.list[0].picSteps], [5, { "drawpic-mine": 4 }], "at least 5 seconds a step; step counts kept only for hand-drawn pictures");
  r("miniPlay", { id: gid });
  r("miniDrawRound", { id: gid });
  ok(!E.drawRound(s2.minis.list[0]).startedAt, "a round waits for the host to start it");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
