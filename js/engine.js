// Pure Jeopardy game rules.
//
// Every action is `(state, params, ctx) => change | null`, where
//   ctx    = { now, questions, deviceId }   (now = synced server-clock ms)
//   change = { set: { topLevelField: value, ... }, questions: [{ id, data }], error }
// Actions never mutate `state`. The data layer runs them inside a Firestore transaction,
// so concurrent devices can't double-apply anything (e.g. 50 phones buzzing at once).

import { SUMMONS } from "./summons.js";

export const TEAMS = ["team1", "team2"];
export const otherTeam = (t) => (t === "team1" ? "team2" : "team1");

export const DEFAULT_SETTINGS = {
  answerSeconds: 15,      // time the buzzed-in player has to answer
  ddSeconds: 30,          // Daily Double: the team gets this long (longer — it's their wager)
  buzzWindowSeconds: 0,   // 0 = buzzers stay open until someone buzzes
  reboundSeconds: 30,     // after a miss, the other team gets this long to buzz in
  readSeconds: 0,         // 0 = host opens buzzers manually; >0 = auto-open after reading time
  finalSeconds: 62,       // Final Jeopardy think time (the think music, played twice)
  autoRebound: true,      // after a miss, instantly reopen buzzers for the other team
  finalNeedsPositive: true, // official rule: only teams with $1+ play Final Jeopardy
  playersRename: true,    // players may rename their own team before Jeopardy starts
  pairUp: true,           // mini games: couples (1a / 1b in Settings → Players) face each other
  announce: true,         // mini games: read "who's up next" out loud on the screen with sound on
  awardsOff: [],          // North Pole Awards the host has switched off
  awardPrize: [],         // …and the ones whose winner gets a 🎟 scratch-it
};

export const DEFAULT_NAMES = { team1: "Husbands", team2: "Wives" };

export const LIMITS = {
  answerSeconds: [3, 120], ddSeconds: [5, 180], buzzWindowSeconds: [0, 120], reboundSeconds: [5, 120], readSeconds: [0, 30], finalSeconds: [10, 300],
};

const rid = () => Math.random().toString(36).slice(2, 10);

export function freshFinal() {
  return {
    stage: "off", // off | wager | clue | reveal | done
    eligible: { team1: true, team2: true },
    wagers: { team1: null, team2: null },   // { amount, by, at }
    answers: { team1: null, team2: null },  // { text, by, at }
    deadline: null,
    order: ["team1", "team2"],
    results: { team1: null, team2: null },  // 'correct' | 'wrong'
    shown: { team1: { answer: false, wager: false }, team2: { answer: false, wager: false } },
  };
}

export function defaultState(keep = {}) {
  return {
    v: 2,
    gameId: rid(),
    phase: "lobby", // lobby | board | clue | final | over
    round: 1,
    control: null, // team that picks the next clue
    teamNames: keep.teamNames || { ...DEFAULT_NAMES },
    scores: { team1: 0, team2: 0 },
    settings: { ...DEFAULT_SETTINGS, ...(keep.settings || {}) },
    clue: null,
    final: freshFinal(),
    minis: freshMinis(),
    vote: freshVote(),
    loaded: null, // which question set from the library is on the board: { id, name, at }
    jStarted: false, // Jeopardy has been started at least once (so "Start" means resume)
    history: [],
    sfx: null,
  };
}

// Bring an older saved game up to date without losing it.
export function migrate(old) {
  if (!old || typeof old !== "object" || old.v !== 2) {
    const names = old && old.teamNames ? modernNames(old.teamNames) : null;
    return { full: defaultState(names ? { teamNames: names } : {}) };
  }
  const patch = {};
  if (!old.minis) patch.minis = freshMinis();
  // Blind drawing used to be its own kind of game; it's a Best overall game now.
  const stale = ((old.minis && old.minis.list) || []).filter((g) => g.mode === "draw" && g.type !== "best" && !(g.matches || []).length && !(g.entries || []).length);
  if (stale.length) patch.minis = { ...old.minis, list: old.minis.list.map((g) => (stale.includes(g) ? { ...g, type: "best", better: "high", unit: "% match" } : g)) };
  if (old.jStarted === undefined) patch.jStarted = !["lobby", "minis"].includes(old.phase);
  const names = modernNames(old.teamNames || {});
  if (JSON.stringify(names) !== JSON.stringify(old.teamNames || {})) patch.teamNames = names;
  if (!old.settings || old.settings.playersRename === undefined) patch.settings = { ...DEFAULT_SETTINGS, ...(old.settings || {}) };
  // Final Jeopardy used to be one play of the song (30 s, then 31 s); it's two now.
  if (old.settings && [30, 31].includes(old.settings.finalSeconds)) patch.settings = { ...(patch.settings || old.settings), finalSeconds: 62, finalSong: true };
  return Object.keys(patch).length ? { patch } : null;
}
function modernNames(n) {
  return {
    team1: !n.team1 || n.team1 === "Team 1" ? DEFAULT_NAMES.team1 : n.team1,
    team2: !n.team2 || n.team2 === "Team 2" ? DEFAULT_NAMES.team2 : n.team2,
  };
}

// ---------- question helpers (also used by the UI) ----------
export const roundOf = (q) => (q && q.round === 2 ? 2 : 1);
export const boardClues = (questions, round) =>
  (questions || []).filter((q) => !q.isFinal && roundOf(q) === round);
export const finalClue = (questions) => (questions || []).find((q) => q.isFinal) || null;
// Double Jeopardy has been removed: the game is one round + Final Jeopardy.
export const hasRound2 = () => false;
export const r2On = () => false;
export const roundMaxValue = (questions, round) =>
  boardClues(questions, round).reduce((m, q) => Math.max(m, Number(q.points) || 0), 0);
export const cluesLeft = (questions, round) => boardClues(questions, round).filter((q) => !q.used).length;
// (pickedAt is in it so a question that was put back and picked again starts fresh.)
export const lockKey = (clue) => (clue ? `${clue.id}:${clue.pickedAt || 0}:${clue.buzzRound}` : "");

export function ddLimits(state, questions, team) {
  const score = (state.scores && state.scores[team]) || 0;
  // Up to everything the team has. At $0 or below, they can wager up to the board's top
  // value instead (that's how the show handles a broke player).
  const max = score > 0 ? score : roundMaxValue(questions, state.round) || 500;
  return { min: Math.min(5, max), max };
}
export function finalMax(state, team) {
  return Math.max(0, (state.scores && state.scores[team]) || 0);
}
export const teamName = (state, t) => (state && state.teamNames && state.teamNames[t]) || DEFAULT_NAMES[t] || "";

// ---------- change-set builder ----------
function builder(state, ctx) {
  const set = {};
  const questions = [];
  let scores = null;
  let history = null;
  const group = rid();
  const api = {
    set,
    questions,
    field(k, v) { set[k] = v; return api; },
    q(id, data) { questions.push({ id, data }); return api; },
    sfx(sound) { set.sfx = { sound, at: ctx.now, id: rid() }; return api; },
    score(team, delta, why, meta = {}) {
      if (!delta) return api;
      scores = scores || { ...state.scores };
      history = history || [...(state.history || [])];
      scores[team] = (scores[team] || 0) + delta;
      history.push({ id: rid(), g: group, team, delta, why, at: ctx.now, ...meta });
      // Keep the last 200. Question results go last: the night's awards are worked out from them.
      while (history.length > 200) {
        const i = history.findIndex((h) => h.kind !== "clue");
        history.splice(i >= 0 && i < history.length - 1 ? i : 0, 1);
      }
      set.scores = scores;
      set.history = history;
      return api;
    },
    done() { return { set, questions }; },
  };
  return api;
}
const fail = (error) => ({ error });
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
const findQ = (ctx, id) => (ctx.questions || []).find((q) => q.id === id) || null;

// =================================================================
// Game flow
// =================================================================
export function startGame(s, { control } = {}, ctx) {
  if (!["lobby", "minis"].includes(s.phase)) return null;
  if (!boardClues(ctx.questions, 1).length) return fail("Load your questions first (⚙ Settings → Questions).");
  const minis = { ...minisOf(s), current: null, back: null };
  // Already started earlier and the host stepped away: carry on where they left off.
  if (s.jStarted) return builder(s, ctx).field("phase", "board").field("clue", null).field("minis", minis).sfx("intro").done();
  const ctrl = control === "random" ? TEAMS[Math.floor(Math.random() * 2)] : TEAMS.includes(control) ? control : null;
  return builder(s, ctx)
    .field("phase", "board").field("round", 1).field("control", ctrl).field("jStarted", true)
    .field("clue", null).field("final", freshFinal())
    .field("minis", minis)
    .sfx("intro").done();
}

// Step away from the Jeopardy board (back to the lobby or the mini games) without losing
// anything: scores, used clues, round and whose turn it is all stay for when you resume.
export function leaveJeopardy(s, { to } = {}, ctx) {
  if (s.phase === "clue") return fail("Finish or close the current question first.");
  if (s.phase !== "board") return null;
  const phase = to === "minis" ? "minis" : "lobby";
  return builder(s, ctx).field("phase", phase).field("minis", { ...minisOf(s), current: null, back: null }).done();
}
// From the mini-games list back to the lobby (or to Jeopardy if it was paused for a mini game).
export function leaveMinis(s, _p, ctx) {
  const M = minisOf(s);
  if (s.phase !== "minis") return null;
  const phase = M.back === "board" ? "board" : "lobby";
  return builder(s, ctx).field("phase", phase).field("minis", { ...M, current: null, back: null }).done();
}

export function setControl(s, { team }, ctx) {
  if (!TEAMS.includes(team)) return null;
  return builder(s, ctx).field("control", team).done();
}
// How long the person who buzzed in has to answer — twice as long on a Daily Double.
export const answerMs = (c, settings) =>
  (c && c.dd ? (settings && settings.ddSeconds) || 30 : (settings && settings.answerSeconds) || 15) * 1000;

export function startRound2(s, _p, ctx) {
  if (!r2On(s, ctx.questions)) return fail("This game doesn't have a Double Jeopardy round.");
  const sc = s.scores || {};
  // Official rule: the player in last place picks first in Double Jeopardy.
  const ctrl = sc.team1 === sc.team2 ? s.control : sc.team1 < sc.team2 ? "team1" : "team2";
  return builder(s, ctx)
    .field("phase", "board").field("round", 2).field("control", ctrl).field("clue", null)
    .sfx("intro").done();
}

// ---------- clues ----------
function newClue(q, s, ctx) {
  return {
    id: q.id,
    stage: q.dailyDouble ? "dd" : "reading", // dd | reading | open | paused | answering | done
    pickedAt: ctx.now,
    dd: q.dailyDouble ? { team: s.control || null, wager: null, by: null } : null,
    buzzRound: 0,
    openedAt: null,
    locked: null,       // { deviceId, name, team, at }
    blocked: [],        // teams that already missed this clue
    eliminated: [],     // wrong multiple-choice options already picked, or taken away by Jaren
    mcq: null,          // { index, correct, by }
    timeUp: null,       // lockKey whose answer timer ran out (spoken answers)
    result: null,       // correct | wrong | nobody | skipped
    winner: null,
    revealed: false,
    pun: null,
  };
}

export function pickClue(s, { qid }, ctx) {
  if (s.phase !== "board" || s.clue) return null;
  const q = findQ(ctx, qid);
  if (!q || q.used || q.isFinal || roundOf(q) !== s.round) return null;
  const b = builder(s, ctx).field("phase", "clue").field("clue", newClue(q, s, ctx)).q(qid, { used: true });
  if (q.dailyDouble) b.sfx("dd");
  return b.done();
}

// Picked the wrong one: put it back on the board — any time before it has changed a score
// (while it's read, on the Daily Double screen, with the buzzers open, even mid-answer).
export const canUnpick = (c) => !!c && c.stage !== "done" && !(c.blocked || []).length;
export function unpickClue(s, _p, ctx) {
  const c = s.clue;
  if (!canUnpick(c)) return null;
  return builder(s, ctx).field("phase", "board").field("clue", null).q(c.id, { used: false }).done();
}

export function setDDTeam(s, { team }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "dd" || !TEAMS.includes(team)) return null;
  return builder(s, ctx).field("clue", { ...c, dd: { ...c.dd, team } }).done();
}

// by: whoever on the team entered it on their phone — anyone on the team can, and the
// first one locked counts (Jaren can always enter it for them).
export function lockDDWager(s, { team, wager, by }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "dd") return null;
  if (!TEAMS.includes(team)) return fail("Choose which team found the Daily Double.");
  if (by) {
    if (by.team !== team || c.dd.team !== team) return fail("It's the other team's Daily Double.");
  }
  const { min, max } = ddLimits(s, ctx.questions, team);
  const w = Math.round(Number(wager));
  if (!Number.isFinite(w) || w < min || w > max) return fail(`Daily Double wager must be between $${min} and $${max}.`);
  return builder(s, ctx)
    .field("control", team)
    .field("clue", {
      ...c, stage: "answering", dd: { team, wager: w, by: by ? { deviceId: by.deviceId, name: String(by.name || "").slice(0, 32), team } : null },
      locked: { deviceId: "dd", name: teamName(s, team), team, at: ctx.now },
    }).done();
}

const reboundMs = (s) => ((s.settings && s.settings.reboundSeconds) || 30) * 1000;
// Fair buzzing: the buzzers open at a set moment a little in the future, so every phone
// knows about it in time and lights up at the same instant (by the shared clock). Each
// press is stamped with that clock; the fastest press wins — not the first message to
// reach the server. After the first press, we wait BUZZ_GRACE_MS for slower phones'
// presses to arrive before deciding.
export const OPEN_LEAD_MS = 700;
export const BUZZ_GRACE_MS = 600;
// When the open buzzers close by themselves: a rebound always has a time limit; the first
// open only if a buzz-in window is set.
export function buzzDeadline(c, settings) {
  if (!c || c.stage !== "open") return null;
  if (c.windowUntil) return c.windowUntil;
  const secs = (settings && settings.buzzWindowSeconds) || 0;
  return secs > 0 ? c.openedAt + secs * 1000 : null;
}
// at: when to open (the read-the-question timer); otherwise OPEN_LEAD_MS from now.
export function openBuzzers(s, { at } = {}, ctx) {
  const c = s.clue;
  if (!c || !["reading", "paused"].includes(c.stage)) return null;
  if (TEAMS.every((t) => c.blocked.includes(t))) return null;
  const openAt = Math.max(ctx.now + 300, Number(at) || ctx.now + OPEN_LEAD_MS);
  return builder(s, ctx).field("clue", {
    ...c, stage: "open", buzzRound: c.buzzRound + 1, openedAt: openAt, locked: null, order: null, mcq: null, timeUp: null,
    windowUntil: c.blocked.length ? openAt + reboundMs(s) : null,
  }).done();
}

// The read-the-question timer: scheduled just before it runs out, so the buzzers open
// exactly when it hits zero.
export function autoOpen(s, { pickedAt }, ctx) {
  const c = s.clue;
  const secs = (s.settings && s.settings.readSeconds) || 0;
  if (!c || c.stage !== "reading" || c.pickedAt !== pickedAt || secs <= 0) return null;
  const at = c.pickedAt + secs * 1000;
  if (ctx.now < at - OPEN_LEAD_MS - 100) return null;
  return openBuzzers(s, { at }, ctx);
}

export function pauseBuzzers(s, _p, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "open") return null;
  return builder(s, ctx).field("clue", { ...c, stage: "paused" }).done();
}

// Decide who buzzed first. candidates: the presses seen so far ({ deviceId, name, team,
// t = press time by the shared clock }). The earliest press wins; it can only be decided
// once BUZZ_GRACE_MS has passed since that press (slower phones' presses may still be on
// their way). Also returns the runners-up with their reaction times.
export function claimBuzz(s, { buzzRound, candidates, pun }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "open" || c.buzzRound !== buzzRound) return null;
  const presses = (Array.isArray(candidates) ? candidates : [])
    .filter((b) => b && b.deviceId && TEAMS.includes(b.team) && !c.blocked.includes(b.team) && Number.isFinite(b.t) && b.t >= c.openedAt - 30)
    .sort((a, b) => a.t - b.t || (a.seq || 0) - (b.seq || 0));
  if (!presses.length) return null;
  const w = presses[0];
  if (ctx.now < w.t + BUZZ_GRACE_MS - 50) return null; // too soon to be sure
  const seen = new Set();
  const order = [];
  for (const b of presses) {
    if (seen.has(b.deviceId)) continue;
    seen.add(b.deviceId);
    order.push({ name: String(b.name || "").slice(0, 32), team: b.team, ms: Math.max(0, Math.round(b.t - c.openedAt)) });
    if (order.length >= 5) break;
  }
  return builder(s, ctx).field("clue", {
    ...c, stage: "answering",
    locked: { deviceId: w.deviceId, name: String(w.name || "").slice(0, 32), team: w.team, at: ctx.now, ms: order[0].ms },
    order, pun: pun || null, timeUp: null, mcq: null,
  }).sfx("buzz").done();
}

// Shared resolution for correct / wrong / skip / timeout.
function resolve(s, outcome, ctx, extra = {}) {
  const c = s.clue;
  const q = findQ(ctx, c.id);
  const team = c.locked.team;
  const value = c.dd ? c.dd.wager : (q ? Number(q.points) || 0 : 0);
  const b = builder(s, ctx);
  const base = { ...c, ...extra };
  // Who answered (a Daily Double is the whole team's) — for the night's awards.
  const who = !c.dd && c.locked.deviceId ? { pid: c.locked.deviceId, who: c.locked.name || "", ms: Number.isFinite(c.locked.ms) ? c.locked.ms : null } : {};

  if (outcome === "correct") {
    b.score(team, value, "correct", { kind: "clue", prevControl: s.control || null, qid: c.id, ...who });
    b.field("control", team);
    b.field("clue", { ...base, stage: "done", result: "correct", winner: team, revealed: true });
    return b.sfx("correct").done();
  }
  if (outcome === "wrong" || outcome === "timeout") {
    b.score(team, -value, outcome === "timeout" ? "time" : "wrong", { kind: "clue", qid: c.id, ...who });
    // The time's-up bell has already rung for a late answer — no second buzz.
    if (outcome !== "timeout") b.sfx("wrong");
  }
  // Phones show who just missed (the answer box is gone by then).
  if ((outcome === "wrong" || outcome === "timeout") && !c.dd) base.missed = { deviceId: c.locked.deviceId || null, name: c.locked.name || "", team, why: outcome };
  if (outcome === "skip") base.missed = null;
  if (c.dd) {
    b.field("control", c.dd.team);
    b.field("clue", { ...base, stage: "done", result: outcome === "skip" ? "skipped" : "wrong", revealed: true });
    return b.done();
  }
  const blocked = Array.from(new Set([...c.blocked, team]));
  const remaining = TEAMS.filter((t) => !blocked.includes(t));
  if (!remaining.length) {
    b.field("clue", { ...base, stage: "done", result: "nobody", blocked, locked: null, revealed: true });
  } else if (s.settings && s.settings.autoRebound) {
    const openAt = ctx.now + OPEN_LEAD_MS;
    b.field("clue", { ...base, stage: "open", blocked, locked: null, order: null, buzzRound: c.buzzRound + 1, openedAt: openAt, timeUp: null, mcq: null, submitted: null, windowUntil: openAt + reboundMs(s) });
  } else {
    b.field("clue", { ...base, stage: "paused", blocked, locked: null, timeUp: null, mcq: null });
  }
  return b.done();
}

// Jaren's verdict. After the time's-up bell a "wrong" is really "ran out of time", so
// that's how it's recorded (it counts as unanswered in the night's awards).
export function judge(s, { result }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked) return null;
  if (!["correct", "wrong", "skip"].includes(result)) return null;
  return resolve(s, result === "wrong" && isLate(c) ? "timeout" : result, ctx);
}
// The answer clock has run out on this buzz-in and Jaren hasn't decided yet.
export const isLate = (c) => !!c && c.stage === "answering" && !!c.locked && c.timeUp === lockKey(c);

// Multiple choice: how many options are still standing (crossed-off ones don't count).
export function mcqLeft(clue, q) {
  if (!clue || !q || q.type !== "mcq" || !Array.isArray(q.choices)) return 0;
  return q.choices.filter((ch, i) => ch && !(clue.eliminated || []).includes(i)).length;
}
// Jaren takes away one wrong option at random, to give everyone a better chance. Can be
// used again and again, down to the last two options (never the right answer).
export function dropChoice(s, _p, ctx) {
  const c = s.clue;
  if (!c || c.stage === "done" || c.stage === "dd") return null;
  const q = findQ(ctx, c.id);
  if (!q || q.type !== "mcq" || mcqLeft(c, q) <= 2) return null;
  const wrong = q.choices.map((_, i) => i).filter((i) => q.choices[i] && i !== q.correctIndex && !c.eliminated.includes(i));
  if (!wrong.length) return null;
  const gone = wrong[Math.floor(random(ctx) * wrong.length)];
  return builder(s, ctx).field("clue", { ...c, eliminated: [...c.eliminated, gone] }).done();
}

export function mcqPick(s, { index, me }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked || !me) return null;
  const q = findQ(ctx, c.id);
  if (!q || q.type !== "mcq") return null;
  const allowed = c.dd ? me.team === c.dd.team : c.locked.deviceId === me.deviceId;
  if (!allowed || c.eliminated.includes(index) || isLate(c)) return null;
  const correct = index === q.correctIndex;
  const mcq = { index, correct, by: me.name };
  if (correct) return resolve(s, "correct", ctx, { mcq });
  return resolve(s, "wrong", ctx, { mcq, eliminated: [...c.eliminated, index] });
}

// A typed answer came in: stop the answer clock and wait for the host to judge.
export function answerSubmitted(s, { key }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked || lockKey(c) !== key) return fail("Too late — the answer is closed.");
  if (c.timeUp === key) return fail("⏰ Out of time — answers are closed.");
  if (c.submitted === key) return null;
  return builder(s, ctx).field("clue", { ...c, submitted: key }).done();
}

export function answerTimeout(s, { key }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked || lockKey(c) !== key || c.timeUp === key || c.submitted === key) return null;
  if (ctx.now < c.locked.at + answerMs(c, s.settings) - 60) return null;
  // The bell rings, but nothing is decided: no points come off until Jaren says so. He
  // can forgive a late answer (full points) or rule they missed it (points off, and the
  // other team gets a chance to steal) — either way the bell doesn't ring twice.
  return builder(s, ctx).field("clue", { ...c, timeUp: key }).sfx("timesup").done();
}

// Nobody buzzed in time: show the answer. No points lost.
export function buzzWindowTimeout(s, { key }, ctx) {
  const c = s.clue;
  const until = buzzDeadline(c, s.settings);
  if (!c || c.stage !== "open" || lockKey(c) !== key || !until) return null;
  if (ctx.now < until - 60) return null;
  return builder(s, ctx).field("clue", { ...c, stage: "done", result: "nobody", locked: null, revealed: true }).sfx("timesup").done();
}

export function nobody(s, _p, ctx) {
  const c = s.clue;
  if (!c || c.stage === "done") return null;
  return builder(s, ctx).field("clue", { ...c, stage: "done", result: c.dd ? "skipped" : "nobody", locked: null, revealed: true }).done();
}

export function revealAnswer(s, _p, ctx) {
  if (!s.clue || s.clue.revealed) return null;
  return builder(s, ctx).field("clue", { ...s.clue, revealed: true }).done();
}

export function closeClue(s, _p, ctx) {
  if (!s.clue) return null;
  return builder(s, ctx).field("phase", "board").field("clue", null).done();
}

// ---------- scores ----------
export function adjustScore(s, { team, delta }, ctx) {
  if (!TEAMS.includes(team) || !Number.isFinite(Number(delta)) || !Number(delta)) return null;
  const b = builder(s, ctx).score(team, Math.round(Number(delta)), "manual", { kind: "manual" });
  // Scores fixed up while Final wagers are being made: who plays and what they can bet follow.
  const f = s.final;
  if (s.phase === "final" && f && f.stage === "wager") {
    const score = ((s.scores && s.scores[team]) || 0) + Math.round(Number(delta));
    const needPos = !s.settings || s.settings.finalNeedsPositive !== false;
    const eligible = needPos ? { ...f.eligible, [team]: score > 0 } : f.eligible;
    const wagers = { ...f.wagers };
    if (wagers[team] && (!eligible[team] || wagers[team].amount > Math.max(0, score))) delete wagers[team];
    const order = [...TEAMS].sort((x, y) => (x === team ? score : (s.scores[x] || 0)) - (y === team ? score : (s.scores[y] || 0)));
    b.field("final", { ...f, eligible, wagers, order });
  }
  return b.done();
}
export function setScore(s, { team, value }, ctx) {
  if (!TEAMS.includes(team) || !Number.isFinite(Number(value))) return null;
  const delta = Math.round(Number(value)) - ((s.scores && s.scores[team]) || 0);
  return adjustScore(s, { team, delta }, ctx);
}
export function undo(s, _p, ctx) {
  const hist = [...(s.history || [])];
  const last = hist[hist.length - 1];
  if (!last) return null;
  // Undo everything the last action scored (e.g. both halves of a split tie).
  const scores = { ...s.scores };
  do {
    const h = hist.pop();
    scores[h.team] = (scores[h.team] || 0) - h.delta;
  } while (hist.length && last.g && hist[hist.length - 1].g === last.g);
  const b = builder(s, ctx).field("scores", scores).field("history", hist);
  if (last.kind === "mini" && s.minis) {
    const M = minisOf(s);
    b.field("minis", {
      ...M,
      list: M.list.map((g) => {
        if (g.id !== last.miniId) return g;
        if (last.finish) return { ...g, status: "active", result: null };
        if (last.matchId) return { ...g, matches: g.matches.map((m) => (m.id === last.matchId ? { ...m, winner: null } : m)) };
        return g;
      }),
    });
  }
  if (last.kind === "clue" && last.why === "correct" && "prevControl" in last) b.field("control", last.prevControl);
  if (last.kind === "final" && s.final) {
    const f = s.final;
    b.field("final", {
      ...f,
      results: { ...f.results, [last.team]: null },
      shown: { ...f.shown, [last.team]: { ...f.shown[last.team], wager: false } },
    });
  }
  return b.done();
}

// ---------- Final Jeopardy ----------
export function finalStart(s, _p, ctx) {
  if (!finalClue(ctx.questions)) return fail("Add a 'Final Jeopardy' tab to your questions first.");
  const sc = s.scores || {};
  const needPos = !s.settings || s.settings.finalNeedsPositive !== false;
  const eligible = { team1: !needPos || (sc.team1 || 0) > 0, team2: !needPos || (sc.team2 || 0) > 0 };
  const order = [...TEAMS].sort((a, b) => (sc[a] || 0) - (sc[b] || 0));
  return builder(s, ctx)
    .field("phase", "final").field("clue", null)
    .field("final", { ...freshFinal(), stage: "wager", eligible, order })
    .sfx("finalcat").done();
}

export function finalSetEligible(s, { team, eligible }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "wager" || !TEAMS.includes(team)) return null;
  return builder(s, ctx).field("final", {
    ...f, eligible: { ...f.eligible, [team]: !!eligible },
    wagers: eligible ? f.wagers : { ...f.wagers, [team]: null },
  }).done();
}

export function finalWager(s, { team, amount, by }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "wager" || !TEAMS.includes(team)) return null;
  if (!f.eligible[team]) return fail(`${teamName(s, team)} isn't playing Final Jeopardy.`);
  const max = finalMax(s, team);
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a < 0 || a > max) return fail(`Wager must be between $0 and $${max}.`);
  return builder(s, ctx).field("final", {
    ...f, wagers: { ...f.wagers, [team]: { amount: a, by: String(by || "Host").slice(0, 40), at: ctx.now } },
  }).done();
}

// Anyone on the team can take the wager back to change it (like the Final answer).
export function finalWagerUndo(s, { team }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "wager" || !TEAMS.includes(team) || !f.wagers[team]) return null;
  const wagers = { ...f.wagers };
  delete wagers[team];
  return builder(s, ctx).field("final", { ...f, wagers }).done();
}

export function finalRevealClue(s, _p, ctx) {
  const f = s.final;
  if (!f || f.stage !== "wager") return null;
  if (!TEAMS.some((t) => f.eligible[t])) return fail("No team is playing Final Jeopardy — mark at least one team as playing.");
  const wagers = { ...f.wagers };
  for (const t of TEAMS) if (f.eligible[t] && !wagers[t]) wagers[t] = { amount: 0, by: "(no wager)", at: ctx.now };
  const secs = (s.settings && s.settings.finalSeconds) || 62;
  return builder(s, ctx).field("final", { ...f, wagers, stage: "clue", deadline: ctx.now + secs * 1000 }).done();
}

// done: someone on the team pressed Submit (or tapped a choice) — it counts for the whole
// team. The think music and timer always run to the end; until then anyone can undo it.
export function finalAnswer(s, { team, text, by, done }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "clue" || !TEAMS.includes(team) || !f.eligible[team]) return null;
  if (ctx.now > f.deadline + 1500) return fail("Time's up — answers are locked.");
  const answers = { ...f.answers, [team]: { text: String(text || "").trim().slice(0, 200), by: String(by || "").slice(0, 40), at: ctx.now, done: !!done || !!(f.answers[team] && f.answers[team].done && done !== false) } };
  return builder(s, ctx).field("final", { ...f, answers }).done();
}

export function finalLock(s, { force } = {}, ctx) {
  const f = s.final;
  if (!f || f.stage !== "clue") return null;
  if (!force && ctx.now < f.deadline - 60) return null;
  return builder(s, ctx).field("final", { ...f, stage: "reveal" }).done(); // the music ending is the cue
}

// Jaren reads each team's answer on his own screen first and says whether it's right —
// only then does the board show it (one team at a time). Nothing is marked by the website,
// multiple choice included.
export function finalJudge(s, { team, correct }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "reveal" || !TEAMS.includes(team) || !f.eligible[team] || f.results[team]) return null;
  const amount = (f.wagers[team] && f.wagers[team].amount) || 0;
  const b = builder(s, ctx);
  b.score(team, correct ? amount : -amount, correct ? "final-correct" : "final-wrong", { kind: "final" });
  b.field("final", {
    ...f,
    results: { ...f.results, [team]: correct ? "correct" : "wrong" },
    shown: { ...f.shown, [team]: { answer: true, wager: true } },
  });
  return b.sfx(correct ? "correct" : "wrong").done();
}

export function finalFinish(s, _p, ctx) {
  const f = s.final;
  if (!f || f.stage !== "reveal") return null;
  return builder(s, ctx).field("phase", "over").field("final", { ...f, stage: "done" }).sfx("win").done();
}

// End without Final Jeopardy (e.g. no Final clue in the spreadsheet).
export function endGame(s, _p, ctx) {
  if (s.phase === "over" || s.phase === "lobby") return null;
  return builder(s, ctx).field("phase", "over").field("clue", null).sfx("win").done();
}

// ---------- setup ----------
export function setTeamName(s, { team, name, byPlayer }, ctx) {
  if (!TEAMS.includes(team)) return null;
  if (byPlayer) {
    if (s.settings && s.settings.playersRename === false) return fail("The host has locked team names.");
    if (!["lobby", "minis"].includes(s.phase)) return fail("Team names are locked once Jeopardy starts.");
  }
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 24) || DEFAULT_NAMES[team];
  if (clean.toLowerCase() === teamName(s, otherTeam(team)).toLowerCase()) return fail("The other team already has that name!");
  if (clean === teamName(s, team)) return null;
  return builder(s, ctx).field("teamNames", { ...s.teamNames, [team]: clean }).done();
}

export function setSettings(s, { patch }, ctx) {
  const next = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (LIMITS[k]) next[k] = clamp(Math.round(Number(v) || 0), LIMITS[k]);
    else if (k in DEFAULT_SETTINGS && typeof DEFAULT_SETTINGS[k] === "boolean") next[k] = !!v;
  }
  return builder(s, ctx).field("settings", next).done();
}

// Reset to a fresh game, keeping team names + settings. (The data layer also resets
// every question's `used` flag and clears buzzes.)
export function newGame(s, _p, ctx) {
  const fresh = defaultState({ teamNames: s.teamNames, settings: s.settings });
  fresh.minis = { list: minisOf(s).list.map((g) => ({ ...g, ...blankProgress() })), current: null, back: null, recent: [] };
  fresh.loaded = s.loaded || null; // the questions themselves stay loaded
  const b = builder(s, ctx);
  for (const [k, v] of Object.entries(fresh)) b.field(k, v);
  return b.done();
}

// Remember which library set was put on the board (null = loaded some other way).
export function setLoaded(s, { id, name } = {}, ctx) {
  const loaded = id ? { id: String(id), name: String(name || "").slice(0, 60), at: ctx.now } : null;
  return builder(s, ctx).field("loaded", loaded).done();
}

// =================================================================
// Mini games — played for team points (usually before Jeopardy)
//   h2h  : one player from each team faces off; record who won each matchup
//   best : players take turns; the best single score wins it for their team
//   all  : everyone plays at the same time and Jaren says who won — no draws, no scores
// The host can always skip the tracking and simply declare a winner.
// =================================================================
export const SPIN_MS = 1800; // length of the "who's up next?" shuffle animation
export const MAX_TABLES = 8;  // the same game played at this many tables at once

export function freshMinis() { return { list: [], current: null, back: null, recent: [] }; }
export function minisOf(s) { return (s && s.minis) || freshMinis(); }
export const miniById = (s, id) => minisOf(s).list.find((g) => g.id === id) || null;
export const openMatch = (g) => (g.matches || []).find((m) => !m.winner) || null;
// Matchups still being played (one per table when a game runs at several tables at once).
export const openMatches = (g) => (g.matches || []).filter((m) => !m.winner);
// Best-overall players currently up (one per table). Older saves only had a single `turn`.
export const turnsOf = (g) => (Array.isArray(g.turns) ? g.turns : g.turn ? [g.turn] : []);
const withTurns = (x, turns) => ({ ...x, turns, turn: turns[0] || null });
function blankProgress() {
  return { status: "pending", matches: [], entries: [], turn: null, turns: [], played: { team1: [], team2: [] }, result: null, clock: null };
}

// ---------- the game clock ----------
// Some games are played against the clock ("30 seconds to stack the most cups"). Jaren
// starts it; every screen counts down off the same shared clock, so several tables all
// play to the same timer, and the horn sounds everywhere at once when it runs out.
export const TIMER_LEAD_MS = 700; // the horn is cued a moment early so it lands on zero
export const miniClock = (g) => (g && g.clock) || null;
export const miniClockLeft = (g, now) => { const c = miniClock(g); return c ? Math.max(0, c.endsAt - now) : 0; };
export const miniClockRunning = (g, now) => { const c = miniClock(g); return !!c && now < c.endsAt; };
export function miniTimerStart(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || !g.timed) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, clock: { startedAt: ctx.now, endsAt: ctx.now + x.seconds * 1000, done: false } }))))
    .sfx("buzz").done();
}
export function miniTimerStop(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g || !g.clock) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, clock: null })))).done();
}
// Time's up: the horn, on every screen at the same instant.
export function miniTimerDone(s, { id }, ctx) {
  const g = miniById(s, id);
  const c = miniClock(g);
  if (!c || c.done || ctx.now < c.endsAt - TIMER_LEAD_MS) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, clock: { ...c, done: true } })))).sfx("horn").done();
}

function cleanMini(src) {
  // Blind drawing is a Best overall game: the website scores every drawing 0–100 and the
  // best drawing of the night wins the points for its team.
  const mode = src.type === "draw" || src.mode === "draw" ? "draw" : "normal";
  const type = mode === "draw" ? "best" : src.type === "best" || src.type === "all" ? src.type : "h2h";
  const pts = Math.round(Number(src.points));
  return {
    name: String(src.name == null ? "" : src.name).replace(/\s+/g, " ").trim().slice(0, 40) || "Mini game",
    type,
    points: src.points === "" || src.points == null || !Number.isFinite(pts) ? 500 : clamp(pts, [0, 100000]),
    award: type === "h2h" && src.award === "match" ? "match" : "game", // points for the game, or per matchup win
    better: mode === "draw" || src.better !== "low" ? "high" : "low",  // best: highest or lowest score wins (drawings: highest match)
    unit: mode === "draw" ? "% match" : String(src.unit == null ? "" : src.unit).trim().slice(0, 16),
    desc: String(src.desc == null ? "" : src.desc).trim().slice(0, 240),
    mode,
    // Blind drawing: the host's pictures (ids of state/drawpic-* docs), used in turn.
    pics: mode === "draw" && Array.isArray(src.pics) ? [...new Set(src.pics.filter((x) => typeof x === "string" && x))].slice(0, 40) : [],
    // How many steps each hand-drawn picture has (ready-made ones know their own steps).
    picSteps: mode === "draw" ? cleanPicSteps(src.picSteps, src.pics) : {},
    stepSeconds: clamp(Math.round(Number(src.stepSeconds)) || 20, [5, 120]), // a new step every this many seconds
    // Played against the clock: Jaren starts it, every table plays to the same one.
    timed: mode !== "draw" && !!src.timed,
    seconds: clamp(Math.round(Number(src.seconds)) || 60, [5, 3600]),
    // Played at this many tables at the same time, to get through it faster. Blind drawing
    // and "everyone at once" games are played by everybody together, so they have one spot.
    tables: mode === "draw" || type === "all" ? 1 : clamp(Math.round(Number(src.tables)) || 1, [1, MAX_TABLES]),
    // 🎟 a scratch-it for whoever wins it (only where one person wins it for their team)
    prize: type !== "h2h" && !!src.prize,
  };
}

function cleanPicSteps(steps, pics) {
  const out = {};
  for (const id of Array.isArray(pics) ? pics : []) {
    if (typeof id !== "string" || id.startsWith("builtin:")) continue;
    const n = Math.round(Number(steps && steps[id]));
    out[id] = Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : 1;
  }
  return out;
}

// Who's winning a mini game right now.
export function miniStanding(g) {
  const wins = { team1: 0, team2: 0, ties: 0 };
  for (const m of g.matches || []) {
    if (m.winner === "tie") wins.ties++;
    else if (m.winner) wins[m.winner]++;
  }
  const dir = g.better === "low" ? 1 : -1;
  const sorted = [...(g.entries || [])].sort((a, b) => dir * (a.score - b.score) || a.at - b.at);
  const best = { team1: sorted.find((e) => e.team === "team1") || null, team2: sorted.find((e) => e.team === "team2") || null };
  let leader = null;
  if (g.type === "h2h") {
    if (wins.team1 + wins.team2 + wins.ties > 0) leader = wins.team1 === wins.team2 ? "tie" : wins.team1 > wins.team2 ? "team1" : "team2";
  } else if (sorted.length) {
    const rival = best[otherTeam(sorted[0].team)];
    leader = rival && rival.score === sorted[0].score ? "tie" : sorted[0].team;
  }
  return { wins, sorted, best, leader };
}

// The pick(s) currently on screen and when they were made. With several tables there's
// one item per table; `items` lists them, and the top-level fields describe the first.
export function currentPick(s) {
  const M = minisOf(s);
  const g = M.current ? M.list.find((x) => x.id === M.current) : null;
  if (!g || g.status !== "active" || g.mode === "draw" || g.type === "all") return null; // everyone plays at once: nobody is picked
  let items;
  if (g.type === "h2h") {
    items = openMatches(g).map((m) => {
      const sides = [m.p1, m.p2].filter(Boolean);
      return {
        id: m.id, key: m.id + sides.map((p) => ":" + p.id + "@" + p.at).join(""),
        at: sides.reduce((t, p) => Math.max(t, p.at || 0), 0), pids: sides.map((p) => p.id),
        names: [m.p1 ? m.p1.name : null, m.p2 ? m.p2.name : null],
        table: m.table || null, summon: m.summon == null ? null : m.summon,
      };
    });
  } else {
    items = turnsOf(g).map((t) => ({ id: t.id, key: t.id, at: t.at || 0, pids: [t.pid], names: [t.name], team: t.team, table: t.table || null, summon: t.summon == null ? null : t.summon }));
  }
  if (!items.length) return null;
  const first = items[0];
  return {
    type: g.type, items, key: items.map((x) => x.key).join("|"), at: Math.max(...items.map((x) => x.at)),
    pids: items.flatMap((x) => x.pids), names: first.names, table: first.table, summon: first.summon,
  };
}

// Everyone on both teams has had a go in this game.
export function miniEveryonePlayed(g, players) {
  const seen = new Set();
  for (const m of g.matches || []) if (m.winner) { if (m.p1) seen.add(m.p1.id); if (m.p2) seen.add(m.p2.id); for (const d of m.drawers || []) seen.add(d.id); }
  for (const e of g.entries || []) seen.add(e.pid);
  const all = (players || []).filter((p) => TEAMS.includes(p.team));
  return all.length > 0 && all.every((p) => seen.has(p.id));
}

const teamPlayers = (ctx, team) => (ctx.players || []).filter((p) => p.team === team);
// ---------- couples ----------
// Settings → Players gives each couple a number: husband 1a, wife 1b. Head-to-head mini
// games then put a couple against each other, and they're summoned to the table together.
export const pairNo = (p) => {
  const n = Math.round(Number(p && p.pair));
  return Number.isFinite(n) && n > 0 ? n : null;
};
export const pairTag = (p) => (pairNo(p) ? `${pairNo(p)}${p.team === "team2" ? "b" : "a"}` : "");
export function partnerOf(players, pid) {
  const me = (players || []).find((p) => p.id === pid);
  const n = pairNo(me);
  if (!n || !TEAMS.includes(me.team)) return null;
  return (players || []).find((p) => p.id !== pid && TEAMS.includes(p.team) && p.team !== me.team && pairNo(p) === n) || null;
}
const pairingOn = (s) => !s.settings || s.settings.pairUp !== false;
// The partner of whoever was just drawn, if they're free to play right now.
function mateFor(ctx, pick, team, busy) {
  if (!pick) return null;
  const m = partnerOf(ctx.players, pick.id);
  if (!m || m.team !== team || busy.includes(m.id)) return null;
  return { id: m.id, name: m.name, at: ctx.now };
}
const random = (ctx) => (ctx.rand || Math.random)();

// Random player from a team: nobody repeats until the whole team has had a turn. A player
// leaves the pool the moment they're picked (a re-draw puts them back).
// busy: players already playing at another table right now — never drawn twice at once.
// tonight: who has already played some mini game tonight — everyone else goes first, so
// the whole party gets a turn across the mini games.
function choose(ctx, team, played, avoid = [], busy = [], tonight = [], want = null) {
  const all = teamPlayers(ctx, team).filter((p) => !busy.includes(p.id));
  if (!all.length) return null;
  let pool = all.filter((p) => !played.includes(p.id) && !avoid.includes(p.id));
  if (!pool.length) pool = all.filter((p) => !avoid.includes(p.id)); // whole team has been — start a new cycle
  if (!pool.length) pool = all;                                      // a team of one
  const fresh = pool.filter((p) => !tonight.includes(p.id));
  if (fresh.length) pool = fresh;
  if (want) { const liked = pool.filter(want); if (liked.length) pool = liked; } // e.g. their partner is free
  const p = pool[Math.floor(random(ctx) * pool.length)];
  return { id: p.id, name: p.name, at: ctx.now };
}
// Add a player to a pool list; once the whole team is in, a new cycle starts with them.
function markPlayed(played, team, pid, ctx) {
  if (!pid) return played;
  const cur = (played && played[team]) || [];
  if (!cur.includes(pid)) return { ...played, [team]: [...cur, pid] };
  const everyone = teamPlayers(ctx, team).every((p) => cur.includes(p.id));
  return everyone ? { ...played, [team]: [pid] } : played;
}
const unmark = (played, team, pid) => (pid && played && played[team] ? { ...played, [team]: played[team].filter((x) => x !== pid) } : played);
const addOnce = (played, team, pid) => (pid && !((played && played[team]) || []).includes(pid) ? { ...played, [team]: [...((played && played[team]) || []), pid] } : played);
const tonightOf = (s) => minisOf(s).tonight || { team1: [], team2: [] };
function lastSide(g, key) {
  for (let i = g.matches.length - 1; i >= 0; i--) if (g.matches[i][key]) return g.matches[i][key].id;
  return null;
}
function pickTurn(g, ctx, replacing, busy = [], lastTeam, tonight = { team1: [], team2: [] }) {
  const free = (t) => teamPlayers(ctx, t).filter((p) => !busy.includes(p.id));
  const has = TEAMS.filter((t) => free(t).length);
  if (!has.length) return null;
  let team;
  if (replacing && free(replacing.team).length > 1) {
    team = replacing.team; // swap in a teammate
  } else {
    const fresh = has.filter((t) => free(t).some((p) => !g.played[t].includes(p.id)));
    const cands = fresh.length ? fresh : has;
    const last = lastTeam !== undefined ? lastTeam : g.entries.length ? g.entries[g.entries.length - 1].team : null;
    team = cands.length === 1 ? cands[0] : last ? otherTeam(last) : TEAMS[Math.floor(random(ctx) * 2)];
  }
  const lastPid = g.entries.length ? g.entries[g.entries.length - 1].pid : null;
  const p = choose(ctx, team, g.played[team], [replacing ? replacing.pid : null, lastPid], busy, tonight[team] || []);
  if (!p) return null;
  return { id: rid(), pid: p.id, name: p.name, team, at: ctx.now };
}
const withList = (s, list, extra = {}) => ({ ...minisOf(s), list, ...extra });
// The tables a game runs at, all at once. No tables set up → a single spot (null).
export const miniSlots = (s, g) => slotsFor(s, g);
// Where this game is played: one spot (null = nothing to announce), or the tables it runs
// at, named from the host's list (Kitchen, Garage…) or just Table 1, Table 2, …
function slotsFor(s, g) {
  const n = clamp(Math.round(Number(g && g.tables)) || 1, [1, MAX_TABLES]);
  return n < 2 ? [null] : Array.from({ length: n }, (_, i) => `Table ${i + 1}`);
}
// Christmas summon lines that haven't been used lately.
function summonPicker(s, ctx) {
  let recent = [...(minisOf(s).recent || [])];
  const next = () => {
    let pool = SUMMONS.map((_, i) => i).filter((i) => !recent.includes(i));
    if (!pool.length) pool = SUMMONS.map((_, i) => i);
    const k = pool[Math.floor(random(ctx) * pool.length)];
    recent = [...recent, k].slice(-Math.min(24, SUMMONS.length - 1));
    return k;
  };
  return { next, extra: () => ({ recent }) };
}
// Is anyone on this team still waiting for their first turn of the round (and free to
// play)? `busy` keeps growing as a draw fills table after table.
const fresher = (ctx, played, busy) => (team) => {
  const ps = teamPlayers(ctx, team);
  if (!ps.length) return true; // a team with nobody in it never holds a table up
  const done = (played && played[team]) || [];
  return ps.some((p) => !busy.includes(p.id) && !done.includes(p.id));
};
const busyIn = (items) => items.flatMap((x) => (x.pid ? [x.pid] : [x.p1 && x.p1.id, x.p2 && x.p2.id].filter(Boolean)));
const mapMini = (s, id, fn) => minisOf(s).list.map((g) => (g.id === id ? fn(g) : g));
const NO_MINIS_NOW = { clue: "Finish the current question first.", final: "Final Jeopardy has already started.", over: "The game is over — start a new game to play mini games." };

// ---------- setup ----------
export function miniAdd(s, { game }, ctx) {
  const M = minisOf(s);
  if (M.list.length >= 20) return fail("That's plenty of mini games! Remove one first.");
  const g = { id: rid(), ...cleanMini(game || {}), ...blankProgress() };
  // Blind Drawing is a once-a-night thing — everyone draws together.
  if (g.mode === "draw" && M.list.some((x) => x.mode === "draw")) return fail("You've already got a Blind Drawing — it's played once for the night.");
  return builder(s, ctx).field("minis", withList(s, [...M.list, g])).done();
}
export function miniUpdate(s, { id, patch }, ctx) {
  const g = miniById(s, id);
  if (!g || !patch) return null;
  const started = g.status !== "pending" || g.matches.length > 0 || g.entries.length > 0;
  const next = cleanMini({ ...g, ...patch, ...(patch.type === "h2h" || patch.mode === "normal" ? { mode: "normal" } : {}) });
  if (started && (next.type !== g.type || next.award !== g.award || next.mode !== (g.mode || "normal"))) return fail("That game has already started — reset it before changing how it's played.");
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, ...next })))).done();
}
export function miniRemove(s, { id }, ctx) {
  const M = minisOf(s);
  if (!miniById(s, id)) return null;
  return builder(s, ctx).field("minis", withList(s, M.list.filter((g) => g.id !== id), { current: M.current === id ? null : M.current })).done();
}
export function miniMove(s, { id, dir }, ctx) {
  const list = [...minisOf(s).list];
  const i = list.findIndex((g) => g.id === id);
  const j = i + (Number(dir) < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return builder(s, ctx).field("minis", withList(s, list)).done();
}
// Start a game over: hands back any points it gave out.
export function miniReset(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g) return null;
  const b = builder(s, ctx);
  for (const t of TEAMS) {
    const given = (s.history || []).filter((h) => h.miniId === id && h.team === t).reduce((n, h) => n + h.delta, 0);
    if (given) b.score(t, -given, "mini-reset", { kind: "mini-reset", miniId: id });
  }
  const M = minisOf(s);
  return b.field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, ...blankProgress() })), { current: M.current === id ? null : M.current })).done();
}

// Add / remove a table for one game, right from the "who's up next" controls (the same
// setting is a tick box in Settings → Mini games). One table = everyone in one spot.
export function miniTableAdd(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g) return null;
  if (g.mode === "draw" || g.type === "all") return fail("Everyone plays this one together.");
  const n = clamp(Math.round(Number(g.tables)) || 1, [1, MAX_TABLES]);
  if (n >= MAX_TABLES) return fail(`Up to ${MAX_TABLES} tables.`);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, tables: Math.max(2, n + 1) })))).done();
}
export function miniTableRemove(s, { id, table }, ctx) {
  const g = miniById(s, id);
  if (!g) return null;
  const slots = slotsFor(s, g);
  if (table !== undefined && !slots.includes(table)) return null;
  if (g.status === "active" && [...openMatches(g), ...turnsOf(g)].some((x) => x.table === table)) {
    return fail(`Someone is still playing at ${table} — finish that first.`);
  }
  // Down to one table = back to playing in one spot (no table to announce).
  const left = slots.length - 1 > 1 ? slots.length - 1 : 1;
  const keep = slotsFor(s, { tables: left });
  const move = (x) => (x.table && !keep.includes(x.table) ? { ...x, table: keep[0] || null } : x);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({
    ...withTurns(x, turnsOf(x).map(move)), tables: left, matches: x.matches.map(move),
  })))).done();
}

// ---------- flow ----------
export function minisStart(s, _p, ctx) {
  if (s.phase === "minis") return null;
  if (s.phase !== "lobby" && s.phase !== "board") return fail(NO_MINIS_NOW[s.phase] || "Not right now.");
  return builder(s, ctx).field("phase", "minis")
    .field("minis", { ...minisOf(s), current: null, back: s.phase === "board" ? "board" : null }).done();
}
// Return to a Jeopardy board that was paused for a mini game.
export function minisEnd(s, _p, ctx) {
  const M = minisOf(s);
  if (s.phase !== "minis" || M.back !== "board") return null;
  return builder(s, ctx).field("phase", "board").field("minis", { ...M, current: null, back: null }).done();
}
export function miniPlay(s, { id }, ctx) {
  if (!miniById(s, id)) return null;
  if (!["lobby", "minis", "board"].includes(s.phase)) return fail(NO_MINIS_NOW[s.phase] || "Not right now.");
  const M = minisOf(s);
  const back = s.phase === "board" ? "board" : s.phase === "minis" ? M.back : null;
  const list = mapMini(s, id, (g) => (g.status === "pending" ? { ...g, status: "active" } : g));
  return builder(s, ctx).field("phase", "minis").field("minis", { ...M, list, current: id, back }).done();
}
export function miniClose(s, _p, ctx) {
  const M = minisOf(s);
  if (!M.current) return null;
  return builder(s, ctx).field("minis", { ...M, current: null }).done();
}

// ---------- who's up next ----------
// Draws for every free table at once (or just `table`). Nobody is drawn for two tables.
export function miniNext(s, { id, table }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active") return null;
  if (g.type === "all") return null; // everyone plays at once — nobody is drawn
  if (g.mode === "draw") return miniDrawRound(s, { id }, ctx); // everyone draws at once
  const slots = slotsFor(s, g);
  const sp = summonPicker(s, ctx);
  const withTable = (slot) => (slot === null ? {} : { table: slot, summon: sp.next() });
  if (g.type === "h2h") {
    const open = openMatches(g);
    let free = slots.filter((t) => !open.some((m) => (m.table || null) === t));
    if (table !== undefined) free = free.filter((t) => t === table);
    if (!free.length) return null;
    const busy = busyIn(open);
    const added = [];
    const anyone = TEAMS.some((t) => teamPlayers(ctx, t).length);
    let played = g.played, tonight = tonightOf(s);
    const pairs = pairingOn(s);
    // Filling several tables in one go must not start a new round at the last table while
    // somebody still hasn't played this one: that table waits instead (the host can still
    // draw for it on its own to get it going again).
    // Couples play each other: draw one side, and their partner is the other side.
    const freeMate = (p) => { const m = partnerOf(ctx.players, p.id); return !!m && m.team === "team2" && !busy.includes(m.id); };
    for (const slot of free) {
      if (added.length && !TEAMS.every(fresher(ctx, played, busy))) break; // nobody left who hasn't played
      const p1 = choose(ctx, "team1", played.team1, [lastSide(g, "p1")], busy, tonight.team1, pairs ? freeMate : null);
      const p2 = (pairs && mateFor(ctx, p1, "team2", busy)) || choose(ctx, "team2", played.team2, [lastSide(g, "p2")], busy, tonight.team2);
      const short = (!p1 && teamPlayers(ctx, "team1").length) || (!p2 && teamPlayers(ctx, "team2").length);
      if (added.length && (short || !anyone)) break; // not enough free players for another table
      if (short && open.length) break;
      added.push({ id: rid(), winner: null, at: ctx.now, p1, p2, ...withTable(slot) });
      // Picked = out of the pool right away.
      if (p1) { busy.push(p1.id); played = markPlayed(played, "team1", p1.id, ctx); tonight = markPlayed(tonight, "team1", p1.id, ctx); }
      if (p2) { busy.push(p2.id); played = markPlayed(played, "team2", p2.id, ctx); tonight = markPlayed(tonight, "team2", p2.id, ctx); }
      if (!anyone) break;
    }
    if (!added.length) return fail("Everyone is already playing at a table.");
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, matches: [...x.matches, ...added] })), { ...sp.extra(), tonight }))
      .sfx(added.some((m) => m.p1 || m.p2) ? "pick" : "buzz").done();
  }
  const turns = turnsOf(g);
  let free = slots.filter((t) => !turns.some((x) => (x.table || null) === t));
  if (table !== undefined) free = free.filter((t) => t === table);
  if (!free.length) return null;
  const busy = busyIn(turns);
  const added = [];
  let lastTeam, played = g.played, tonight = tonightOf(s);
  for (const slot of free) {
    if (added.length && !TEAMS.some(fresher(ctx, played, busy))) break; // nobody left who hasn't played
    const t = pickTurn({ ...g, played }, ctx, null, busy, lastTeam, tonight);
    if (!t) break;
    added.push({ ...t, ...withTable(slot) });
    busy.push(t.pid);
    played = markPlayed(played, t.team, t.pid, ctx);
    tonight = markPlayed(tonight, t.team, t.pid, ctx);
    lastTeam = t.team;
  }
  if (!added.length) {
    if (!TEAMS.some((t) => teamPlayers(ctx, t).length)) return fail("No players yet. Add them in ⚙ Settings → Players, or just finish the game and choose the winner.");
    return fail("Everyone is already playing at a table.");
  }
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...withTurns(x, [...turnsOf(x), ...added]), played })), { ...sp.extra(), tonight })).sfx("pick").done();
}
const findOpen = (g, matchId) => (matchId ? openMatches(g).find((m) => m.id === matchId) : openMatch(g)) || null;
const findTurn = (g, turnId) => (turnId ? turnsOf(g).find((t) => t.id === turnId) : turnsOf(g)[0]) || null;
export function miniRepick(s, { id, team, matchId, turnId }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || g.mode === "draw") return null;
  const sp = summonPicker(s, ctx);
  if (g.type === "h2h") {
    const m = findOpen(g, matchId);
    if (!m) return null;
    const busy = busyIn(openMatches(g).filter((x) => x.id !== m.id));
    const next = { ...m };
    let played = g.played, tonight = tonightOf(s);
    const pairs = pairingOn(s);
    const keyOf = (t) => (t === "team1" ? "p1" : "p2");
    const drop = (t) => { const was = m[keyOf(t)] ? m[keyOf(t)].id : null; played = unmark(played, t, was); tonight = unmark(tonight, t, was); return was; };
    const take = (t, pick) => { next[keyOf(t)] = pick; if (pick) { played = markPlayed(played, t, pick.id, ctx); tonight = markPlayed(tonight, t, pick.id, ctx); } };
    // Redraw the side Jaren asked for (or both), and bring the new player's partner along.
    const first = TEAMS.includes(team) ? team : "team1";
    const second = otherTeam(first);
    const bothSides = !TEAMS.includes(team);
    const wasFirst = drop(first);
    const wasSecond = bothSides || pairs ? drop(second) : null;
    const freeMate = (p) => { const x = partnerOf(ctx.players, p.id); return !!x && x.team === second && !busy.includes(x.id); };
    const other = bothSides || pairs ? null : m[keyOf(second)];
    take(first, choose(ctx, first, played[first], [wasFirst], [...busy, ...(other ? [other.id] : [])], tonight[first] || [], pairs ? freeMate : null) || m[keyOf(first)]);
    if (bothSides || pairs) {
      const mate = pairs ? mateFor(ctx, next[keyOf(first)], second, busy) : null;
      // No partner free (or couples are off): a fresh draw for that side, or leave them be.
      take(second, mate || (bothSides
        ? choose(ctx, second, played[second], [wasSecond], [...busy, ...(next[keyOf(first)] ? [next[keyOf(first)].id] : [])], tonight[second] || [])
        : m[keyOf(second)]));
    }
    if (m.table) next.summon = sp.next();
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, matches: x.matches.map((y) => (y.id === m.id ? next : y)) })), { ...sp.extra(), tonight }))
      .sfx("pick").done();
  }
  const cur = findTurn(g, turnId);
  if (!cur) return null;
  const busy = busyIn(turnsOf(g).filter((x) => x.id !== cur.id));
  let played = unmark(g.played, cur.team, cur.pid), tonight = unmark(tonightOf(s), cur.team, cur.pid);
  const t = pickTurn({ ...g, played }, ctx, cur, busy, undefined, tonight);
  if (!t) return null;
  played = markPlayed(played, t.team, t.pid, ctx);
  tonight = markPlayed(tonight, t.team, t.pid, ctx);
  const nt = { ...t, ...(cur.table ? { table: cur.table, summon: sp.next() } : {}) };
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...withTurns(x, turnsOf(x).map((y) => (y.id === cur.id ? nt : y))), played })), { ...sp.extra(), tonight })).sfx("pick").done();
}
// Host sends a matchup / player to a particular table (swapping with whoever is there).
export function miniSetTable(s, { id, table, matchId, turnId }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || !slotsFor(s, g).includes(table)) return null;
  const summon = (x) => (x.summon == null ? Math.floor(random(ctx) * SUMMONS.length) : x.summon);
  const move = (items, target) => {
    if (!target || target.table === table) return null;
    return items.map((y) => (y.id === target.id ? { ...y, table, summon: summon(y) } : y.table === table ? { ...y, table: target.table || null } : y));
  };
  if (g.type === "h2h") {
    const next = move(g.matches, findOpen(g, matchId));
    if (!next) return null;
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: next })))).done();
  }
  const next = move(turnsOf(g), findTurn(g, turnId));
  if (!next) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => withTurns(x, next)))).done();
}

// Host hand-picks who's up instead of the random draw.
export function miniSetPlayer(s, { id, team, pid, matchId, turnId }, ctx) {
  const g = miniById(s, id);
  const p = (ctx.players || []).find((x) => x.id === pid);
  if (!g || g.status !== "active" || !p || !TEAMS.includes(p.team)) return null;
  if (g.type === "h2h") {
    const m = findOpen(g, matchId);
    if (!m || p.team !== team) return null;
    const key = team === "team1" ? "p1" : "p2";
    const was = m[key] ? m[key].id : null;
    const next = { ...m, [key]: { id: p.id, name: p.name, at: 0 } };
    const played = addOnce(unmark(g.played, team, was), team, p.id);
    const tonight = addOnce(unmark(tonightOf(s), team, was), team, p.id);
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, matches: x.matches.map((y) => (y.id === m.id ? next : y)) })), { tonight })).done();
  }
  const cur = findTurn(g, turnId);
  if (!cur) return null;
  const nt = { ...cur, id: rid(), pid: p.id, name: p.name, team: p.team, at: 0 };
  const played = addOnce(unmark(g.played, cur.team, cur.pid), p.team, p.id);
  const tonight = addOnce(unmark(tonightOf(s), cur.team, cur.pid), p.team, p.id);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...withTurns(x, turnsOf(x).map((y) => (y.id === cur.id ? nt : y))), played })), { tonight })).done();
}

// ---------- results ----------
export function miniMatch(s, { id, winner, matchId }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || g.type !== "h2h" || !["team1", "team2", "tie"].includes(winner)) return null;
  const m = findOpen(g, matchId);
  if (!m) return null;
  let played = g.played; // (marked when they were picked)
  if (m.p1) played = addOnce(played, "team1", m.p1.id);
  if (m.p2) played = addOnce(played, "team2", m.p2.id);
  const b = builder(s, ctx);
  if (g.award === "match" && winner !== "tie" && g.points) b.score(winner, g.points, "mini", { kind: "mini", miniId: g.id, matchId: m.id });
  b.field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, matches: x.matches.map((y) => (y.id === m.id ? { ...y, winner } : y)) }))));
  return b.sfx(winner === "tie" ? "buzz" : "correct").done();
}
// ---------- blind drawing ----------
// Everyone with a phone draws at the same time, right where they're sitting (no tables).
// One round = one picture. The website scores every drawing; the best one wins the
// round for its team.
export const DRAW_COUNTDOWN_MS = 3000;
const phoneDrawers = (ctx) => (ctx.players || []).filter((p) => TEAMS.includes(p.team) && !p.manual).map((p) => ({ id: p.id, name: p.name, team: p.team }));
// The round being drawn right now (null between rounds), and all the rounds so far.
export const drawRound = (g) => openMatches(g).find((m) => m.all) || null;
export const drawRounds = (g) => (g.matches || []).filter((m) => m.all);
// Everyone in a round, best drawing first (no drawing = last).
export function drawRanking(m) {
  const sc = m.scores || {};
  return (m.drawers || []).map((d) => ({ ...d, sent: !!(m.done || {})[d.id], score: sc[d.id] == null ? null : sc[d.id] }))
    .sort((x, y) => (y.score == null ? -1 : y.score) - (x.score == null ? -1 : x.score));
}
const setRound = (s, id, r, extra = {}) => withList(s, mapMini(s, id, (x) => ({ ...x, ...extra, matches: x.matches.map((m) => (m.id === r.id ? r : m)) })));
// Set up a round: every phone is a drawing pad. (Drawing starts when the host taps Start.)
export function miniDrawRound(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g || g.mode !== "draw" || g.status !== "active") return null;
  if (drawRound(g)) return null;
  if (!(g.pics || []).length) return fail("Add a picture first: ⚙ Settings → Mini games → this game → 🎄 Ready-made drawings.");
  const drawers = phoneDrawers(ctx);
  if (!drawers.length) return fail("Nobody has joined on a phone yet — everyone draws on their own phone.");
  const pic = g.pics[(g.picNext || 0) % g.pics.length];
  const round = { id: rid(), all: true, winner: null, at: ctx.now, pic, drawers, done: {}, startedAt: null };
  // (Matchups left over from the old one-on-one version are dropped.)
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: [...x.matches.filter((m) => m.all || m.winner), round], picNext: (x.picNext || 0) + 1 })))).sfx("pick").done();
}
// Start drawing: the steps start appearing on the big screen after a 3-second countdown.
export function miniDrawStart(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g || g.mode !== "draw" || g.status !== "active") return null;
  const r = drawRound(g);
  if (!r || r.startedAt) return null;
  const have = new Set(r.drawers.map((d) => d.id));
  const drawers = [...r.drawers, ...phoneDrawers(ctx).filter((d) => !have.has(d.id))]; // anyone who just joined draws too
  return builder(s, ctx).field("minis", setRound(s, id, { ...r, drawers, startedAt: ctx.now + DRAW_COUNTDOWN_MS })).sfx("pick").done();
}
// Undo a round that was set up or started by mistake: as if it never happened (the same
// picture is used next time).
export function miniDrawCancel(s, { id, matchId }, ctx) {
  const g = miniById(s, id);
  if (!g || g.mode !== "draw") return null;
  const r = drawRound(g);
  if (!r || (matchId && r.id !== matchId)) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: x.matches.filter((m) => m.id !== r.id), picNext: Math.max(0, (x.picNext || 0) - 1) })))).done();
}
// A phone sent its drawing (the drawing itself is saved in its own document).
export function miniDrawSubmitted(s, { id, matchId, pid }, ctx) {
  const g = miniById(s, id);
  if (!g || g.mode !== "draw") return null;
  const r = drawRound(g);
  if (!r || (matchId && r.id !== matchId) || !r.drawers.some((d) => d.id === pid) || (r.done || {})[pid]) return null;
  return builder(s, ctx).field("minis", setRound(s, id, { ...r, done: { ...(r.done || {}), [pid]: true } })).sfx("buzz").done();
}
// The website's verdict: scores are 0–100 shape matches per drawer (null = no drawing).
// The best drawing wins the round for its team (a tie if both teams share the top score).
export function miniDrawJudge(s, { id, matchId, scores = {} }, ctx) {
  const g = miniById(s, id);
  if (!g || g.mode !== "draw") return null;
  const r = drawRound(g);
  if (!r || (matchId && r.id !== matchId)) return null;
  const num = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), [0, 100]) : null);
  // Drawings are their own documents; the judge passes a score for each one it found (and
  // null for anyone who didn't send). Older rounds marked each drawing as it arrived.
  const marked = Object.keys(r.done || {}).length > 0;
  const sc = {}, done = {};
  for (const d of r.drawers) {
    sc[d.id] = !marked || r.done[d.id] ? num(scores[d.id]) : null;
    if (sc[d.id] != null) done[d.id] = true;
  }
  const ranked = drawRanking({ ...r, done, scores: sc });
  const top = ranked.length ? ranked[0].score : null;
  const topTeams = new Set(ranked.filter((x) => top != null && x.score === top).map((x) => x.team));
  const winner = topTeams.size === 1 ? [...topTeams][0] : "tie";
  // Every drawing is a score in the standings: the best one of the night wins the game.
  const entries = ranked.filter((d) => d.score != null)
    .map((d) => ({ id: rid(), pid: d.id, name: d.name, team: d.team, score: d.score, at: ctx.now, roundId: r.id }));
  let played = g.played;
  for (const d of r.drawers) played = addOnce(played, d.team, d.id);
  const judged = { ...r, winner, done, scores: sc, judged: ctx.now };
  return builder(s, ctx)
    .field("minis", withList(s, mapMini(s, id, (x) => ({
      ...x, played, entries: [...x.entries, ...entries], matches: x.matches.map((y) => (y.id === r.id ? judged : y)),
    }))))
    .sfx(winner === "tie" ? "buzz" : "correct").done();
}

export function miniMatchRemove(s, { id, matchId }, ctx) {
  const g = miniById(s, id);
  const m = g && g.matches.find((x) => x.id === matchId);
  if (!m) return null;
  if (g.status === "done") return fail("That game is finished — reset it to change the results.");
  const b = builder(s, ctx);
  if (g.award === "match" && m.winner && m.winner !== "tie" && g.points) b.score(m.winner, -g.points, "mini-fix", { kind: "mini-fix", miniId: g.id });
  return b.field("minis", withList(s, mapMini(s, id, (x) => ({
    ...x, matches: x.matches.filter((y) => y.id !== matchId), entries: x.entries.filter((e) => e.roundId !== matchId),
  })))).done();
}
export function miniScore(s, { id, score, turnId }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || g.type !== "best") return null;
  const t = findTurn(g, turnId);
  if (!t) return null;
  const v = typeof score === "string" && score.trim() === "" ? NaN : Number(score);
  if (score == null || !Number.isFinite(v)) return fail("Type their score as a number first.");
  const entry = { id: rid(), pid: t.pid, name: t.name, team: t.team, score: Math.round(v * 100) / 100, at: ctx.now };
  const played = addOnce(g.played, t.team, t.pid); // (marked when they were picked)
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...withTurns(x, turnsOf(x).filter((y) => y.id !== t.id)), played, entries: [...x.entries, entry] }))))
    .sfx("buzz").done();
}
export function miniEntryRemove(s, { id, entryId }, ctx) {
  const g = miniById(s, id);
  if (!g || !g.entries.some((e) => e.id === entryId)) return null;
  if (g.status === "done") return fail("That game is finished — reset it to change the results.");
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, entries: x.entries.filter((e) => e.id !== entryId) })))).done();
}
// winner: 'team1' | 'team2' | 'tie' (points split) | 'none'. Leave it out to use the
// standings. pid: for an "everyone at once" game, who won it for their team (so it counts
// toward 🏆 North Pole Champ).
export function miniFinish(s, { id, winner, pid }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status === "done") return null;
  if (!["lobby", "minis", "board"].includes(s.phase)) return fail(NO_MINIS_NOW[s.phase] || "Not right now.");
  const w = ["team1", "team2", "tie", "none"].includes(winner) ? winner : miniStanding(g).leader || "none";
  const b = builder(s, ctx);
  const got = { team1: 0, team2: 0 };
  if (g.award === "match") {
    // Points were already handed out matchup by matchup.
    for (const m of g.matches) if (m.winner && m.winner !== "tie") got[m.winner] += g.points;
  } else {
    if (w === "tie") got.team1 = got.team2 = Math.round(g.points / 2);
    else if (w !== "none") got[w] = g.points;
    for (const t of TEAMS) if (got[t]) b.score(t, got[t], "mini", { kind: "mini", miniId: g.id, finish: true });
  }
  const M = minisOf(s);
  const hero = (ctx.players || []).find((p) => p.id === pid && p.team === w) || null;
  const by = hero ? { by: { pid: hero.id, name: hero.name, team: hero.team } } : {};
  const done = (x) => ({ ...x, status: "done", turn: null, turns: [], clock: null, matches: x.matches.filter((m) => m.winner), result: { winner: w, team1: got.team1, team2: got.team2, ...by } });
  b.field("minis", withList(s, mapMini(s, id, done), { current: s.phase === "minis" ? id : M.current }));
  return b.sfx(w === "none" ? "buzz" : "miniwin").done();
}

// =====================================================================
// Ugly sweater vote (after Jeopardy is over)
// stage: off → setup (host ticks who can win) → open (phones vote) → reveal
// Votes are kept hidden on every screen until everyone has voted (or the host reveals).
// =====================================================================
export function freshVote() { return { stage: "off", candidates: [], names: {}, votes: {}, openedAt: null }; }
export const voteOf = (s) => (s && s.vote) || freshVote();
// Everyone with a phone can vote (players the host added by hand have no phone).
export const voteVoters = (players) => (players || []).filter((p) => TEAMS.includes(p.team) && !p.manual);
export function voteProgress(s, players) {
  const V = voteOf(s);
  const ids = new Set(voteVoters(players).map((p) => p.id));
  const cast = Object.keys(V.votes || {}).filter((id) => ids.has(id)).length;
  return { cast, total: ids.size, all: ids.size > 0 && cast >= ids.size };
}
// Tally once revealed: [{ pid, name, votes }] best first; winners share the top count.
export function voteResults(s) {
  const V = voteOf(s);
  const count = {};
  for (const pid of V.candidates) count[pid] = 0;
  for (const pick of Object.values(V.votes || {})) if (pick in count) count[pick]++;
  const rows = V.candidates.map((pid) => ({ pid, name: V.names[pid] || "?", votes: count[pid] }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const top = rows.length ? rows[0].votes : 0;
  return { rows, winners: top > 0 ? rows.filter((r) => r.votes === top) : [] };
}
export function voteSetup(s, _p, ctx) {
  if (s.phase !== "over") return fail("The sweater vote starts once Jeopardy is over.");
  const players = (ctx.players || []).filter((p) => TEAMS.includes(p.team));
  const names = {};
  for (const p of players) names[p.id] = p.name;
  return builder(s, ctx).field("vote", { ...freshVote(), stage: "setup", candidates: players.map((p) => p.id), names, last: voteOf(s).last || null }).done();
}
export function voteToggle(s, { pid }, ctx) {
  const V = voteOf(s);
  if (V.stage !== "setup") return null;
  const p = (ctx.players || []).find((x) => x.id === pid);
  if (V.candidates.includes(pid)) return builder(s, ctx).field("vote", { ...V, candidates: V.candidates.filter((x) => x !== pid) }).done();
  if (!p) return null;
  return builder(s, ctx).field("vote", { ...V, candidates: [...V.candidates, pid], names: { ...V.names, [pid]: p.name } }).done();
}
export function voteOpen(s, _p, ctx) {
  const V = voteOf(s);
  if (V.stage !== "setup") return null;
  const live = new Set((ctx.players || []).map((p) => p.id));
  const candidates = V.candidates.filter((pid) => live.has(pid));
  if (candidates.length < 2) return fail("Pick at least two people who can win.");
  return builder(s, ctx).field("vote", { ...V, candidates, votes: {}, stage: "open", openedAt: ctx.now }).sfx("pick").done();
}
export function castVote(s, { voter, pick }, ctx) {
  const V = voteOf(s);
  if (V.stage !== "open") return fail("Voting is closed.");
  if (!V.candidates.includes(pick)) return null;
  if (voter === pick) return fail("Nice try! You can't vote for your own sweater. 😄");
  if (!voteVoters(ctx.players).some((p) => p.id === voter)) return fail("Join the game first to vote.");
  const next = { ...V, votes: { ...V.votes, [voter]: pick } };
  const b = builder(s, ctx);
  if (voteProgress({ vote: next }, ctx.players).all) return b.field("vote", { ...next, stage: "reveal" }).sfx("win").done();
  return b.field("vote", next).done();
}
// Show the results now (everyone's in, or the host doesn't want to wait for stragglers).
export function voteReveal(s, _p, ctx) {
  const V = voteOf(s);
  if (V.stage !== "open") return null;
  return builder(s, ctx).field("vote", { ...V, stage: "reveal" }).sfx("win").done();
}
export function voteBack(s, _p, ctx) {
  const V = voteOf(s);
  if (V.stage === "off") return null;
  if (V.stage === "open") return builder(s, ctx).field("vote", { ...V, stage: "setup", votes: {}, openedAt: null }).done();
  // Back to the final scores: the winner keeps their crown in the night's awards.
  const last = V.stage === "reveal" ? voteResults(s).winners.map((w) => ({ pid: w.pid, name: w.name, votes: w.votes })) : V.last || null;
  return builder(s, ctx).field("vote", { ...freshVote(), last }).done();
}

// =================================================================
// The night's awards
// =================================================================
// What each player did tonight, keyed by player id. Question results come from the score
// history (so Undo takes them back too); mini-game wins and drawings from the mini games.
export function playerStats(s) {
  const st = {};
  const row = (pid, name, team) => {
    if (!st[pid]) st[pid] = { pid, name: name || "?", team: team || null, right: 0, wrong: 0, unanswered: 0, earned: 0, fast: null, minis: 0, drawing: null };
    return st[pid];
  };
  for (const h of (s && s.history) || []) {
    if (h.kind !== "clue" || !h.pid) continue;
    const r = row(h.pid, h.who, h.team);
    if (h.delta > 0) { r.right++; r.earned += h.delta; } else { r.wrong++; if (h.why === "time") r.unanswered++; }
    if (Number.isFinite(h.ms)) r.fast = r.fast == null ? h.ms : Math.min(r.fast, h.ms);
  }
  for (const g of minisOf(s).list) {
    for (const m of g.matches || []) {
      if (m.all) {
        // Blind drawing: the best drawing of each round counts as a win.
        const ranked = drawRanking(m).filter((d) => d.score != null);
        for (const d of ranked) { const r = row(d.id, d.name, d.team); r.drawing = Math.max(r.drawing == null ? -1 : r.drawing, d.score); }
        if (m.winner && ranked.length) for (const d of ranked.filter((x) => x.score === ranked[0].score)) row(d.id, d.name, d.team).minis++;
        continue;
      }
      const p = m.winner === "team1" ? m.p1 : m.winner === "team2" ? m.p2 : null;
      if (p && p.id) row(p.id, p.name, m.winner).minis++;
    }
    // "Everyone at once": whoever won it for their team.
    const by = g.result && g.result.by;
    if (by && by.pid) row(by.pid, by.name, by.team).minis++;
    if (g.type === "best" && g.mode !== "draw" && (g.entries || []).length) {
      const top = miniStanding(g).sorted[0];
      if (top && top.pid) row(top.pid, top.name, top.team).minis++;
    }
  }
  return st;
}
// The awards, best first: { id, icon, title, detail, winners: [{ pid, name, team }] }.
// (The North Pole Awards: Head Elf, Fastest Reindeer, …) Only awards somebody actually earned are listed (and not when more than 3 people tie —
// then it isn't much of an award).
// Every award, in the order they're revealed. The host can switch any of them off, and
// say which ones come with a 🎟 scratch-it (⚙ Settings → Game → North Pole Awards).
export const AWARDS = [
  { id: "brain", icon: "🧝", title: "Head Elf", about: "most right answers" },
  { id: "fast", icon: "🦌", title: "Fastest Reindeer", about: "quickest winning buzz" },
  { id: "earn", icon: "💰", title: "Christmas Bonus", about: "most money won" },
  { id: "minis", icon: "🏆", title: "North Pole Champ", about: "most mini-game wins" },
  { id: "art", icon: "🎨", title: "Santa's Sketch Artist", about: "best Blind Drawing" },
  { id: "bold", icon: "🪨", title: "Naughty List", about: "most wrong or unanswered" },
  { id: "sweater", icon: "🧶", title: "Ugliest Sweater", about: "the vote" },
];
export const awardById = (id) => AWARDS.find((a) => a.id === id) || null;
export const awardOn = (s, id) => !(((s && s.settings && s.settings.awardsOff) || []).includes(id));
export const awardPrize = (s, id) => ((s && s.settings && s.settings.awardPrize) || []).includes(id);
// Switch an award off, or say its winner gets a scratch-it.
export function setAward(s, { id, on, prize }, ctx) {
  if (!awardById(id)) return null;
  const st = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  const next = { ...st };
  if (on !== undefined) next.awardsOff = on ? (st.awardsOff || []).filter((x) => x !== id) : [...new Set([...(st.awardsOff || []), id])];
  if (prize !== undefined) next.awardPrize = prize ? [...new Set([...(st.awardPrize || []), id])] : (st.awardPrize || []).filter((x) => x !== id);
  return builder(s, ctx).field("settings", next).done();
}

export function nightAwards(s) {
  const rows = Object.values(playerStats(s));
  const out = [];
  // One person can win several — being the Head Elf doesn't rule you out of anything else.
  const add = (id, list, detail) => {
    const a = awardById(id);
    if (!a || !list.length || list.length > 3 || !awardOn(s, id)) return;
    out.push({ id, icon: a.icon, title: a.title, detail, prize: awardPrize(s, id), winners: list.map((r) => ({ pid: r.pid, name: r.name, team: r.team })) });
  };
  const most = (key, min = 1) => {
    const top = Math.max(0, ...rows.map((r) => r[key] || 0));
    return top >= min ? rows.filter((r) => r[key] === top) : [];
  };
  const mon = (n) => "$" + Math.abs(n).toLocaleString("en-US");
  const brain = most("right");
  const brainBest = brain.length > 1 ? brain.filter((r) => r.earned === Math.max(...brain.map((x) => x.earned))) : brain;
  add("brain", brainBest, brain.length ? `${brain[0].right} right answer${brain[0].right === 1 ? "" : "s"}` : "");
  const fastest = Math.min(Infinity, ...rows.filter((r) => r.fast != null).map((r) => r.fast));
  add("fast", Number.isFinite(fastest) ? rows.filter((r) => r.fast === fastest) : [], Number.isFinite(fastest) ? `${(fastest / 1000).toFixed(2)}s buzz` : "");
  const earn = most("earned");
  add("earn", earn, earn.length ? `won ${mon(earn[0].earned)}` : "");
  const mvp = most("minis");
  add("minis", mvp, mvp.length ? `${mvp[0].minis} mini-game win${mvp[0].minis === 1 ? "" : "s"}` : "");
  const art = rows.filter((r) => r.drawing != null);
  const bestArt = Math.max(-1, ...art.map((r) => r.drawing));
  add("art", bestArt > 0 ? art.filter((r) => r.drawing === bestArt) : [], bestArt > 0 ? `${bestArt}% match drawing` : "");
  // A lump of coal for the most wrong or unanswered questions (buzzed in, then ran out of time).
  const coal = most("wrong");
  const coalWhy = (r) => [r.wrong - r.unanswered ? `${r.wrong - r.unanswered} wrong` : "", r.unanswered ? `${r.unanswered} unanswered` : ""].filter(Boolean).join(" · ");
  add("bold", coal, coal.length === 1 ? coalWhy(coal[0]) : coal.length ? `${coal[0].wrong} wrong or unanswered` : "");
  const V = voteOf(s);
  const crowned = V.stage === "reveal" ? voteResults(s).winners : V.last || [];
  if (crowned.length) add("sweater", crowned.map((w) => ({ pid: w.pid, name: w.name, team: null })), `${crowned[0].votes} vote${crowned[0].votes === 1 ? "" : "s"}`);
  return out;
}

// The one person who won a mini game for their whole team — nobody for head-to-head,
// where every matchup has its own winner.
export function miniHero(g) {
  if (!g || g.type === "h2h" || g.status !== "done" || !g.result || !TEAMS.includes(g.result.winner)) return null;
  if (g.result.by) return g.result.by;
  const top = miniStanding(g).sorted[0];
  return top && top.team === g.result.winner ? { pid: top.pid, name: top.name, team: top.team } : null;
}
// Everyone with a 🎟 scratch-it coming to them tonight, and what for.
export function scratchIts(s) {
  const out = [];
  for (const a of nightAwards(s)) {
    if (a.prize) for (const w of a.winners) out.push({ pid: w.pid, name: w.name, team: w.team, what: `${a.icon} ${a.title}` });
  }
  for (const g of minisOf(s).list) {
    if (!g.prize) continue;
    const hero = miniHero(g);
    if (hero) out.push({ pid: hero.pid, name: hero.name, team: hero.team, what: `🏆 ${g.name}` });
  }
  return out;
}


export const ACTIONS = {
  startGame, setControl, startRound2, pickClue, unpickClue, setDDTeam, lockDDWager, openBuzzers,
  autoOpen, pauseBuzzers, claimBuzz, judge, mcqPick, dropChoice, answerSubmitted, answerTimeout, buzzWindowTimeout, nobody,
  revealAnswer, closeClue, adjustScore, setScore, undo, finalStart, finalSetEligible, finalWager,
  finalRevealClue, finalWagerUndo, finalAnswer, finalLock, finalJudge, finalFinish, endGame,
  setTeamName, setSettings, newGame, setLoaded, leaveJeopardy, leaveMinis,
  miniSetTable, miniDrawRound, miniDrawStart, miniDrawCancel, miniDrawSubmitted, miniDrawJudge, voteSetup, voteToggle, voteOpen, castVote, voteReveal, voteBack,
  miniTableAdd, miniTableRemove, setAward, miniTimerStart, miniTimerStop, miniTimerDone, miniAdd, miniUpdate, miniRemove, miniMove, miniReset, minisStart, minisEnd, miniPlay, miniClose,
  miniNext, miniRepick, miniSetPlayer, miniMatch, miniMatchRemove, miniScore, miniEntryRemove, miniFinish,
};
