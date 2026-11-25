// Unit tests for mini games + team names — run with:  node tests/minis.test.mjs
import * as E from "../js/engine.js";

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.log("  ✗ " + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// Deterministic "random" so rotations are reproducible, plus many seeds for property checks.
function rng(seed) { let x = seed >>> 0 || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

const QS = [
  { id: "a1", category: "Movies", points: 100, type: "spoken", round: 1 },
  { id: "a2", category: "Movies", points: 200, type: "spoken", round: 1 },
  { id: "f1", category: "Poems", points: 0, type: "spoken", isFinal: true },
];
const roster = (h, w) => [
  ...Array.from({ length: h }, (_, i) => ({ id: "h" + (i + 1), name: "Hub" + (i + 1), team: "team1" })),
  ...Array.from({ length: w }, (_, i) => ({ id: "w" + (i + 1), name: "Wife" + (i + 1), team: "team2" })),
];

function world(players, seed = 7) {
  const w = { state: E.defaultState(), qs: QS.map((q) => ({ ...q })), players, rand: rng(seed), t: 1_000_000, error: null, noop: false };
  w.run = (name, params = {}, dt = 0) => {
    w.t += 10 + dt;
    const ch = E.ACTIONS[name](w.state, params, { now: w.t, questions: w.qs, players: w.players, rand: w.rand });
    w.error = ch && ch.error ? ch.error : null;
    w.noop = !ch;
    if (ch && !ch.error) {
      checkFirestoreSafe(ch.set, name);
      w.state = { ...w.state, ...ch.set };
      w.qs = w.qs.map((q) => { const u = (ch.questions || []).find((x) => x.id === q.id); return u ? { ...q, ...u.data } : q; });
    }
    return w;
  };
  w.game = (i = 0) => w.state.minis.list[i];
  w.add = (game) => { w.run("miniAdd", { game }); return w.state.minis.list[w.state.minis.list.length - 1].id; };
  return w;
}
// Firestore rejects `undefined` and arrays directly inside arrays.
let unsafe = 0;
function checkFirestoreSafe(v, where, inArray = false) {
  if (v === undefined) { unsafe++; console.log("  ✗ undefined in change set of " + where); return; }
  if (Array.isArray(v)) { if (inArray) { unsafe++; console.log("  ✗ nested array in " + where); } v.forEach((x) => checkFirestoreSafe(x, where, true)); return; }
  if (v && typeof v === "object") Object.values(v).forEach((x) => checkFirestoreSafe(x, where, false));
}

console.log("mini game tests");

// ---------- defaults, team names ----------
{
  const w = world(roster(2, 2));
  eq(w.state.teamNames, { team1: "Husbands", team2: "Wives" }, "default team names are Husbands / Wives");
  eq(E.teamName({}, "team2"), "Wives", "fallback name");
  w.run("setTeamName", { team: "team1", name: "  The   Grinches ", byPlayer: true });
  eq(w.state.teamNames.team1, "The Grinches", "a player can rename their team in the lobby");
  w.run("setTeamName", { team: "team2", name: "the grinches", byPlayer: true });
  ok(!!w.error, "can't copy the other team's name");
  w.run("setTeamName", { team: "team2", name: "", byPlayer: true });
  ok(w.noop, "blank name keeps the default");
  w.run("setTeamName", { team: "team1", name: "", byPlayer: true });
  eq(w.state.teamNames.team1, "Husbands", "clearing a custom name goes back to the default");
  w.run("setSettings", { patch: { playersRename: false } });
  w.run("setTeamName", { team: "team1", name: "Dads", byPlayer: true });
  ok(!!w.error, "host can lock team names");
  w.run("setTeamName", { team: "team1", name: "Dads" });
  eq(w.state.teamNames.team1, "Dads", "host can always rename");
  w.run("setSettings", { patch: { playersRename: true } });
  w.run("startGame", { control: "team1" });
  w.run("setTeamName", { team: "team2", name: "Moms", byPlayer: true });
  ok(!!w.error, "players can't rename once Jeopardy starts");
}

// ---------- migration ----------
{
  const old = { ...E.defaultState(), teamNames: { team1: "Team 1", team2: "Elves" }, scores: { team1: 300, team2: 0 } };
  delete old.minis;
  delete old.settings.playersRename;
  const m = E.migrate(old);
  ok(m && m.patch && !m.full, "an in-progress older game is patched, not wiped");
  eq(m.patch.teamNames, { team1: "Husbands", team2: "Elves" }, "old default names become Husbands/Wives, custom names kept");
  ok(Array.isArray(m.patch.minis.list) && m.patch.settings.playersRename === true, "mini games + new setting added");
  eq(E.migrate(E.defaultState()), null, "an up-to-date game needs no migration");
  ok(!!E.migrate({ v: 1, teamNames: { team1: "Reds", team2: "Team 2" } }).full, "a very old game is replaced");
  eq(E.migrate(null).full.teamNames, { team1: "Husbands", team2: "Wives" }, "brand new game uses the defaults");
}

// ---------- setup ----------
{
  const w = world(roster(2, 2));
  const a = w.add({ name: "  Snowball   Toss ", type: "h2h", points: "250" });
  const b = w.add({ name: "", type: "best", better: "low", unit: "seconds", points: "" });
  const c = w.add({ name: "Third", type: "nonsense", points: -5, award: "match" });
  eq([w.game(0).name, w.game(0).points, w.game(0).award], ["Snowball Toss", 250, "game"], "name/points are cleaned up");
  eq([w.game(1).name, w.game(1).points, w.game(1).better, w.game(1).award], ["Mini game", 500, "low", "game"], "blank fields get sensible defaults");
  eq([w.game(2).type, w.game(2).points, w.game(2).award], ["h2h", 0, "match"], "unknown type → head-to-head, negative points → 0");
  w.run("miniMove", { id: c, dir: -1 });
  eq(w.state.minis.list.map((g) => g.id), [a, c, b], "reorder up");
  w.run("miniMove", { id: a, dir: -1 });
  ok(w.noop, "can't move past the top");
  w.run("miniUpdate", { id: b, patch: { name: "Wrap Race", points: 300 } });
  eq([w.game(2).name, w.game(2).points, w.game(2).better, w.game(2).unit], ["Wrap Race", 300, "low", "seconds"], "editing keeps the other fields");
  w.run("miniUpdate", { id: b, patch: { type: "h2h" } });
  eq(w.game(2).type, "h2h", "type can change before the game starts");
  w.run("miniRemove", { id: c });
  eq(w.state.minis.list.length, 2, "remove a game");
  for (let i = 0; i < 25; i++) w.run("miniAdd", { game: { name: "G" + i } });
  eq(w.state.minis.list.length, 20, "capped at 20 mini games");
}

// ---------- flow: lobby → mini games → Jeopardy ----------
{
  const w = world(roster(3, 3));
  const id = w.add({ name: "Toss", type: "h2h", points: 400 });
  w.run("minisStart");
  eq(w.state.phase, "minis", "mini games phase");
  w.run("miniNext", { id });
  ok(w.noop, "can't draw players before the game is opened");
  w.run("miniPlay", { id });
  eq([w.game().status, w.state.minis.current], ["active", id], "play a game");
  w.run("miniNext", { id });
  const m = E.openMatch(w.game());
  ok(m.p1.id.startsWith("h") && m.p2.id.startsWith("w"), "draws one husband and one wife");
  eq(w.state.sfx.sound, "pick", "drum-roll sound on the draw");
  w.run("miniNext", { id });
  ok(w.noop, "no new draw until the matchup is decided");
  const pick = E.currentPick(w.state);
  eq(pick.pids, [m.p1.id, m.p2.id], "currentPick lists who's up");
  w.run("miniMatch", { id, winner: "team2" });
  eq(E.miniStanding(w.game()).wins, { team1: 0, team2: 1, ties: 0 }, "matchup recorded");
  eq(w.state.scores, { team1: 0, team2: 0 }, "winner-takes-all: no points until the game is finished");
  w.run("miniFinish", { id });
  eq(w.state.scores, { team1: 0, team2: 400 }, "the leader gets the points when the host just hits finish");
  eq(w.game().result, { winner: "team2", team1: 0, team2: 400 }, "result stored");
  eq(w.state.sfx.sound, "miniwin", "win sound");
  w.run("miniClose");
  eq(w.state.minis.current, null, "back to the list");
  w.run("startGame", { control: "team1" });
  eq([w.state.phase, w.state.scores.team2], ["board", 400], "mini-game points carry into Jeopardy");
  w.run("startGame", { control: "team2" });
  ok(w.noop, "pressing start twice doesn't restart Jeopardy");
}

// ---------- head-to-head rotation is fair for every roster shape ----------
for (const [h, wv] of [[3, 3], [2, 5], [5, 2], [1, 4], [4, 1], [1, 1], [6, 6]]) {
  for (const seed of [1, 2, 3, 11, 99]) {
    const w = world(roster(h, wv), seed);
    const id = w.add({ name: "Rot", type: "h2h" });
    w.run("miniPlay", { id });
    const big = Math.max(h, wv);
    const seq = { p1: [], p2: [] };
    for (let i = 0; i < big * 2; i++) {
      w.run("miniNext", { id });
      const m = E.openMatch(w.game());
      seq.p1.push(m.p1.id); seq.p2.push(m.p2.id);
      w.run("miniMatch", { id, winner: i % 2 ? "team1" : "team2" });
    }
    const label = `${h}v${wv} seed ${seed}`;
    for (const [key, n] of [["p1", h], ["p2", wv]]) {
      // within each block of n draws, everyone on that team appears exactly once
      let fair = true;
      for (let i = 0; i + n <= seq[key].length; i += n) fair = fair && new Set(seq[key].slice(i, i + n)).size === n;
      ok(fair, `${label}: every ${key === "p1" ? "husband" : "wife"} plays once before anyone repeats`);
      if (n > 1) ok(seq[key].every((p, i) => i === 0 || p !== seq[key][i - 1]), `${label}: nobody plays twice in a row (${key})`);
    }
    ok(E.miniEveryonePlayed(w.game(), w.players), `${label}: everyone has played after ${big * 2} matchups`);
  }
}

// ---------- head-to-head with missing players ----------
{
  const w = world([]);
  const id = w.add({ name: "No phones", type: "h2h", points: 300 });
  w.run("miniPlay", { id }).run("miniNext", { id });
  const m = E.openMatch(w.game());
  eq([m.p1, m.p2], [null, null], "no players joined → a nameless round still works");
  w.run("miniMatch", { id, winner: "team1" }).run("miniNext", { id }).run("miniMatch", { id, winner: "tie" });
  eq(E.miniStanding(w.game()).wins, { team1: 1, team2: 0, ties: 1 }, "wins + ties tracked without names");
  w.run("miniFinish", { id });
  eq(w.state.scores.team1, 300, "nameless game still awards points");

  const one = world(roster(2, 0));
  const id2 = one.add({ name: "Half", type: "h2h" });
  one.run("miniPlay", { id: id2 }).run("miniNext", { id: id2 });
  const m2 = E.openMatch(one.game());
  ok(m2.p1 && m2.p2 === null, "one empty team: named husband vs the Wives");
  one.run("miniMatch", { id: id2, winner: "team2" });
  eq(E.miniStanding(one.game()).wins.team2, 1, "the empty team can still win a round");
}

// ---------- re-picks and hand-picking ----------
{
  const w = world(roster(3, 3), 5);
  const id = w.add({ name: "Swap", type: "h2h" });
  w.run("miniPlay", { id }).run("miniNext", { id });
  const m0 = E.openMatch(w.game());
  w.run("miniRepick", { id, team: "team1" });
  const m1 = E.openMatch(w.game());
  ok(m1.p1.id !== m0.p1.id && m1.p2.id === m0.p2.id && m1.p2.at === m0.p2.at, "re-pick one side: new husband, same wife (no re-spin)");
  w.run("miniRepick", { id });
  const m2 = E.openMatch(w.game());
  ok(m2.p1.id !== m1.p1.id && m2.p2.id !== m1.p2.id, "re-pick both sides");
  w.run("miniSetPlayer", { id, team: "team2", pid: "w3" });
  eq([E.openMatch(w.game()).p2.id, E.openMatch(w.game()).p2.at], ["w3", 0], "host hand-picks a player (shown instantly)");
  w.run("miniSetPlayer", { id, team: "team2", pid: "h1" });
  ok(w.noop, "can't put a husband on the wives' side");
  w.run("miniSetPlayer", { id, team: "team1", pid: "nobody" });
  ok(w.noop, "unknown player ignored");
  // only the people who actually played are marked as played
  const final = E.openMatch(w.game());
  w.run("miniMatch", { id, winner: "team1" });
  eq(w.game().played, { team1: [final.p1.id], team2: ["w3"] }, "re-picked (skipped) players stay in the pool");
  const solo = world(roster(1, 1));
  const sid = solo.add({ name: "Solo", type: "h2h" });
  solo.run("miniPlay", { id: sid }).run("miniNext", { id: sid }).run("miniRepick", { id: sid });
  eq(E.openMatch(solo.game()).p1.id, "h1", "re-pick with a team of one keeps that player");
}

// ---------- points per matchup ----------
{
  const w = world(roster(2, 2));
  const id = w.add({ name: "Per round", type: "h2h", points: 100, award: "match" });
  w.run("miniPlay", { id });
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "team1" });
  eq(w.state.scores, { team1: 100, team2: 0 }, "points land as each matchup is won");
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "tie" });
  eq(w.state.scores, { team1: 100, team2: 0 }, "a tied matchup gives no points");
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "team2" });
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "team2" });
  eq(w.state.scores, { team1: 100, team2: 200 }, "running totals");
  w.run("undo");
  eq(w.state.scores.team2, 100, "undo takes the matchup points back");
  ok(!!E.openMatch(w.game()), "…and re-opens that matchup to be judged again");
  w.run("miniMatch", { id, winner: "team1" });
  eq(w.state.scores, { team1: 200, team2: 100 }, "re-judged the other way");
  const firstMatch = w.game().matches[0].id;
  w.run("miniMatchRemove", { id, matchId: firstMatch });
  eq([w.state.scores.team1, w.game().matches.length], [100, 3], "removing a matchup hands its points back");
  w.run("miniUpdate", { id, patch: { award: "game" } });
  ok(!!w.error, "can't switch scoring style mid-game");
  w.run("miniFinish", { id, winner: "team2" });
  eq(w.state.scores, { team1: 100, team2: 100 }, "finishing a per-matchup game adds nothing extra");
  eq(w.game().result, { winner: "team2", team1: 100, team2: 100 }, "result shows the points each team earned");
  w.run("miniMatchRemove", { id, matchId: w.game().matches[0].id });
  ok(!!w.error, "finished games are locked");
  w.run("miniReset", { id });
  eq([w.state.scores, w.game().status, w.game().matches.length], [{ team1: 0, team2: 0 }, "pending", 0], "reset hands back every point and clears the game");
  w.run("miniReset", { id });
  eq(w.state.scores, { team1: 0, team2: 0 }, "resetting twice doesn't double-refund");
}

// ---------- finishing: every outcome ----------
{
  const mk = (pts = 500) => { const w = world(roster(2, 2)); const id = w.add({ name: "Fin", type: "h2h", points: pts }); w.run("miniPlay", { id }); return [w, id]; };
  let [w, id] = mk();
  w.run("miniFinish", { id, winner: "team1" });
  eq(w.state.scores, { team1: 500, team2: 0 }, "host declares a winner with no matchups tracked");
  [w, id] = mk(501);
  w.run("miniFinish", { id, winner: "tie" });
  eq(w.state.scores, { team1: 251, team2: 251 }, "a tie splits the points (rounded)");
  w.run("undo");
  eq([w.state.scores, w.game().status, w.game().result], [{ team1: 0, team2: 0 }, "active", null], "one undo reverses both halves of a split and re-opens the game");
  w.run("miniFinish", { id, winner: "none" });
  eq([w.state.scores, w.game().result.winner], [{ team1: 0, team2: 0 }, "none"], "no winner → no points");
  [w, id] = mk();
  w.run("miniFinish", { id });
  eq(w.game().result.winner, "none", "finishing an unplayed game without choosing → nobody");
  [w, id] = mk();
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "team1" }).run("miniNext", { id }).run("miniMatch", { id, winner: "team2" });
  w.run("miniNext", { id }); // an undecided matchup is on screen
  w.run("miniFinish", { id });
  eq([w.game().result.winner, w.state.scores, w.game().matches.length], ["tie", { team1: 250, team2: 250 }, 2], "level on matchups → tie; the undecided matchup is dropped");
  w.run("miniFinish", { id, winner: "team1" });
  ok(w.noop, "can't finish twice");
  [w, id] = mk();
  w.run("miniNext", { id }).run("miniMatch", { id, winner: "team1" });
  w.run("miniFinish", { id, winner: "team2" });
  eq(w.state.scores, { team1: 0, team2: 500 }, "host can overrule the standings");
  [w, id] = mk(0);
  w.run("miniFinish", { id, winner: "team1" });
  eq([w.state.history.length, w.game().result.winner], [0, "team1"], "a 0-point game records a winner with no score change");
}

// ---------- best overall ----------
{
  const w = world(roster(2, 4), 3);
  const id = w.add({ name: "Stack", type: "best", points: 600, unit: "cups" });
  w.run("miniPlay", { id });
  const order = [];
  const scores = [5, 9, 7, 9.456, 3, 8];
  for (const sc of scores) {
    w.run("miniNext", { id });
    order.push(w.game().turn);
    w.run("miniScore", { id, score: sc });
  }
  eq(order.map((t) => t.team).slice(0, 4), order[0].team === "team1" ? ["team1", "team2", "team1", "team2"] : ["team2", "team1", "team2", "team1"], "turns alternate teams while both have players waiting");
  eq(new Set(order.map((t) => t.pid)).size, 6, "all 6 players get exactly one turn (uneven teams)");
  ok(E.miniEveryonePlayed(w.game(), w.players), "everyone has played");
  const st = E.miniStanding(w.game());
  eq(st.sorted[0].score, 9.46, "scores keep 2 decimals; highest is on top");
  ok(["team1", "team2", "tie"].includes(st.leader), "there is a leader");
  w.run("miniNext", { id });
  ok(!!w.game().turn && !w.error, "a second lap is allowed");
  w.run("miniScore", { id, score: "" });
  ok(!!w.error, "blank score rejected");
  w.run("miniScore", { id, score: "abc" });
  ok(!!w.error, "non-numeric score rejected");
  w.run("miniScore", { id, score: "12.5" });
  eq(E.miniStanding(w.game()).sorted[0].score, 12.5, "text numbers are accepted");
  const top = E.miniStanding(w.game()).sorted[0];
  w.run("miniFinish", { id });
  eq(w.state.scores[top.team], 600, "best single score wins it for their team");
  w.run("miniEntryRemove", { id, entryId: top.id });
  ok(!!w.error, "finished game's scores are locked");
}
{
  // lowest wins + ties + removing a score
  const w = world(roster(2, 2), 9);
  const id = w.add({ name: "Wrap", type: "best", better: "low", unit: "seconds", points: 200 });
  w.run("miniPlay", { id });
  for (const sc of [30, 22, 22, 41]) { w.run("miniNext", { id }); w.run("miniScore", { id, score: sc }); }
  const st = E.miniStanding(w.game());
  eq(st.sorted.map((e) => e.score), [22, 22, 30, 41], "fastest first");
  const teams22 = st.sorted.slice(0, 2).map((e) => e.team);
  eq(st.leader, teams22[0] === teams22[1] ? teams22[0] : "tie", "equal best scores on different teams = tie");
  w.run("miniEntryRemove", { id, entryId: st.sorted[0].id });
  eq(E.miniStanding(w.game()).sorted.length, 3, "remove a mistyped score");
  w.run("miniNext", { id });
  const t0 = w.game().turn;
  w.run("miniRepick", { id });
  ok(w.game().turn.pid !== t0.pid && w.game().turn.team === t0.team, "re-pick swaps in a teammate");
  w.run("miniSetPlayer", { id, pid: "w2" });
  eq([w.game().turn.pid, w.game().turn.team], ["w2", "team2"], "hand-pick anyone for the turn");
  w.run("miniFinish", { id, winner: "tie" });
  eq(w.state.scores, { team1: 100, team2: 100 }, "tie splits");
  eq(w.game().turn, null, "the open turn is cleared on finish");
}
{
  const w = world([]);
  const id = w.add({ name: "Empty", type: "best" });
  w.run("miniPlay", { id }).run("miniNext", { id });
  ok(!!w.error && /Players/.test(w.error), "best-overall with nobody joined explains what to do");
  w.run("miniFinish", { id, winner: "team2" });
  eq(w.state.scores.team2, 500, "…but the host can still just pick the winner");
  const half = world(roster(0, 3));
  const hid = half.add({ name: "Half", type: "best" });
  half.run("miniPlay", { id: hid });
  for (let i = 0; i < 3; i++) { half.run("miniNext", { id: hid }); half.run("miniScore", { id: hid, score: i }); }
  eq(new Set(half.game().entries.map((e) => e.pid)).size, 3, "one-sided roster still rotates through everyone");
}

// ---------- undo / reset / new game ----------
{
  const w = world(roster(2, 2));
  const a = w.add({ name: "A", type: "h2h", points: 300 });
  const b = w.add({ name: "B", type: "best", points: 200 });
  w.run("minisStart").run("miniPlay", { id: a }).run("miniFinish", { id: a, winner: "team1" }).run("miniClose");
  w.run("miniPlay", { id: b }).run("miniNext", { id: b }).run("miniScore", { id: b, score: 4 }).run("miniFinish", { id: b }).run("miniClose");
  const leader = w.game(1).result.winner;
  eq(w.state.scores[leader], leader === "team1" ? 500 : 200, "two games' points add up");
  w.run("miniReset", { id: a });
  eq([w.state.scores.team1, w.game(0).status], [leader === "team1" ? 200 : 0, "pending"], "reset one finished game → its points come back");
  w.run("undo");
  eq(w.state.scores.team1, leader === "team1" ? 500 : 300, "undo of a reset restores the points");
  w.run("adjustScore", { team: "team2", delta: 50 });
  w.run("newGame");
  eq([w.state.phase, w.state.scores, w.state.minis.list.map((g) => [g.name, g.points, g.status, g.entries.length, g.result])],
    ["lobby", { team1: 0, team2: 0 }, [["A", 300, "pending", 0, null], ["B", 200, "pending", 0, null]]],
    "new game keeps the mini-game setup but clears results");
}

// ---------- mini game in the middle of Jeopardy ----------
{
  const w = world(roster(2, 2));
  const id = w.add({ name: "Break game", type: "h2h", points: 150 });
  w.run("startGame", { control: "team2" });
  w.run("pickClue", { qid: "a1" });
  w.run("minisStart");
  ok(!!w.error, "can't jump to mini games with a clue open");
  w.run("miniPlay", { id });
  ok(!!w.error, "…or start one directly");
  w.run("closeClue");
  w.run("miniPlay", { id });
  eq([w.state.phase, w.state.minis.back], ["minis", "board"], "from the board, a mini game remembers to come back");
  w.run("miniFinish", { id, winner: "team1" }).run("miniClose");
  w.run("minisEnd");
  eq([w.state.phase, w.state.round, w.state.control, w.state.scores.team1, w.qs.find((q) => q.id === "a1").used],
    ["board", 1, "team2", 150, true], "back to the same board: round, control and used clues untouched");
  w.run("minisEnd");
  ok(w.noop, "nothing to return to twice");
  w.run("finalStart");
  w.run("minisStart");
  ok(!!w.error, "no mini games during Final Jeopardy");
  w.run("endGame");
  const w2 = world(roster(1, 1));
  const g2 = w2.add({ name: "Only minis", type: "h2h", points: 100 });
  w2.run("minisStart").run("miniPlay", { id: g2 }).run("miniFinish", { id: g2, winner: "team2" });
  w2.run("endGame");
  eq([w2.state.phase, w2.state.scores.team2], ["over", 100], "a mini-games-only night can end with a winner");
  w2.run("miniPlay", { id: g2 });
  ok(!!w2.error, "no mini games after the game is over");
}

// ---------- removing the game on screen ----------
{
  const w = world(roster(1, 1));
  const id = w.add({ name: "Gone", type: "h2h" });
  w.run("miniPlay", { id }).run("miniRemove", { id });
  eq([w.state.minis.current, w.state.minis.list.length], [null, 0], "deleting the game being played returns to the list");
  eq(E.currentPick(w.state), null, "no pick when nothing is being played");
}

// ---------- stepping away from Jeopardy and back ----------
{
  const w = world(roster(2, 2));
  const id = w.add({ name: "Later", type: "h2h", points: 200 });
  w.run("startGame", { control: "team2" }).run("pickClue", { qid: "a1" });
  w.run("leaveJeopardy", { to: "lobby" });
  ok(!!w.error, "can't leave Jeopardy with a clue open");
  w.run("closeClue").run("adjustScore", { team: "team1", delta: 300 });
  w.run("leaveJeopardy", { to: "lobby" });
  eq([w.state.phase, w.state.jStarted, w.state.round, w.state.control], ["lobby", true, 1, "team2"], "back to the lobby keeps round + who picks");
  w.run("leaveJeopardy", { to: "lobby" });
  ok(w.noop, "leaving twice is a no-op");
  w.run("minisStart").run("miniPlay", { id }).run("miniFinish", { id, winner: "team2" }).run("miniClose");
  w.run("startGame", { control: "team1" });
  eq([w.state.phase, w.state.control, w.state.scores, w.qs.find((q) => q.id === "a1").used],
    ["board", "team2", { team1: 300, team2: 200 }, true], "Start after stepping away RESUMES: same control, scores and used clues");
  w.run("leaveJeopardy", { to: "minis" });
  eq([w.state.phase, w.state.minis.back], ["minis", null], "board → mini games list");
  w.run("leaveMinis");
  eq(w.state.phase, "lobby", "mini games list → lobby");
  w.run("leaveMinis");
  ok(w.noop, "leaveMinis only from the mini games");
  w.run("minisStart"); // from the lobby
  w.run("startGame");
  w.run("minisStart"); // from the board: remembers to come back
  w.run("leaveMinis");
  eq(w.state.phase, "board", "a mini-game break from the board goes back to the board");
  w.run("newGame");
  eq([w.state.phase, w.state.jStarted], ["lobby", false], "new game starts Jeopardy fresh again");
  const old = { ...E.defaultState(), phase: "board" };
  delete old.jStarted;
  eq(E.migrate(old).patch.jStarted, true, "upgrade: a game already on the board counts as started");
}

// ---------- tables & Christmas summons ----------
{
  const { SUMMONS, summonText } = await import("../js/summons.js");
  const w = world(roster(3, 3), 11);
  const id = w.add({ name: "Toss", type: "h2h" });
  eq(w.game().tables, 1, "a new game is played in one spot");
  w.run("miniPlay", { id });
  w.run("miniNext", { id });
  ok(!("table" in E.openMatch(w.game())), "one spot: nothing to summon to");
  eq(E.currentPick(w.state).table, null, "no table on the pick");
  w.run("miniMatch", { id, winner: "team1" });
  // ⏩ Two tables at once — the setting lives on the game
  w.run("miniUpdate", { id, patch: { tables: 3 } });
  eq(E.miniSlots(w.state, w.game()), ["Table 1", "Table 2", "Table 3"], "three tables, numbered");
  w.run("miniReset", { id }); // start the round fresh so all three tables can fill
  w.run("miniPlay", { id });
  w.run("miniNext", { id });
  let open = E.openMatches(w.game());
  eq(open.map((m) => m.table), ["Table 1", "Table 2", "Table 3"], "one draw fills every table with its own matchup");
  const ids = open.flatMap((m) => [m.p1.id, m.p2.id]);
  eq(new Set(ids).size, 6, "nobody is drawn for two tables at once");
  eq(new Set(open.map((m) => m.summon)).size, 3, "each table gets its own Christmas summons");
  eq(E.currentPick(w.state).items.length, 3, "the screens get all three matchups");
  w.run("miniNext", { id });
  ok(w.noop, "no free table → nothing to draw");
  const second = open[1];
  w.run("miniMatch", { id, matchId: second.id, winner: "team2" });
  eq(E.openMatches(w.game()).map((m) => m.table), ["Table 1", "Table 3"], "a result at one table leaves the others playing");
  w.run("miniNext", { id });
  open = E.openMatches(w.game());
  eq(open.map((m) => m.table).sort(), ["Table 1", "Table 2", "Table 3"], "the next draw fills just the free table");
  const busyNow = open.filter((m) => m.table !== "Table 2").flatMap((m) => [m.p1.id, m.p2.id]);
  const g2 = open.find((m) => m.table === "Table 2");
  ok(!busyNow.includes(g2.p1.id) && !busyNow.includes(g2.p2.id), "…with players who aren't busy at another table");
  const lines = open.map((m) => m.summon);
  for (const m of open) w.run("miniMatch", { id, matchId: m.id, winner: "tie" });
  w.run("miniNext", { id });
  ok(!E.openMatches(w.game()).map((m) => m.summon).some((x) => lines.includes(x)), "summons don't repeat right away");
  const third = E.openMatches(w.game()).find((m) => m.table === "Table 3");
  const before = third.summon;
  w.run("miniRepick", { id, matchId: third.id, team: "team1" });
  const third2 = E.openMatches(w.game()).find((m) => m.id === third.id);
  eq(third2.table, "Table 3", "re-drawing keeps the table");
  ok(third2.summon !== before, "re-drawing gives a fresh summon");
  // add / remove tables from the "who's up next" controls
  w.run("miniTableRemove", { id, table: "Table 3" });
  ok(!!w.error && w.error.includes("Table 3"), "a table someone is playing at can't be removed");
  for (const m of E.openMatches(w.game())) w.run("miniMatch", { id, matchId: m.id, winner: "tie" });
  w.run("miniTableRemove", { id, table: "Table 3" });
  eq(w.game().tables, 2, "a free table can be removed");
  w.run("miniTableAdd", { id });
  eq(w.game().tables, 3, "+ Add table puts one back");
  w.run("miniTableRemove", { id, table: "Table 3" });
  w.run("miniTableRemove", { id, table: "Table 2" });
  eq([w.game().tables, E.miniSlots(w.state, w.game())], [1, [null]], "down to one table = back to playing in one spot");
  w.run("miniTableAdd", { id });
  eq(E.miniSlots(w.state, w.game()), ["Table 1", "Table 2"], "from one spot, + Add table makes two tables");
  for (let i = 0; i < 10; i++) w.run("miniTableAdd", { id });
  eq(w.game().tables, 8, "at most 8 tables");
  ok(!!w.error, "…with a message when you try for more");
  w.run("miniUpdate", { id, patch: { tables: 3 } });
  // each game has its own setting
  const solo = w.add({ name: "Relay", type: "h2h" });
  eq([E.miniSlots(w.state, w.game(1)), w.game().tables], [[null], 3], "another game is still played in one spot");
  w.run("miniRemove", { id: solo });
  // more tables than players: only as many matchups as there are free players
  const few = world(roster(1, 2), 3);
  const fid = few.add({ name: "Toss", type: "h2h", tables: 3 });
  few.run("miniPlay", { id: fid });
  few.run("miniNext", { id: fid });
  eq(E.openMatches(few.game()).length, 1, "with one husband, only one table can play at a time");
  const txt = summonText(0, ["Ann", "Bo"], "Table 2");
  ok(txt.includes("Ann and Bo") && txt.includes("Table 2") && !txt.includes("{"), "summon fills in names and table");
  ok(SUMMONS.length >= 30, "plenty of summon lines");
  const b = w.add({ name: "Stack", type: "best", tables: 3 });
  w.run("miniPlay", { id: b });
  w.run("miniNext", { id: b });
  const turns = E.turnsOf(w.game(1));
  eq(turns.map((t) => t.table), ["Table 1", "Table 2", "Table 3"], "best overall: one player per table, all at once");
  eq(new Set(turns.map((t) => t.pid)).size, 3, "…three different players");
  w.run("miniScore", { id: b, turnId: turns[1].id, score: 7 });
  eq(E.turnsOf(w.game(1)).map((t) => t.table), ["Table 1", "Table 3"], "a score at one table frees just that table");
  eq(w.game(1).entries.map((e) => [e.name, e.score]), [[turns[1].name, 7]], "the score goes to the right player");
  w.run("miniUpdate", { id: b, patch: { tables: 99 } });
  eq(w.game(1).tables, 8, "at most 8 tables, however it's set");
  w.run("newGame");
  eq(w.state.minis.list[0].tables, 3, "a game's tables survive a new game");
}

// ---------- ugly sweater vote ----------
{
  const players = [...roster(2, 2), { id: "m1", name: "Grandpa", team: "team1", manual: true }];
  const w = world(players);
  w.run("voteSetup");
  ok(!!w.error, "the vote waits until Jeopardy is over");
  w.state = { ...w.state, phase: "over" };
  w.run("voteSetup");
  eq(w.state.vote.stage, "setup", "host opens the eligible list");
  eq(w.state.vote.candidates.length, 5, "everyone starts eligible");
  w.run("voteToggle", { pid: "w2" });
  w.run("voteToggle", { pid: "m1" });
  eq(w.state.vote.candidates, ["h1", "h2", "w1"], "host un-ticks people without an ugly sweater");
  w.run("castVote", { voter: "h1", pick: "w1" });
  ok(!!w.error, "no voting before it opens");
  w.run("voteOpen");
  eq(w.state.vote.stage, "open", "voting opens");
  w.run("castVote", { voter: "h1", pick: "h1" });
  ok(!!w.error, "can't vote for yourself");
  w.run("castVote", { voter: "h1", pick: "w2" });
  ok(w.noop, "can't vote for someone who isn't eligible");
  w.run("castVote", { voter: "m1", pick: "w1" });
  ok(!!w.error, "players without a phone don't vote");
  w.run("castVote", { voter: "h1", pick: "w1" });
  w.run("castVote", { voter: "h2", pick: "h1" });
  w.run("castVote", { voter: "h2", pick: "w1" }); // changed their mind
  eq(E.voteProgress(w.state, players), { cast: 2, total: 4, all: false }, "progress counts phones only");
  w.run("castVote", { voter: "w1", pick: "h2" });
  eq(w.state.vote.stage, "open", "still hidden until everyone votes");
  w.run("castVote", { voter: "w2", pick: "w1" });
  eq(w.state.vote.stage, "reveal", "last vote reveals the results");
  const r = E.voteResults(w.state);
  eq(r.winners.map((x) => [x.name, x.votes]), [["Wife1", 3]], "most votes wins");
  eq(r.rows.length, 3, "every eligible person is listed");
  w.run("castVote", { voter: "w2", pick: "h2" });
  ok(!!w.error, "no changes after the reveal");
  w.run("voteBack");
  eq(w.state.vote.stage, "off", "back to the final scores");
  // a tie, revealed early by the host
  w.run("voteSetup"); w.run("voteOpen");
  w.run("castVote", { voter: "h1", pick: "w1" });
  w.run("castVote", { voter: "w1", pick: "h1" });
  w.run("voteReveal");
  eq(E.voteResults(w.state).winners.map((x) => x.name).sort(), ["Hub1", "Wife1"], "ties share the crown");
  w.run("voteSetup"); w.run("voteToggle", { pid: "h1" }); w.run("voteToggle", { pid: "h2" }); w.run("voteToggle", { pid: "w1" }); w.run("voteToggle", { pid: "w2" });
  w.run("voteOpen");
  ok(!!w.error, "needs at least two people in the running");
  w.run("newGame");
  eq(w.state.vote.stage, "off", "a new game clears the vote");
}

// ---------- Double Jeopardy switch ----------
{
  const w = world(roster(1, 1));
  w.qs.push({ id: "d1", category: "DJ", points: 200, type: "spoken", round: 2 });
  w.run("startGame");
  ok(!E.r2On(w.state, w.qs), "Double Jeopardy is never played, even with old round-2 questions loaded");
  w.run("startRound2");
  ok(!!w.error && w.state.round === 1, "…and can't be started");
}

// ---------- clocks stop once answers are in ----------
{
  const w = world(roster(1, 1));
  w.run("startGame", { control: "team1" });
  w.run("pickClue", { qid: "a1" });
  w.run("openBuzzers");
  w.run("claimBuzz", { buzzRound: w.state.clue.buzzRound, candidates: [{ deviceId: "h1", name: "Hub1", team: "team1", t: w.state.clue.openedAt + 50 }] }, 2000);
  const key = E.lockKey(w.state.clue);
  ok(w.state.clue.stage === "answering", "someone buzzed in");
  w.run("answerSubmitted", { key });
  eq(w.state.clue.submitted, key, "a typed answer stops the answer clock");
  w.run("answerTimeout", { key }, 60000);
  ok(w.noop && !w.state.clue.timeUp, "…so time can't run out on it");
  w.run("judge", { result: "correct" });
  eq(w.state.scores.team1, 100, "host still judges it");
  w.run("closeClue");
  w.run("pickClue", { qid: "a2" });
  w.run("openBuzzers");
  w.run("claimBuzz", { buzzRound: w.state.clue.buzzRound, candidates: [{ deviceId: "w1", name: "Wife1", team: "team2", t: w.state.clue.openedAt + 50 }] }, 2000);
  const k2 = E.lockKey(w.state.clue);
  w.run("answerTimeout", { key: k2 }, 60000);
  eq([w.state.clue.stage, w.state.scores.team2], ["answering", 0], "time runs out on a slow answer: the bell rings, nothing is decided");
  w.run("judge", { result: "wrong" });
  eq([w.state.clue.stage, w.state.scores.team2], ["open", -200], "…and Jaren rules they missed it");
  w.run("answerSubmitted", { key: k2 });
  ok(!!w.error && !w.state.clue.submitted, "an answer after time's up is refused");
  w.run("nobody");

  // Final: everyone answered → locks at once; multiple choice scores itself on reveal
  w.qs = w.qs.map((q) => (q.isFinal ? { ...q, type: "mcq", choices: ["Mars", "Venus"], correctIndex: 0 } : q));
  w.run("setScore", { team: "team2", value: 300 });
  w.run("finalStart");
  w.run("finalWager", { team: "team1", amount: 50, by: "Hub1" });
  w.run("finalWager", { team: "team2", amount: 200, by: "Wife1" });
  w.run("finalRevealClue");
  w.run("finalAnswer", { team: "team1", text: "Mars", by: "Hub1" });
  eq(w.state.final.stage, "clue", "auto-saved typing doesn't count as submitted");
  w.run("finalAnswer", { team: "team1", text: "Mars", by: "Hub1", done: true });
  eq(w.state.final.stage, "clue", "one team in — the clock keeps going for the other");
  w.run("finalAnswer", { team: "team1", text: "Mars", by: "Hub2", done: false });
  eq([w.state.final.answers.team1.done, w.state.final.answers.team1.text], [false, "Mars"], "a teammate can undo the team's submission (answer kept to edit)");
  w.run("finalAnswer", { team: "team1", text: "Mars", by: "Hub2", done: true });
  w.run("finalAnswer", { team: "team2", text: "Venus", by: "Wife1", done: true });
  eq(w.state.final.stage, "clue", "both teams in — the music and timer still run to the end");
  w.run("finalLock", {}, 40000);
  eq(w.state.final.stage, "reveal", "answers lock when time runs out");
  w.run("finalShowAnswer", { team: "team2" });
  eq([w.state.final.results.team2, w.state.scores.team2], ["wrong", 100], "multiple-choice Final: a wrong pick is marked wrong instantly");
  w.run("finalShowAnswer", { team: "team1" });
  eq([w.state.final.results.team1, w.state.scores.team1], ["correct", 150], "…and a right one is marked right");
}

{
  const old = { ...E.defaultState(), settings: { ...E.DEFAULT_SETTINGS, finalSeconds: 30 } };
  eq(E.migrate(old).patch.settings.finalSeconds, 31, "old 30-second Final default becomes the song length (31 s)");
  eq(E.DEFAULT_SETTINGS.finalSeconds, 31, "new games default to the song length");
  const mine = { ...E.defaultState(), settings: { ...E.DEFAULT_SETTINGS, finalSeconds: 45 } };
  eq(E.migrate(mine), null, "a Final time the host chose is left alone");
}

// ---------- host picks the table; Final wager undo ----------
{
  const w = world(roster(2, 2), 5);
  const id = w.add({ name: "Toss", type: "h2h", tables: 2 });
  w.run("miniPlay", { id });
  w.run("miniNext", { id });
  const other = E.currentPick(w.state).table === "Table 1" ? "Table 2" : "Table 1";
  w.run("miniSetTable", { id, table: other });
  eq(E.currentPick(w.state).table, other, "host sends the drawn players to a different table");
  w.run("miniSetTable", { id, table: "Attic" });
  ok(w.noop, "only tables that exist");
  const b = w.add({ name: "Stack", type: "best", tables: 2 });
  w.run("miniPlay", { id: b });
  w.run("miniNext", { id: b });
  const t2 = E.currentPick(w.state).table === "Table 1" ? "Table 2" : "Table 1";
  w.run("miniSetTable", { id: b, table: t2 });
  eq(E.currentPick(w.state).table, t2, "works for best-overall turns too");

  const f = world(roster(1, 1));
  f.run("startGame", { control: "team1" });
  f.run("setScore", { team: "team1", value: 500 });
  f.run("setScore", { team: "team2", value: 400 });
  f.run("finalStart");
  f.run("finalWager", { team: "team1", amount: 100, by: "Hub1" });
  f.run("finalWagerUndo", { team: "team1" });
  ok(!f.state.final.wagers.team1, "a locked Final wager can be taken back to change it");
  f.run("finalWager", { team: "team1", amount: 300, by: "Hub1" });
  eq(f.state.final.wagers.team1.amount, 300, "…and locked in again");
}

// ---------- the to-play pool: out the moment you're picked; everyone gets a turn tonight ----------
{
  const w = world(roster(4, 4), 11);
  const a = w.add({ name: "Toss", type: "h2h" });
  w.run("miniPlay", { id: a });
  w.run("miniNext", { id: a });
  let m = E.openMatch(w.game());
  eq([w.game().played.team1, w.game().played.team2], [[m.p1.id], [m.p2.id]], "picked players leave the pool right away (before the result)");
  const was = m.p1.id;
  w.run("miniRepick", { id: a, team: "team1" });
  m = E.openMatch(w.game());
  ok(m.p1.id !== was && !w.game().played.team1.includes(was) && w.game().played.team1.includes(m.p1.id), "a re-draw puts the replaced player back in the pool");
  ok(!w.state.minis.tonight.team1.includes(was), "…for the rest of the night too");
  w.run("miniSetPlayer", { id: a, team: "team1", pid: "h4" });
  eq(w.game().played.team1, ["h4"], "Jaren hand-picking someone swaps them in the pool as well");
  w.run("miniMatch", { id: a, winner: "team1" });
  eq(w.game().played.team1, ["h4"], "recording the result doesn't count them twice");
  w.run("miniNext", { id: a });
  ok(E.openMatch(w.game()).p1.id !== "h4", "nobody who's been picked comes up again before the rest of their team");
  w.run("miniMatch", { id: a, winner: "tie" });
  w.run("miniFinish", { id: a, winner: "tie" });
  const tonight = [...w.state.minis.tonight.team1];
  eq(tonight.length, 2, "two husbands have played a mini game tonight");
  // the next game starts with the people who haven't played yet
  const b = w.add({ name: "Stack", type: "best" });
  w.run("miniPlay", { id: b });
  const seen = [];
  for (let i = 0; i < 4; i++) { w.run("miniNext", { id: b }); const t = E.turnsOf(w.game(1))[0]; seen.push(t); w.run("miniScore", { id: b, score: i }); }
  const husbands = seen.filter((t) => t.team === "team1").map((t) => t.pid);
  ok(husbands.length === 2 && husbands.every((pid) => !tonight.includes(pid)), "the next mini game picks people who haven't played tonight first");
}

// ---------- the game clock: one timer for every table, horn at zero ----------
{
  const w = world(roster(2, 2));
  const plain = w.add({ name: "Snowball Toss", type: "h2h", points: 500 });
  const id = w.add({ name: "Cup Stack", type: "h2h", points: 500, timed: true, seconds: 45 });
  eq([w.game(1).timed, w.game(1).seconds, w.game(1).clock], [true, 45, null], "a game can be played against the clock");
  eq([w.game(0).timed, w.game(0).seconds], [false, 60], "untimed games default to a minute, unticked");
  w.run("miniUpdate", { id, patch: { seconds: 5000 } });
  eq(w.game(1).seconds, 3600, "the clock tops out at an hour");
  w.run("miniUpdate", { id, patch: { seconds: 30 } });

  ok(w.run("miniTimerStart", { id }).noop, "the clock can't start before the game does");
  w.run("minisStart");
  w.run("miniPlay", { id });
  ok(w.run("miniTimerStart", { id: plain }).noop, "a game with no timer has no clock to start");
  const at = w.t + 10;
  w.run("miniTimerStart", { id });
  eq([w.game(1).clock.endsAt - w.game(1).clock.startedAt, w.game(1).clock.done], [30000, false], "Jaren starts it: 30 seconds on the clock");
  eq(w.state.sfx.sound, "buzz", "…with a cue so everyone knows it's running");
  const ends = w.game(1).clock.endsAt;
  ok(at <= ends, "the end time is on the shared clock, so every screen counts down together");

  ok(w.run("miniTimerDone", { id }, 1000).noop, "no horn while there's time left");
  // Several tables are playing the same game — they all run off this one clock.
  w.run("miniTableAdd", { id });
  w.run("miniNext", { id });
  eq(E.openMatches(w.game(1)).length, 2, "two tables are playing");
  eq(w.game(1).clock.endsAt, ends, "…off the same clock");

  // The horn is cued a moment early so it lands on zero, on every screen at once.
  w.t = ends - E.TIMER_LEAD_MS - 100;
  ok(w.run("miniTimerDone", { id }).noop, "…and not a moment too soon");
  w.t = ends - 300;
  w.run("miniTimerDone", { id });
  eq([w.game(1).clock.done, w.state.sfx.sound], [true, "horn"], "time's up: the horn sounds");
  ok(w.run("miniTimerDone", { id }, 2000).noop, "the horn only sounds once");
  eq(E.miniClockLeft(w.game(1), ends - 5000), 5000, "screens show the time left off the same end time");
  ok(E.miniClockRunning(w.game(1), ends - 1) && !E.miniClockRunning(w.game(1), ends + 1), "the clock is running right up to zero");

  // Start it again for the next pair, stop it by hand, and clear it when the game is over.
  w.run("miniTimerStart", { id });
  ok(w.game(1).clock.done === false && w.game(1).clock.endsAt > ends, "↻ Restart puts 30 seconds back on");
  w.run("miniTimerStop", { id });
  eq(w.game(1).clock, null, "⏹ Stop clears it");
  w.run("miniTimerStart", { id });
  w.run("miniFinish", { id, winner: "team1" });
  eq(w.game(1).clock, null, "finishing the game puts the clock away");
  w.run("miniReset", { id });
  eq([w.game(1).clock, w.game(1).timed, w.game(1).seconds], [null, true, 30], "↺ Reset clears the clock but keeps the setting");
  // A blind drawing has its own step clock, so it never gets this one.
  const d = w.add({ name: "Blind Drawing", type: "draw", timed: true, seconds: 30 });
  eq(w.state.minis.list[2].timed, false, "blind drawing runs on its own step clock");
}

// ---------- an odd number of couples at two tables: nobody is called up twice ----------
{
  const people = [];
  for (let i = 1; i <= 3; i++) { people.push({ id: "h" + i, name: "H" + i, team: "team1", pair: i }); people.push({ id: "w" + i, name: "W" + i, team: "team2", pair: i }); }
  const w = world(people, 5);
  const id = w.add({ name: "Toss", type: "h2h", tables: 2 });
  w.run("minisStart");
  w.run("miniPlay", { id });
  w.run("miniNext", { id });
  let open = E.openMatches(w.game());
  eq(open.length, 2, "first draw fills both tables");
  eq(new Set(open.flatMap((m) => [m.p1.id, m.p2.id])).size, 4, "…with four different people");
  for (const m of open) w.run("miniMatch", { id, matchId: m.id, winner: "team1" });
  // One couple left: the spare table waits instead of calling someone up for a second go.
  w.run("miniNext", { id });
  open = E.openMatches(w.game());
  eq(open.length, 1, "with one couple left, only one table is filled");
  eq([open[0].p1.name, open[0].p2.name], ["H3", "W3"], "…and it's the couple who hadn't played");
  // The host can still start the next round at the free table if they want to.
  w.run("miniNext", { id, table: "Table 2" });
  eq(E.openMatches(w.game()).length, 2, "🎲 Draw for Table 2 starts the next round there anyway");
  for (const m of E.openMatches(w.game())) w.run("miniMatch", { id, matchId: m.id, winner: "tie" });
  // A fresh round fills both tables again.
  w.run("miniNext", { id });
  open = E.openMatches(w.game());
  eq(new Set(open.flatMap((m) => [m.p1.id, m.p2.id])).size, open.length * 2, "a new round fills tables with different people again");
  // Best overall, three tables, five players: two tables wait for the next round.
  const b2 = world(roster(3, 2), 4);
  const bid = b2.add({ name: "Stack", type: "best", tables: 3 });
  b2.run("minisStart");
  b2.run("miniPlay", { id: bid });
  b2.run("miniNext", { id: bid });
  eq(E.turnsOf(b2.game()).length, 3, "best overall: three tables, three different players");
  for (const t of E.turnsOf(b2.game())) b2.run("miniScore", { id: bid, turnId: t.id, score: 3 });
  b2.run("miniNext", { id: bid });
  eq(E.turnsOf(b2.game()).length, 2, "…then only the two who haven't played");
  eq(new Set(E.turnsOf(b2.game()).map((t) => t.pid)).size, 2, "…each at their own table");
}

// ---------- everyone at once: no draws, no scores, Jaren says who won ----------
{
  const w = world(roster(2, 2), 3);
  const id = w.add({ name: "Tug of War", type: "all", points: 400, timed: true, seconds: 20 });
  eq([w.game().type, w.game().tables, w.game().timed], ["all", 1, true], "everyone at once: one spot, and it can still be timed");
  w.run("miniUpdate", { id, patch: { tables: 4 } });
  eq(w.game().tables, 1, "it can't be split across tables — the whole room plays together");
  w.run("minisStart");
  w.run("miniPlay", { id });
  ok(w.run("miniNext", { id }).noop, "nobody is drawn");
  eq(E.currentPick(w.state), null, "…so there's no name shuffle");
  ok(w.run("miniTableAdd", { id }).error, "…and no tables to add");
  w.run("miniTimerStart", { id });
  ok(!!E.miniClock(w.game()), "the clock still works for it");
  w.run("miniFinish", { id, winner: "team2" });
  eq([w.state.scores.team2, w.state.scores.team1, w.game().result.winner, w.game().status], [400, 0, "team2", "done"], "Jaren taps who won and the points go on");
  eq(w.game().clock, null, "…and the clock is put away");
  w.run("miniReset", { id });
  eq(w.state.scores.team2, 0, "↺ Reset hands the points back");
  w.run("miniPlay", { id });
  w.run("miniFinish", { id, winner: "tie" });
  eq([w.state.scores.team1, w.state.scores.team2], [200, 200], "a tie splits them");
}

// ---------- blind drawing is a once-a-night thing ----------
{
  const w = world(roster(2, 2), 3);
  w.add({ name: "Blind Drawing", type: "draw" });
  w.add({ name: "Another Drawing", type: "draw" });
  ok(!!w.error && w.error.includes("once for the night"), "only one Blind Drawing a night");
  eq(w.state.minis.list.length, 1, "…so the second one isn't added");
  w.add({ name: "Toss", type: "h2h" });
  eq(w.state.minis.list.length, 2, "other games are fine");
}

ok(unsafe === 0, "no undefined values or nested arrays ever sent to the database");
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
