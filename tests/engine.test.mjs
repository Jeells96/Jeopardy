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
// A press `ms` after the buzzers open, decided once the grace period has passed.
const buzz = (st, me, ms = 50) => run(st, "claimBuzz", { buzzRound: st.state.clue ? st.state.clue.buzzRound : 0, candidates: st.state.clue ? [{ ...me, t: st.state.clue.openedAt + ms }] : [] }, 2000);

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
  ok(buzz(st, P1).noop, "can't buzz before buzzers open");
  st = run(st, "openBuzzers");
  eq(st.state.clue.stage, "open", "buzzers open");
  const br = st.state.clue.buzzRound;
  const won = buzz(st, P2);
  eq(won.state.clue.locked.name, "Bob", "first buzz locks in");
  eq(won.state.sfx.sound, "buzz", "buzz plays buzz-in sound");
  ok(buzz(won, P1).noop, "second buzz is ignored (race safe)");
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
  st = buzz(st, P1);
  st = run(st, "judge", { result: "wrong" });
  eq(st.state.scores.team1, -100, "wrong subtracts value");
  eq(st.state.clue.stage, "open", "auto-rebound reopens buzzers");
  eq(st.state.clue.blocked, ["team1"], "missing team is blocked");
  ok(buzz(st, P3).noop, "blocked team can't buzz again");
  st = buzz(st, P2);
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
  st = buzz(st, P1);
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
  st = buzz(st, P1);
  ok(run(st, "mcqPick", { index: 1, me: P3 }).noop, "only the buzzed-in player can answer mcq");
  st = run(st, "mcqPick", { index: 0, me: P1 });
  eq(st.state.scores.team1, -200, "wrong mcq subtracts");
  eq(st.state.clue.eliminated, [0], "wrong option eliminated for the rebound");
  st = buzz(st, P2);
  ok(run(st, "mcqPick", { index: 0, me: P2 }).noop, "eliminated option can't be picked");
  st = run(st, "mcqPick", { index: 1, me: P2 });
  eq(st.state.scores.team2, 200, "correct mcq adds");
  eq(st.state.clue.mcq.index, 1, "mcq selection recorded");
}

// --- out of time: the bell rings, but Jaren decides whether the points come off ---
{
  let st = fresh();
  st = run(st, "startGame", {});
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = buzz(st, P1);
  const key = E.lockKey(st.state.clue);
  ok(run(st, "answerTimeout", { key }).noop, "timeout ignored before time runs out");
  st = run(st, "answerTimeout", { key }, 16000);
  eq(st.state.scores.team1, 0, "out of time: nothing comes off until Jaren says so");
  eq(st.state.sfx.sound, "timesup", "the time's-up bell rings");
  eq([st.state.clue.stage, st.state.clue.timeUp === key, E.isLate(st.state.clue)], ["answering", true, true], "it waits on Jaren as a late answer");
  ok(run(st, "answerTimeout", { key }, 1000).noop, "the bell only rings once");
  ok(run(st, "answerSubmitted", { key }, 1000).error, "the answer box is closed");
  ok(run(st, "mcqPick", { index: 0, me: P1 }, 1000).noop, "and so are the multiple-choice options");

  // Jaren forgives it: full points, just like a normal correct answer.
  const kind = run(st, "judge", { result: "correct" }, 2000);
  eq([kind.state.scores.team1, kind.state.clue.stage, kind.state.clue.result], [100, "done", "correct"], "“Allow it” gives them the points");
  eq(kind.state.sfx.sound, "correct", "…with the correct sound");
  // Jaren rules they missed it: points off, the other team can steal, and no second bell.
  const hard = run(st, "judge", { result: "wrong" }, 2000);
  eq(hard.state.scores.team1, -100, "“Too late” takes the points");
  eq(hard.state.sfx, st.state.sfx, "…and nothing buzzes a second time");
  eq([hard.state.clue.stage, hard.state.clue.blocked], ["open", ["team1"]], "the other team can buzz in to steal");
  eq(hard.state.history[hard.state.history.length - 1].why, "time", "it goes down as unanswered, not a wrong answer");
  const until = E.buzzDeadline(hard.state.clue, hard.state.settings);
  ok(until - hard.state.clue.openedAt === 30000, "…with 30 seconds to buzz in");
  const rk = E.lockKey(hard.state.clue);
  ok(run(hard, "buzzWindowTimeout", { key: rk }, 10000).noop, "steal window still open after 10 s");
  const after = run(hard, "buzzWindowTimeout", { key: rk }, 31000);
  eq([after.state.clue.stage, after.state.clue.result, after.state.clue.revealed, after.state.scores.team2], ["done", "nobody", true, 0], "nobody steals in 30 s → answer shown, no points lost");
  // Or he lets them off entirely.
  const off = run(st, "judge", { result: "skip" }, 2000);
  eq([off.state.scores.team1, off.state.clue.stage], [0, "open"], "“Let them off” costs nothing and rebounds");

  let m = fresh();
  m = run(m, "startGame", {});
  m = run(m, "pickClue", { qid: "a2" });
  m = run(m, "openBuzzers");
  m = buzz(m, P1);
  m = run(m, "answerTimeout", { key: E.lockKey(m.state.clue) }, 16000);
  eq(m.state.scores.team1, 0, "multiple choice waits on Jaren too");
  m = run(m, "judge", { result: "wrong" }, 1000);
  eq([m.state.scores.team1, m.state.clue.stage], [-200, "open"], "…and rebounds once he's taken the points");
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
  st = buzz(st, P2);
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

// --- Daily Double: anyone on the team enters the wager on their phone; twice the time ---
{
  const players = [P1, P2, P3].map((p) => ({ id: p.deviceId, name: p.name, team: p.team }));
  const raw = (st, name, params, dt = 0) => { const ch = E.ACTIONS[name](st.state, params, { now: (T += 10 + dt), questions: st.qs, players }); return ch && ch.error ? { ...st, error: ch.error } : { ...apply(st.state, st.qs, ch), error: null, noop: !ch }; };
  let st = fresh();
  st = run(st, "startGame", { control: "team2" });
  st = run(st, "pickClue", { qid: "a1" });
  st = run(st, "openBuzzers");
  st = buzz(st, P1);
  st = run(st, "judge", { result: "correct" });
  st = run(st, "closeClue");
  st = run(st, "pickClue", { qid: "a3" });
  eq([st.state.clue.dd.team, st.state.clue.dd.by], ["team1", null], "a Daily Double for the team that picks — nobody in particular has to wager");
  ok(!!raw(st, "lockDDWager", { team: "team2", wager: 100, by: { ...P2 } }).error, "the other team can't enter it");
  const cy = raw(st, "lockDDWager", { team: "team1", wager: 100, by: { ...P3 } });
  eq([cy.state.clue.stage, cy.state.clue.dd.wager, cy.state.clue.dd.by.name], ["answering", 100, "Cy"], "anyone on the team can lock the wager on their phone (Cy, not just Ann who answered last)");
  ok(raw(cy, "lockDDWager", { team: "team1", wager: 200, by: { ...P1 } }).noop, "the first one locked counts");
  ok(!run(st, "lockDDWager", { team: "team1", wager: 100 }).error, "Jaren can still enter it for them");
  const c = cy.state.clue;
  eq(E.answerMs(c, {}), 30000, "twice the answer time on a Daily Double (30 s instead of 15)");
  eq(E.answerMs({ dd: null }, { answerSeconds: 20 }), 20000, "normal questions keep the normal time");
  const k = E.lockKey(c);
  ok(raw(cy, "answerTimeout", { key: k }, 16000).noop, "not out of time after 16 s on a Daily Double");
  ok(!raw(cy, "answerTimeout", { key: k }, 15000).noop, "…out of time after 30 s");
}

// --- fixing scores up before Final Jeopardy ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "setScore", { team: "team1", value: 1000 });
  st = run(st, "finalStart");
  eq(st.state.final.eligible, { team1: true, team2: false }, "a team at $0 sits out Final");
  st = run(st, "finalWager", { team: "team1", amount: 800, by: "Ann" });
  st = run(st, "adjustScore", { team: "team2", delta: 400 });
  eq([st.state.scores.team2, st.state.final.eligible.team2], [400, true], "giving them points before the question puts them back in");
  st = run(st, "setScore", { team: "team1", value: 500 });
  eq(st.state.final.wagers.team1, undefined, "a wager that's now more than the team has is cleared, to be entered again");
  ok(!!run(st, "finalWager", { team: "team1", amount: 800, by: "Ann" }).error && !run(st, "finalWager", { team: "team1", amount: 500, by: "Ann" }).error, "…and the new limit applies");
}

// --- fair buzzing: scheduled open, fastest press wins ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "pickClue", { qid: "a1" });
  const before = T;
  st = run(st, "openBuzzers");
  const c = st.state.clue;
  ok(c.openedAt - before >= E.OPEN_LEAD_MS && c.openedAt - before <= E.OPEN_LEAD_MS + 20, "buzzers open a moment from now, so every phone lights up at the same instant");
  const br = c.buzzRound;
  const press = (me, ms) => ({ ...me, t: c.openedAt + ms });
  const claim = (cands, dt) => run(st, "claimBuzz", { buzzRound: br, candidates: cands }, dt);
  ok(claim([press(P1, 200)], 0).noop, "not decided until slower phones' presses have had time to arrive");
  // Bob's press reached the server first, but Ann pressed earlier: Ann wins.
  let r = claim([press(P2, 260), press(P1, 180), press(P3, 400)], 3000);
  eq(r.state.clue.locked.name, "Ann", "the fastest press wins, not the first message to arrive");
  eq(r.state.clue.locked.ms, 180, "…with her reaction time");
  eq(r.state.clue.order.map((o) => [o.name, o.ms]), [["Ann", 180], ["Bob", 260], ["Cy", 400]], "runners-up and their reaction times are kept");
  r = claim([press(P1, -200), press(P2, 300)], 3000);
  eq(r.state.clue.locked.name, "Bob", "a press before the buzzers opened doesn't count");
  r = claim([press(P1, 100), press(P1, 50), press(P2, 70)], 3000);
  eq([r.state.clue.locked.name, r.state.clue.order.length], ["Ann", 2], "each phone counts once (its earliest press)");
  ok(claim([], 3000).noop, "no presses, nothing to decide");
  ok(run(st, "claimBuzz", { buzzRound: br + 1, candidates: [press(P1, 100)] }, 3000).noop, "presses from an old round are ignored");
  // wrong answer → rebound for the other team, also opened a moment from now
  st = run(st, "setSettings", { patch: { autoRebound: true } });
  st = claim([press(P1, 120)], 3000);
  const t0 = T;
  st = run(st, "judge", { result: "wrong" });
  const c2 = st.state.clue;
  ok(c2.stage === "open" && c2.openedAt - t0 >= E.OPEN_LEAD_MS && c2.windowUntil === c2.openedAt + 30000, "the rebound opens a moment from now, with 30 s from when it opens");
  eq(c2.order, null, "the old buzz order is cleared");
  r = run(st, "claimBuzz", { buzzRound: c2.buzzRound, candidates: [{ ...P3, t: c2.openedAt + 50 }, { ...P2, t: c2.openedAt + 90 }] }, 3000);
  eq(r.state.clue.locked.name, "Bob", "the team that already answered can't buzz again");
  // the read-the-question timer opens the buzzers exactly when it runs out
  let a = fresh();
  a = run(a, "startGame", { control: "team1" });
  a = run(a, "setSettings", { patch: { readSeconds: 5 } });
  a = run(a, "pickClue", { qid: "a1" });
  const pickedAt = a.state.clue.pickedAt;
  ok(run(a, "autoOpen", { pickedAt }, 1000).noop, "not yet");
  a = run(a, "autoOpen", { pickedAt }, 4300 - 1000);
  eq([a.state.clue.stage, a.state.clue.openedAt], ["open", pickedAt + 5000], "scheduled just before the timer ends, opening right when it hits zero");
}

// --- the night's awards: who answered, how fast, mini-game wins; Undo takes them back ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  const play = (st, qid, me, ms, result) => {
    st = run(st, "pickClue", { qid });
    st = run(st, "openBuzzers");
    st = buzz(st, me, ms);
    st = run(st, "judge", { result });
    return run(st, "closeClue");
  };
  st = run(st, "setSettings", { patch: { autoRebound: false } });
  st = play(st, "a1", P1, 180, "correct");       // Ann +100, 0.18s
  st = play(st, "a2", P2, 90, "wrong");          // Bob −200, 0.09s
  let stats = E.playerStats(st.state);
  eq([stats.p1.right, stats.p1.earned, stats.p1.fast], [1, 100, 180], "a right answer counts for the player who buzzed, with their reaction time");
  eq([stats.p2.right, stats.p2.wrong, stats.p2.fast], [0, 1, 90], "a wrong one counts too (and the buzz still counts for speed)");
  let aw = E.nightAwards(st.state);
  const byId = (id) => aw.find((a) => a.id === id);
  eq(byId("brain").winners.map((w) => w.name), ["Ann"], "Head Elf: most right answers");
  eq([byId("fast").winners[0].name, byId("fast").detail], ["Bob", "0.09s buzz"], "Fastest Reindeer: the quickest winning buzz");
  ok(!byId("earn"), "no Christmas Bonus when it's just the Head Elf again");
  eq([byId("bold").icon, byId("bold").winners.map((w) => w.name), byId("bold").detail], ["🪨", ["Bob"], "1 wrong"], "Naughty List: a lump of coal for the most wrong answers");
  ok(!byId("minis") && !byId("art"), "no mini-game awards without mini games");
  // Undo takes the stat back with the points
  const un = run(st, "undo");
  eq(E.playerStats(un.state).p2, undefined, "Undo takes the player's result back with the points");
  // a Daily Double is the team's: it doesn't count for one player
  let d = run(st, "pickClue", { qid: "a3" });
  d = run(d, "lockDDWager", { team: d.state.clue.dd.team, wager: 100 });
  d = run(d, "judge", { result: "correct" });
  eq(Object.values(E.playerStats(d.state)).reduce((n, r) => n + r.earned, 0), 100, "Daily Double winnings aren't credited to one player");
  // missed: who just got it wrong is on the clue (for the phones)
  let m = fresh();
  m = run(m, "startGame", { control: "team1" });
  m = run(m, "setSettings", { patch: { autoRebound: true } });
  m = run(m, "pickClue", { qid: "a1" });
  m = run(m, "openBuzzers");
  m = buzz(m, P1);
  m = run(m, "judge", { result: "wrong" });
  eq([m.state.clue.stage, m.state.clue.missed && m.state.clue.missed.name, m.state.clue.missed && m.state.clue.missed.why], ["open", "Ann", "wrong"], "the rebound knows who just missed");
  // award rules on a made-up night
  const H = (pid, who, team, delta, ms, why) => ({ kind: "clue", pid, who, team, delta, ms, why: why || (delta > 0 ? "correct" : "wrong") });
  const night = { history: [H("a", "Al", "team1", 100, 300), H("a", "Al", "team1", 100, 250), H("b", "Bea", "team2", 500, 210),
    H("c", "Cat", "team2", -200, 400), H("c", "Cat", "team2", -300, 500, "time"), H("d", "Dot", "team1", -100, 900)] };
  aw = E.nightAwards(night);
  eq(aw.map((a) => [a.id, a.winners.map((x) => x.name).join("&"), a.detail]),
    [["brain", "Al", "2 right answers"], ["fast", "Bea", "0.21s buzz"], ["earn", "Bea", "won $500"], ["bold", "Cat", "1 wrong · 1 unanswered"]],
    "Head Elf, Fastest Reindeer, Christmas Bonus (someone else) and Naughty List");
  const crowd = { history: ["a", "b", "c", "d"].map((p) => H(p, p, "team1", 100, 300)) };
  ok(!E.nightAwards(crowd).some((a) => a.id === "brain" || a.id === "fast"), "no award when more than 3 people tie for it");
  // mini games: head-to-head wins, best overall, drawing
  let g = fresh();
  g = run(g, "miniAdd", { game: { name: "Toss", type: "h2h", points: 100 } });
  const gid = g.state.minis.list[0].id;
  const players = [{ id: "p1", name: "Ann", team: "team1" }, { id: "p2", name: "Bob", team: "team2" }, { id: "p3", name: "Cy", team: "team1" }];
  const run2 = (st, name, params = {}) => { const ch = E.ACTIONS[name](st.state, params, { now: (T += 50), questions: st.qs, players, rand: () => 0.1 }); return ch && !ch.error ? apply(st.state, st.qs, ch) : st; };
  g = run2(g, "minisStart");
  g = run2(g, "miniPlay", { id: gid });
  g = run2(g, "miniNext", { id: gid });
  const m1 = g.state.minis.list[0].matches[0];
  g = run2(g, "miniMatch", { id: gid, winner: "team2" });
  g = run2(g, "miniNext", { id: gid });
  g = run2(g, "miniMatch", { id: gid, winner: "team2" });
  stats = E.playerStats(g.state);
  eq(stats.p2.minis, 2, `head-to-head wins count for the winner (${m1.p2 && m1.p2.name})`);
  aw = E.nightAwards(g.state);
  eq(aw.find((a) => a.id === "minis").winners.map((x) => x.name), ["Bob"], "North Pole Champ: most mini-game wins");
}

// --- backing out of a question picked by mistake ---
{
  let st = fresh();
  st = run(st, "startGame", { control: "team1" });
  st = run(st, "pickClue", { qid: "a1" });
  const k1 = E.lockKey(st.state.clue);
  st = run(st, "openBuzzers");
  ok(E.canUnpick(st.state.clue), "can back out after the buzzers are open");
  let b = run(st, "unpickClue");
  eq([b.state.phase, b.state.clue, b.qs.find((q) => q.id === "a1").used], ["board", null, false], "…the question goes back on the board");
  b = run(b, "pickClue", { qid: "a1" });
  ok(E.lockKey(b.state.clue) !== k1, "picked again, it starts fresh (old buzzes don't count)");
  let a = buzz(st, P1);
  ok(!run(a, "unpickClue").noop, "can back out while someone is answering (no points changed yet)");
  a = run(a, "setSettings", { patch: { autoRebound: true } });
  a = run(a, "judge", { result: "wrong" });
  ok(run(a, "unpickClue").noop, "…but not once it has changed a score");
  let d = run(fresh(), "startGame", { control: "team1" });
  d = run(d, "pickClue", { qid: "a3" });
  ok(!run(d, "unpickClue").noop, "a Daily Double can be put back too");
}

// --- Jaren takes away a wrong multiple-choice option, down to the last two ---
{
  const four = { id: "m4", category: "Movies", points: 400, type: "mcq", choices: ["A", "B", "C", "D"], correctIndex: 2, round: 1 };
  const start = () => { let st = fresh(); st.qs.push({ ...four }); st = run(st, "startGame", { control: "team1" }); return run(st, "pickClue", { qid: "m4" }); };
  let st = start();
  eq(E.mcqLeft(st.state.clue, four), 4, "four options to start");
  st = run(st, "dropChoice");
  eq([E.mcqLeft(st.state.clue, four), st.state.clue.eliminated.length], [3, 1], "one wrong option is taken away");
  st = run(st, "dropChoice");
  eq(E.mcqLeft(st.state.clue, four), 2, "…and again, down to two");
  ok(!st.state.clue.eliminated.includes(four.correctIndex), "never the right answer");
  ok(run(st, "dropChoice").noop, "it stops at two — the right answer and one wrong one");
  // the crossed-off ones can't be picked, the two left can
  st = run(st, "openBuzzers");
  st = buzz(st, P1);
  ok(run(st, "mcqPick", { index: st.state.clue.eliminated[0], me: P1 }).noop, "a crossed-off option can't be tapped");
  const other = [0, 1, 3].find((i) => !st.state.clue.eliminated.includes(i));
  eq(run(st, "mcqPick", { index: other, me: P1 }).state.scores.team1, -400, "the wrong one that's left still scores wrong");
  eq(run(st, "mcqPick", { index: four.correctIndex, me: P1 }).state.scores.team1, 400, "…and the right answer still scores right");
  // which one goes is random
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(run(start(), "dropChoice").state.clue.eliminated[0]);
  eq([...seen].sort(), [0, 1, 3], "the one taken away is picked at random from the wrong answers");
  // a 3-option question stops after one; 2 options can't be cut at all
  let three = fresh();
  three = run(three, "startGame", { control: "team1" });
  three = run(three, "pickClue", { qid: "a2" }); // 3 choices
  three = run(three, "dropChoice");
  eq(E.mcqLeft(three.state.clue, three.qs.find((q) => q.id === "a2")), 2, "a 3-option question goes down to two");
  ok(run(three, "dropChoice").noop, "…and no further");
  let two = fresh();
  two = run(two, "startGame", { control: "team1" });
  two = run(two, "pickClue", { qid: "a4" }); // Daily Double, 2 choices
  ok(run(two, "dropChoice").noop, "a 2-option question has nothing to take away");
  // normal questions, and once the question is over
  let sp = fresh();
  sp = run(sp, "startGame", { control: "team1" });
  sp = run(sp, "pickClue", { qid: "a1" });
  ok(run(sp, "dropChoice").noop, "nothing to take away on a normal typed-answer question");
  let dd = start();
  dd = run(dd, "openBuzzers");
  dd = buzz(dd, P1);
  ok(!run(dd, "dropChoice").noop, "it works while someone is answering, too");
  dd = run(dd, "judge", { result: "skip" });
  ok(!run(dd, "dropChoice").noop, "…and on the rebound, for the other team");
  dd = buzz(dd, P2);
  dd = run(dd, "judge", { result: "correct" });
  eq(dd.state.clue.stage, "done", "question finished");
  ok(run(dd, "dropChoice").noop, "…but not once the question is over");
}

// --- couples: 1a plays 1b, and they're summoned to the table together ---
{
  // Three couples, plus one husband who came on his own.
  const people = [
    { id: "h1", name: "Jaren E.", team: "team1", pair: 1 }, { id: "w1", name: "Liz E.", team: "team2", pair: 1 },
    { id: "h2", name: "Mike S.", team: "team1", pair: 2 }, { id: "w2", name: "Ann S.", team: "team2", pair: 2 },
    { id: "h3", name: "Tom R.", team: "team1", pair: 3 }, { id: "w3", name: "Kay R.", team: "team2", pair: 3 },
    { id: "h4", name: "Solo Sam", team: "team1" },
  ];
  eq([E.pairTag(people[0]), E.pairTag(people[1]), E.pairTag(people[6])], ["1a", "1b", ""], "the husband is 1a, his wife 1b, and an unpaired player has no tag");
  eq(E.partnerOf(people, "h2").id, "w2", "2a's partner is 2b");
  eq(E.partnerOf(people, "w3").id, "h3", "…and the other way round");
  eq(E.partnerOf(people, "h4"), null, "someone without a number has no partner");

  const couples6 = people.filter((p) => p.pair);
  let st = { state: E.defaultState(), qs: [] };
  const go = (name, params = {}, players = couples6) => {
    const ch = E.ACTIONS[name](st.state, params, { now: (T += 50), questions: [], players });
    if (ch && !ch.error) st = apply(st.state, st.qs, ch);
    return ch;
  };
  go("miniAdd", { game: { name: "Snowball Toss", type: "h2h", points: 500 } });
  const gid = st.state.minis.list[0].id;
  go("miniPlay", { id: gid });
  const couples = new Set();
  for (let i = 0; i < 6; i++) {
    go("miniNext", { id: gid });
    const m = st.state.minis.list[0].matches[i];
    const a = people.find((x) => x.id === m.p1.id), b = people.find((x) => x.id === m.p2.id);
    couples.add(`${a.name} vs ${b.name}`);
    ok(a.pair === b.pair, `couple ${i + 1} faces each other: ${a.name} vs ${b.name}`);
    go("miniMatch", { id: gid, winner: "team1" });
  }
  ok(couples.size === 3, "every couple gets a turn before anyone repeats");

  // Re-drawing one side brings their partner along.
  go("miniNext", { id: gid });
  let open = E.openMatch(st.state.minis.list[0]);
  const was = open.p1.id;
  go("miniRepick", { id: gid, team: "team1", matchId: open.id });
  open = E.openMatch(st.state.minis.list[0]);
  const hus = people.find((x) => x.id === open.p1.id), wif = people.find((x) => x.id === open.p2.id);
  ok(open.p1.id !== was && hus.pair === wif.pair, `🎲 re-drawing the husband brings his wife along (${hus.name} vs ${wif.name})`);

  // Two tables at once: two different couples, nobody drawn twice.
  go("miniUpdate", { id: gid, patch: { tables: 2 } });
  go("miniReset", { id: gid });
  go("miniPlay", { id: gid });
  go("miniNext", { id: gid });
  const two = st.state.minis.list[0].matches;
  eq(two.length, 2, "both tables are filled in one draw");
  ok(two.every((m) => people.find((x) => x.id === m.p1.id).pair === people.find((x) => x.id === m.p2.id).pair), "each table gets a couple");
  ok(two[0].p1.id !== two[1].p1.id && two[0].p2.id !== two[1].p2.id, "…and nobody plays at two tables at once");
  ok(two.every((m) => m.table && m.summon != null), "each table gets its own Christmas summons for the pair");

  // The odd one out still gets a game — against whoever is free.
  go("miniReset", { id: gid });
  go("miniPlay", { id: gid });
  const drawn = new Set();
  for (let i = 0; i < 4; i++) {
    go("miniNext", { id: gid }, people);
    const m = E.openMatch(st.state.minis.list[0]);
    drawn.add(m.p1.id);
    go("miniMatch", { id: gid, winner: "team1" }, people);
  }
  ok(drawn.has("h4"), "a husband who came on his own is still drawn (against whoever is free)");

  // Switched off, it's a free-for-all again.
  go("setSettings", { patch: { pairUp: false } });
  go("miniReset", { id: gid });
  go("miniUpdate", { id: gid, patch: { tables: 1 } });
  go("miniPlay", { id: gid });
  let mixed = 0;
  for (let i = 0; i < 7; i++) {
    go("miniNext", { id: gid }, people);
    const m = E.openMatch(st.state.minis.list[0]);
    const a = people.find((x) => x.id === m.p1.id), b = people.find((x) => x.id === m.p2.id);
    if (a.pair !== b.pair) mixed++;
    go("miniMatch", { id: gid, winner: "team2" }, people);
  }
  ok(mixed > 0, "with couples switched off the draw is random again");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
