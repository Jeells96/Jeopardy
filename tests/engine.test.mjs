// Unit tests for js/engine.js — run with:  node tests/engine.test.mjs
import * as E from "../js/engine.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; } else { failed++; console.log("  ✗ " + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// Apply a change set to a state + question list (like the data layer would).
function apply(state, qs, change) {
  if (!change || change.error) return { state, qs };
  const s2 = { ...state, ...change.set };
  const q2 = qs.map((q) => { const u = (change.questions || []).find((x) => x.id === q.id); return u ? { ...q, ...u.data } : q; });
  return { state: s2, qs: q2 };
}
let T = 1_000_000;
const ctx = (qs, dt = 0) => ({ now: (T += 10 + dt), questions: qs });
function run(st, name, params = {}, dt = 0) {
  const ch = E.ACTIONS[name](st.state, params, ctx(st.qs, dt));
  if (ch && ch.error) return { ...st, error: ch.error };
  const r = apply(st.state, st.qs, ch);
  return { ...r, error: null, noop: !ch, change: ch };
}

const QS = [
  { id: "a1", category: "Movies", points: 100, type: "spoken", round: 1 },
  { id: "a2", category: "Movies", points: 200, type: "mcq", choices: ["x", "y", "z"], correctIndex: 1, round: 1 },
  { id: "a3", category: "Movies", points: 300, type: "spoken", dailyDouble: true, round: 1 },
  { id: "a4", category: "Movies", points: 500, type: "mcq", choices: ["p", "q"], correctIndex: 0, dailyDouble: true, round: 1 },
  { id: "b1", category: "DJ Songs", points: 400, type: "spoken", round: 2 },
  { id: "f1", category: "Poems", points: 0, type: "spoken", isFinal: true },
];
const P1 = { deviceId: "p1", name: "Ann", team: "team1" };
const P2 = { deviceId: "p2", name: "Bob", team: "team2" };
const P3 = { deviceId: "p3", name: "Cy", team: "team1" };

function fresh() { return { state: E.defaultState(), qs: QS.map((q) => ({ ...q })) }; }

console.log("engine tests");

// --- start / pick / buzz / correct ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  eq(st.state.phase, "board", "startGame -> board");
  eq(st.state.control, "team1", "startGame sets control");
  st = run(st, "pickClue", { qid: "a1" });
  eq(st.state.clue.stage, "reading", "regular clue starts in reading");
  ok(st.qs.find((q) => q.id === "a1").used, "picked clue marked used");
  ok(run(st, "pickClue", { qid: "a2" }).noop, "can't pick a second clue while one is open");
  ok(run(st, "claimBuzz", { me: P1, buzzRound: 1 }).noop, "can't buzz before buzzers open");
  st = run(st, "openBuzzers");
  eq(st.state.clue.stage, "open", "buzzers open");
  const br = st.state.clue.buzzRound;
  const won = run(st, "claimBuzz", { me: P2, buzzRound: br });
  eq(won.state.clue.locked.name, "Bob", "first buzz locks in");
  eq(won.state.sfx.sound, "buzz", "buzz plays buzz-in sound");
  ok(run(won, "claimBuzz", { me: P1, buzzRound: br }).noop, "second buzz is ignored (race safe)");
  st = run(won, "judge", { result: "correct" });
  eq(st.state.scores.team2, 100, "correct adds clue value");
  eq(st.state.control, "team2", "correct answer takes control of the board");
  eq(st.state.clue.result, "correct", "result correct");
  ok(st.state.clue.revealed, "answer revealed after correct");
  st = run(st, "closeClue");
  eq(st.state.phase, "board", "close returns to board");
  eq(st.state.clue, null, "clue cleared");
}

// --- wrong answer auto-rebound, then nobody ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = run(st, "claimBuzz", { me: P1, buzzRound: st.state.clue.buzzRound });
  st = run(st, "judge", { result: "wrong" });
  eq(st.state.scores.team1, -100, "wrong subtracts value");
  eq(st.state.clue.stage, "open", "auto-rebound reopens buzzers");
  eq(st.state.clue.blocked, ["team1"], "missing team is blocked");
  ok(run(st, "claimBuzz", { me: P3, buzzRound: st.state.clue.buzzRound }).noop, "blocked team can't buzz again");
  st = run(st, "claimBuzz", { me: P2, buzzRound: st.state.clue.buzzRound });
  eq(st.state.clue.locked.team, "team2", "other team gets the rebound");
  st = run(st, "judge", { result: "skip" });
  eq(st.state.scores.team2, 0, "skip has no penalty");
  eq(st.state.clue.result, "nobody", "both teams out -> nobody");
  eq(st.state.control, "team1", "control unchanged when nobody gets it");
}

// --- auto-rebound off -> paused ---
{
  let st = fresh();
  st = run(st, "setSettings", { patch: { autoRebound: false, answerSeconds: 999 } });
  eq(st.state.settings.answerSeconds, 120, "settings are clamped to limits");
  st = run(st, "startGame", {});
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = run(st, "claimBuzz", { me: P1, buzzRound: st.state.clue.buzzRound });
  st = run(st, "judge", { result: "wrong" });
  eq(st.state.clue.stage, "paused", "without auto-rebound the clue pauses");
  st = run(st, "openBuzzers");
  eq(st.state.clue.stage, "open", "host can reopen manually");
}

// --- multiple choice: wrong eliminates, correct scores ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "pickClue", { qid: "a2" });
  st = run(st, "openBuzzers");
  st = run(st, "claimBuzz", { me: P1, buzzRound: st.state.clue.buzzRound });
  ok(run(st, "mcqPick", { index: 1, me: P3 }).noop, "only the buzzed-in player can answer mcq");
  st = run(st, "mcqPick", { index: 0, me: P1 });
  eq(st.state.scores.team1, -200, "wrong mcq subtracts");
  eq(st.state.clue.eliminated, [0], "wrong option eliminated for the rebound");
  st = run(st, "claimBuzz", { me: P2, buzzRound: st.state.clue.buzzRound });
  ok(run(st, "mcqPick", { index: 0, me: P2 }).noop, "eliminated option can't be picked");
  st = run(st, "mcqPick", { index: 1, me: P2 });
  eq(st.state.scores.team2, 200, "correct mcq adds");
  eq(st.state.clue.mcq.index, 1, "mcq selection recorded");
}

// --- answer timeout: points come off automatically, the other team gets to steal ---
{
  let st = fresh();
  st = run(st, "startGame", {});
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = run(st, "claimBuzz", { me: P1, buzzRound: st.state.clue.buzzRound });
  const key = E.lockKey(st.state.clue);
  ok(run(st, "answerTimeout", { key }).noop, "timeout ignored before time runs out");
  st = run(st, "answerTimeout", { key }, 16000);
  eq(st.state.scores.team1, -100, "typed answer out of time: points come off automatically");
  eq(st.state.sfx.sound, "timesup", "only the time's-up sound plays (not the wrong-answer one)");
  eq([st.state.clue.stage, st.state.clue.blocked], ["open", ["team1"]], "the other team can buzz in to steal");
  const until = E.buzzDeadline(st.state.clue, st.state.settings);
  ok(until - st.state.clue.openedAt === 30000, "…with 30 seconds to buzz in");
  ok(run(st, "answerTimeout", { key }, 1000).noop, "timeout only fires once");
  const rk = E.lockKey(st.state.clue);
  ok(run(st, "buzzWindowTimeout", { key: rk }, 10000).noop, "steal window still open after 10 s");
  const after = run(st, "buzzWindowTimeout", { key: rk }, 31000);
  eq([after.state.clue.stage, after.state.clue.result, after.state.clue.revealed, after.state.scores.team2], ["done", "nobody", true, 0], "nobody steals in 30 s → answer shown, no points lost");

  let m = fresh();
  m = run(m, "startGame", {});
  m = run(m, "pickClue", { qid: "a2" });
  m = run(m, "openBuzzers");
  m = run(m, "claimBuzz", { me: P1, buzzRound: m.state.clue.buzzRound });
  m = run(m, "answerTimeout", { key: E.lockKey(m.state.clue) }, 16000);
  eq(m.state.scores.team1, -200, "mcq timeout docks automatically");
  eq(m.state.clue.stage, "open", "and rebounds to the other team");
}

// --- buzz window timeout ---
{
  let st = fresh();
  st = run(st, "setSettings", { patch: { buzzWindowSeconds: 5 } });
  st = run(st, "startGame", {});
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  const key = E.lockKey(st.state.clue);
  ok(run(st, "buzzWindowTimeout", { key }).noop, "window not expired yet");
  st = run(st, "buzzWindowTimeout", { key }, 6000);
  eq(st.state.clue.result, "nobody", "nobody buzzed -> clue dies");
  ok(st.state.clue.revealed, "answer revealed when time runs out");
}

// --- Daily Double wager limits ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team2" });
  st = run(st, "pickClue", { qid: "a3" });
  eq(st.state.clue.stage, "dd", "daily double stage");
  eq(st.state.clue.dd.team, "team2", "DD goes to team in control");
  eq(st.state.sfx.sound, "dd", "DD sound");
  eq(E.ddLimits(st.state, st.qs, "team2"), { min: 5, max: 500 }, "at $0, the DD max is the board's top value (show rule)");
  eq(E.ddLimits({ ...st.state, scores: { team1: 0, team2: 300 } }, st.qs, "team2"), { min: 5, max: 300 }, "with $300, the DD max is $300 — everything they have");
  eq(E.ddLimits({ ...st.state, scores: { team1: 0, team2: -200 } }, st.qs, "team2").max, 500, "negative score: up to the board's top value");
  ok(!!run(st, "lockDDWager", { team: "team2", wager: 501 }).error, "DD over max rejected");
  ok(!!run(st, "lockDDWager", { team: "team2", wager: 4 }).error, "DD under $5 rejected");
  ok(run(st, "openBuzzers").noop, "no buzzing on a Daily Double");
  st = run(st, "lockDDWager", { team: "team2", wager: 500 });
  eq(st.state.clue.stage, "answering", "DD wager locks into answering");
  st = run(st, "judge", { result: "wrong" });
  eq(st.state.scores.team2, -500, "DD wrong subtracts wager");
  eq(st.state.clue.stage, "done", "DD ends after one answer (no rebound)");
  eq(st.state.control, "team2", "DD team keeps control");

  // True Daily Double: score above round max
  let t = fresh();
  t.state = { ...t.state, scores: { team1: 1200, team2: 0 } };
  t = run(t, "startGame", { control: "team1" });
  t.state = { ...t.state, scores: { team1: 1200, team2: 0 } };
  t = run(t, "pickClue", { qid: "a4" });
  eq(E.ddLimits(t.state, t.qs, "team1").max, 1200, "DD max = own score when higher");
  t = run(t, "lockDDWager", { team: "team1", wager: 1200 });
  ok(run(t, "mcqPick", { index: 0, me: P2 }).noop, "other team can't answer a DD mcq");
  t = run(t, "mcqPick", { index: 0, me: P3 });
  eq(t.state.scores.team1, 2400, "true daily double doubles the score");
}

// --- undo ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = run(st, "claimBuzz", { me: P2, buzzRound: st.state.clue.buzzRound });
  st = run(st, "judge", { result: "correct" });
  eq(st.state.control, "team2", "control moved");
  st = run(st, "undo");
  eq(st.state.scores.team2, 0, "undo reverses score");
  eq(st.state.control, "team1", "undo restores previous control");
  eq(st.state.history.length, 0, "undo pops history");
  ok(run(st, "undo").noop, "undo with empty history is a no-op");
  st = run(st, "adjustScore", { team: "team1", delta: 300 });
  st = run(st, "setScore", { team: "team1", value: 1000 });
  eq(st.state.scores.team1, 1000, "setScore sets exact value");
}

// --- put a clue back ---
{
  let st = fresh();
  st = run(st, "startGame", {});
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "unpickClue");
  eq(st.state.phase, "board", "unpick returns to board");
  ok(!st.qs.find((q) => q.id === "a1").used, "unpicked clue is available again");
}

// --- round 2 ---
{
  let st = fresh();
  st.state = { ...st.state, scores: { team1: 900, team2: 300 } };
  st = run(st, "startGame", { control: "team1" });
  st.state = { ...st.state, scores: { team1: 900, team2: 300 } };
  const r2 = E.ACTIONS.startRound2(st.state, {}, { now: 1, questions: QS, players: [] });
  ok(!!(r2 && r2.error) && st.state.round === 1, "Double Jeopardy is gone — the game is one round + Final");
  ok(run(st, "pickClue", { qid: "b1" }).noop, "old round-2 questions never show up on the board");
}

// --- Final Jeopardy ---
{
  let st = fresh();
  st = run(st, "startGame", {});
  st.state = { ...st.state, scores: { team1: 1000, team2: -200 } };
  st = run(st, "finalStart");
  eq(st.state.phase, "final", "final phase");
  eq(st.state.final.eligible, { team1: true, team2: false }, "only positive scores play Final");
  eq(st.state.final.order, ["team2", "team1"], "reveal lowest score first");
  ok(!!run(st, "finalWager", { team: "team2", amount: 0 }).error, "ineligible team can't wager");
  ok(!!run(st, "finalWager", { team: "team1", amount: 1001 }).error, "can't wager more than score");
  st = run(st, "finalWager", { team: "team1", amount: 600, by: "Ann" });
  eq(st.state.final.wagers.team1.amount, 600, "wager saved");
  st = run(st, "finalSetEligible", { team: "team2", eligible: true });
  st = run(st, "finalRevealClue");
  eq(st.state.final.stage, "clue", "clue revealed");
  eq(st.state.final.wagers.team2.amount, 0, "missing wager defaults to $0");
  st = run(st, "finalAnswer", { team: "team1", text: "  A Visit from St. Nicholas ", by: "Ann" });
  eq(st.state.final.answers.team1.text, "A Visit from St. Nicholas", "answer saved trimmed");
  ok(run(st, "finalLock").noop, "lock waits for the timer");
  st = run(st, "finalLock", { force: true });
  eq(st.state.final.stage, "reveal", "answers locked");
  ok(run(st, "finalAnswer", { team: "team1", text: "late" }).noop, "no answers after lock");
  st = run(st, "finalShowAnswer", { team: "team2" });
  ok(st.state.final.shown.team2.answer, "answer shown");
  st = run(st, "finalJudge", { team: "team1", correct: true });
  eq(st.state.scores.team1, 1600, "correct final adds wager");
  ok(run(st, "finalJudge", { team: "team1", correct: false }).noop, "can't judge twice");
  st = run(st, "undo");
  eq(st.state.scores.team1, 1000, "undo final judgement");
  eq(st.state.final.results.team1, null, "undo clears final result so it can be re-judged");
  st = run(st, "finalJudge", { team: "team1", correct: false });
  eq(st.state.scores.team1, 400, "wrong final subtracts wager");
  st = run(st, "finalFinish");
  eq(st.state.phase, "over", "game over");
  eq(st.state.sfx.sound, "win", "winner sound");
}

// --- new game keeps names/settings ---
{
  let st = fresh();
  st = run(st, "setTeamName", { team: "team1", name: "  The Elves  " });
  st = run(st, "setSettings", { patch: { answerSeconds: 20 } });
  st.state = { ...st.state, scores: { team1: 500, team2: 100 }, phase: "over" };
  st = run(st, "newGame");
  eq(st.state.teamNames.team1, "The Elves", "new game keeps team names");
  eq(st.state.settings.answerSeconds, 20, "new game keeps settings");
  eq(st.state.scores, { team1: 0, team2: 0 }, "new game resets scores");
  eq(st.state.phase, "lobby", "new game back to lobby");
}

// --- guard: no undefined anywhere in change sets (Firestore rejects undefined) ---
{
  const hasUndef = (v) => v === undefined || (v && typeof v === "object" && Object.values(v).some(hasUndef));
  let st = fresh(); let bad = 0;
  const steps = [["startGame", { control: "random" }], ["pickClue", { qid: "a3" }], ["lockDDWager", { team: "team1", wager: 100 }], ["judge", { result: "correct" }], ["closeClue"], ["finalStart"]];
  for (const [n, p] of steps) { const ch = E.ACTIONS[n](st.state, p || {}, ctx(st.qs)); if (ch && hasUndef(ch.set)) bad++; st = apply(st.state, st.qs, ch); }
  eq(bad, 0, "change sets never contain undefined");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
