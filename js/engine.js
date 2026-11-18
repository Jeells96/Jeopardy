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
  buzzWindowSeconds: 0,   // 0 = buzzers stay open until someone buzzes
  reboundSeconds: 30,     // after a miss, the other team gets this long to buzz in
  readSeconds: 0,         // 0 = host opens buzzers manually; >0 = auto-open after reading time
  finalSeconds: 31,       // Final Jeopardy think time (the length of the think music)
  autoRebound: true,      // after a miss, instantly reopen buzzers for the other team
  finalNeedsPositive: true, // official rule: only teams with $1+ play Final Jeopardy
  playersRename: true,    // players may rename their own team before Jeopardy starts
  announce: true,         // mini games: read "who's up next" out loud on the screen with sound on
};

export const DEFAULT_NAMES = { team1: "Husbands", team2: "Wives" };

export const LIMITS = {
  answerSeconds: [3, 120], buzzWindowSeconds: [0, 120], reboundSeconds: [5, 120], readSeconds: [0, 30], finalSeconds: [10, 300],
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
    controlBy: null, // who on that team earned the pick (last right answer) — they wager on a Daily Double
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
  if (old.jStarted === undefined) patch.jStarted = !["lobby", "minis"].includes(old.phase);
  const names = modernNames(old.teamNames || {});
  if (JSON.stringify(names) !== JSON.stringify(old.teamNames || {})) patch.teamNames = names;
  if (!old.settings || old.settings.playersRename === undefined) patch.settings = { ...DEFAULT_SETTINGS, ...(old.settings || {}) };
  // The old 30-second default becomes the length of the Final Jeopardy song.
  if (old.settings && old.settings.finalSeconds === 30 && !old.settings.finalSong) patch.settings = { ...(patch.settings || old.settings), finalSeconds: 31, finalSong: true };
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
export const lockKey = (clue) => (clue ? `${clue.id}:${clue.buzzRound}` : "");

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
      while (history.length > 150) history.shift();
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
    .field("phase", "board").field("round", 1).field("control", ctrl).field("controlBy", null).field("jStarted", true)
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
  return builder(s, ctx).field("control", team).field("controlBy", null).done();
}
// How long the person who buzzed in has to answer — twice as long on a Daily Double.
export const answerMs = (c, settings) => ((settings && settings.answerSeconds) || 15) * 1000 * (c && c.dd ? 2 : 1);
// The player on `team` who wagers on a Daily Double: whoever earned the pick.
const ddWagerer = (s, team) => (s.controlBy && s.controlBy.team === team ? s.controlBy : null);

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
    dd: q.dailyDouble ? { team: s.control || null, wager: null, by: ddWagerer(s, s.control) } : null,
    buzzRound: 0,
    openedAt: null,
    locked: null,       // { deviceId, name, team, at }
    blocked: [],        // teams that already missed this clue
    eliminated: [],     // wrong multiple-choice options already picked
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

export function unpickClue(s, _p, ctx) {
  const c = s.clue;
  if (!c || c.buzzRound > 0 || !["reading", "dd"].includes(c.stage)) return null;
  return builder(s, ctx).field("phase", "board").field("clue", null).q(c.id, { used: false }).done();
}

export function setDDTeam(s, { team }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "dd" || !TEAMS.includes(team)) return null;
  return builder(s, ctx).field("clue", { ...c, dd: { ...c.dd, team, by: ddWagerer(s, team) } }).done();
}

// by: the player entering it on their phone (Jaren can always enter it for them).
export function lockDDWager(s, { team, wager, by }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "dd") return null;
  if (!TEAMS.includes(team)) return fail("Choose which team found the Daily Double.");
  if (by) {
    if (by.team !== team || c.dd.team !== team) return fail("It's the other team's Daily Double.");
    if (c.dd.by && c.dd.by.deviceId !== by.deviceId && (ctx.players || []).some((p) => p.id === c.dd.by.deviceId)) return fail(`${c.dd.by.name} is choosing the wager.`);
  }
  const { min, max } = ddLimits(s, ctx.questions, team);
  const w = Math.round(Number(wager));
  if (!Number.isFinite(w) || w < min || w > max) return fail(`Daily Double wager must be between $${min} and $${max}.`);
  return builder(s, ctx)
    .field("control", team)
    .field("clue", {
      ...c, stage: "answering", dd: { team, wager: w, by: by ? { deviceId: by.deviceId, name: String(by.name || "").slice(0, 20), team } : c.dd.by || null },
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
    order.push({ name: String(b.name || "").slice(0, 20), team: b.team, ms: Math.max(0, Math.round(b.t - c.openedAt)) });
    if (order.length >= 5) break;
  }
  return builder(s, ctx).field("clue", {
    ...c, stage: "answering",
    locked: { deviceId: w.deviceId, name: String(w.name || "").slice(0, 20), team: w.team, at: ctx.now, ms: order[0].ms },
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

  if (outcome === "correct") {
    b.score(team, value, "correct", { kind: "clue", prevControl: s.control || null, qid: c.id });
    b.field("control", team);
    // Whoever answered earns the pick (and wagers if they find a Daily Double).
    b.field("controlBy", c.dd ? (c.dd.by && c.dd.by.team === team ? c.dd.by : ddWagerer(s, team)) : { deviceId: c.locked.deviceId, name: c.locked.name, team });
    b.field("clue", { ...base, stage: "done", result: "correct", winner: team, revealed: true });
    return b.sfx("correct").done();
  }
  if (outcome === "wrong" || outcome === "timeout") {
    b.score(team, -value, outcome === "timeout" ? "time" : "wrong", { kind: "clue", qid: c.id });
    b.sfx(outcome === "timeout" ? "timesup" : "wrong");
  }
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

export function judge(s, { result }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked) return null;
  if (!["correct", "wrong", "skip"].includes(result)) return null;
  return resolve(s, result, ctx);
}

export function mcqPick(s, { index, me }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked || !me) return null;
  const q = findQ(ctx, c.id);
  if (!q || q.type !== "mcq") return null;
  const allowed = c.dd ? me.team === c.dd.team : c.locked.deviceId === me.deviceId;
  if (!allowed || c.eliminated.includes(index)) return null;
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
  // Out of time = wrong: points come off automatically (with the time's-up sound only),
  // and the other team gets a chance to steal.
  return resolve(s, "timeout", ctx);
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
  const secs = (s.settings && s.settings.finalSeconds) || 31;
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

export function finalShowAnswer(s, { team }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "reveal" || !TEAMS.includes(team) || f.shown[team].answer) return null;
  // Multiple-choice Final: scored the moment the answer is revealed.
  const fq = finalClue(ctx.questions);
  if (fq && fq.type === "mcq" && f.eligible[team] && !f.results[team]) {
    const a = f.answers[team];
    const right = fq.choices[fq.correctIndex];
    return finalJudge(s, { team, correct: !!(a && right && a.text.toLowerCase() === String(right).toLowerCase()) }, ctx);
  }
  return builder(s, ctx).field("final", { ...f, shown: { ...f.shown, [team]: { ...f.shown[team], answer: true } } }).done();
}

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
  fresh.minis = { list: minisOf(s).list.map((g) => ({ ...g, ...blankProgress() })), current: null, back: null, tables: minisOf(s).tables || [], recent: [] };
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
// The host can always skip the tracking and simply declare a winner.
// =================================================================
export const SPIN_MS = 1800; // length of the "who's up next?" shuffle animation

export function freshMinis() { return { list: [], current: null, back: null, tables: [], recent: [] }; }
export const minisTables = (s) => minisOf(s).tables || [];
export function minisOf(s) { return (s && s.minis) || freshMinis(); }
export const miniById = (s, id) => minisOf(s).list.find((g) => g.id === id) || null;
export const openMatch = (g) => (g.matches || []).find((m) => !m.winner) || null;
// Matchups still being played (one per table when a game runs at several tables at once).
export const openMatches = (g) => (g.matches || []).filter((m) => !m.winner);
// Best-overall players currently up (one per table). Older saves only had a single `turn`.
export const turnsOf = (g) => (Array.isArray(g.turns) ? g.turns : g.turn ? [g.turn] : []);
const withTurns = (x, turns) => ({ ...x, turns, turn: turns[0] || null });
function blankProgress() {
  return { status: "pending", matches: [], entries: [], turn: null, turns: [], played: { team1: [], team2: [] }, result: null };
}

function cleanMini(src) {
  const type = src.type === "best" ? "best" : "h2h";
  // Blind drawing is a head-to-head game whose winner is judged from the drawings.
  const mode = type === "h2h" && (src.type === "draw" || src.mode === "draw") ? "draw" : "normal";
  const pts = Math.round(Number(src.points));
  return {
    name: String(src.name == null ? "" : src.name).replace(/\s+/g, " ").trim().slice(0, 40) || "Mini game",
    type,
    points: src.points === "" || src.points == null || !Number.isFinite(pts) ? 500 : clamp(pts, [0, 100000]),
    award: type === "h2h" && src.award === "match" ? "match" : "game", // points for the game, or per matchup win
    better: src.better === "low" ? "low" : "high",                     // best: highest or lowest score wins
    unit: String(src.unit == null ? "" : src.unit).trim().slice(0, 16),
    desc: String(src.desc == null ? "" : src.desc).trim().slice(0, 240),
    mode,
    // Blind drawing: the host's pictures (ids of state/drawpic-* docs), used in turn.
    pics: mode === "draw" && Array.isArray(src.pics) ? [...new Set(src.pics.filter((x) => typeof x === "string" && x))].slice(0, 40) : [],
    // How many steps each hand-drawn picture has (ready-made ones know their own steps).
    picSteps: mode === "draw" ? cleanPicSteps(src.picSteps, src.pics) : {},
    stepSeconds: clamp(Math.round(Number(src.stepSeconds)) || 20, [5, 120]), // a new step every this many seconds
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
  if (!g || g.status !== "active" || g.mode === "draw") return null; // blind drawing: everyone draws, nobody is picked
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
const random = (ctx) => (ctx.rand || Math.random)();

// Random player from a team: nobody repeats until the whole team has had a turn. A player
// leaves the pool the moment they're picked (a re-draw puts them back).
// busy: players already playing at another table right now — never drawn twice at once.
// tonight: who has already played some mini game tonight — everyone else goes first, so
// the whole party gets a turn across the mini games.
function choose(ctx, team, played, avoid = [], busy = [], tonight = []) {
  const all = teamPlayers(ctx, team).filter((p) => !busy.includes(p.id));
  if (!all.length) return null;
  let pool = all.filter((p) => !played.includes(p.id) && !avoid.includes(p.id));
  if (!pool.length) pool = all.filter((p) => !avoid.includes(p.id)); // whole team has been — start a new cycle
  if (!pool.length) pool = all;                                      // a team of one
  const fresh = pool.filter((p) => !tonight.includes(p.id));
  if (fresh.length) pool = fresh;
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
function slotsFor(s) {
  const tables = minisTables(s);
  return tables.length ? tables : [null];
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
const busyIn = (items) => items.flatMap((x) => (x.pid ? [x.pid] : [x.p1 && x.p1.id, x.p2 && x.p2.id].filter(Boolean)));
const mapMini = (s, id, fn) => minisOf(s).list.map((g) => (g.id === id ? fn(g) : g));
const NO_MINIS_NOW = { clue: "Finish the current question first.", final: "Final Jeopardy has already started.", over: "The game is over — start a new game to play mini games." };

// ---------- setup ----------
export function miniAdd(s, { game }, ctx) {
  const M = minisOf(s);
  if (M.list.length >= 20) return fail("That's plenty of mini games! Remove one first.");
  const g = { id: rid(), ...cleanMini(game || {}), ...blankProgress() };
  return builder(s, ctx).field("minis", withList(s, [...M.list, g])).done();
}
export function miniUpdate(s, { id, patch }, ctx) {
  const g = miniById(s, id);
  if (!g || !patch) return null;
  const started = g.status !== "pending" || g.matches.length > 0 || g.entries.length > 0;
  const next = cleanMini({ ...g, ...patch, ...(patch.type === "h2h" ? { mode: "normal" } : {}) });
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

// The tables (stations) mini games are played at. Empty = one spot, nothing to announce.
export function miniTables(s, { tables }, ctx) {
  const seen = new Set();
  const list = [];
  for (const t of Array.isArray(tables) ? tables : String(tables || "").split(/[\n,;]+/)) {
    const v = String(t || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); }
  }
  if (list.length > 8) return fail("Up to 8 tables.");
  return builder(s, ctx).field("minis", { ...minisOf(s), tables: list }).done();
}
// Add / remove a table right from the "who's up next" controls. Tables are numbered;
// going from one spot to two tables adds Table 1 and Table 2.
const MAX_TABLES = 8;
export function miniTableAdd(s, _p, ctx) {
  const tables = minisTables(s);
  if (tables.length >= MAX_TABLES) return fail(`Up to ${MAX_TABLES} tables.`);
  const used = new Set(tables.map((t) => t.toLowerCase()));
  const nextName = () => { for (let n = 1; ; n++) if (!used.has(`table ${n}`)) { used.add(`table ${n}`); return `Table ${n}`; } };
  const list = tables.length ? [...tables, nextName()] : [nextName(), nextName()];
  return builder(s, ctx).field("minis", { ...minisOf(s), tables: list }).done();
}
export function miniTableRemove(s, { table }, ctx) {
  const tables = minisTables(s);
  if (!tables.includes(table)) return null;
  const playing = minisOf(s).list.some((g) => g.status === "active" && [...openMatches(g), ...turnsOf(g)].some((x) => x.table === table));
  if (playing) return fail(`Someone is still playing at ${table} — finish that first.`);
  const left = tables.filter((t) => t !== table);
  // Down to one table = back to playing in one spot (no table to announce).
  return builder(s, ctx).field("minis", { ...minisOf(s), tables: left.length > 1 ? left : [] }).done();
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
    for (const slot of free) {
      const p1 = choose(ctx, "team1", played.team1, [lastSide(g, "p1")], busy, tonight.team1);
      const p2 = choose(ctx, "team2", played.team2, [lastSide(g, "p2")], busy, tonight.team2);
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
    for (const t of TEAMS.includes(team) ? [team] : TEAMS) {
      const key = t === "team1" ? "p1" : "p2";
      const other = t === "team1" ? m.p2 : m.p1;
      const was = m[key] ? m[key].id : null;
      played = unmark(played, t, was); // they didn't get to play after all — back in the pool
      tonight = unmark(tonight, t, was);
      next[key] = choose(ctx, t, played[t], [was], [...busy, ...(other ? [other.id] : [])], tonight[t] || []) || m[key];
      if (next[key]) { played = markPlayed(played, t, next[key].id, ctx); tonight = markPlayed(tonight, t, next[key].id, ctx); }
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
  const tables = minisTables(s);
  if (!g || g.status !== "active" || !tables.includes(table)) return null;
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
  const res = miniMatch(s, { id, matchId: r.id, winner }, ctx);
  if (!res || res.error) return res;
  const minis = res.set.minis;
  res.set.minis = { ...minis, list: minis.list.map((x) => (x.id === id ? { ...x, matches: x.matches.map((y) => (y.id === r.id ? { ...y, done, scores: sc, judged: ctx.now } : y)) } : x)) };
  return res;
}

export function miniMatchRemove(s, { id, matchId }, ctx) {
  const g = miniById(s, id);
  const m = g && g.matches.find((x) => x.id === matchId);
  if (!m) return null;
  if (g.status === "done") return fail("That game is finished — reset it to change the results.");
  const b = builder(s, ctx);
  if (g.award === "match" && m.winner && m.winner !== "tie" && g.points) b.score(m.winner, -g.points, "mini-fix", { kind: "mini-fix", miniId: g.id });
  return b.field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: x.matches.filter((y) => y.id !== matchId) })))).done();
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
// winner: 'team1' | 'team2' | 'tie' (points split) | 'none'. Leave it out to use the standings.
export function miniFinish(s, { id, winner }, ctx) {
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
  const done = (x) => ({ ...x, status: "done", turn: null, turns: [], matches: x.matches.filter((m) => m.winner), result: { winner: w, team1: got.team1, team2: got.team2 } });
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
  return builder(s, ctx).field("vote", { ...freshVote(), stage: "setup", candidates: players.map((p) => p.id), names }).done();
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
  return builder(s, ctx).field("vote", freshVote()).done();
}

export const ACTIONS = {
  startGame, setControl, startRound2, pickClue, unpickClue, setDDTeam, lockDDWager, openBuzzers,
  autoOpen, pauseBuzzers, claimBuzz, judge, mcqPick, answerSubmitted, answerTimeout, buzzWindowTimeout, nobody,
  revealAnswer, closeClue, adjustScore, setScore, undo, finalStart, finalSetEligible, finalWager,
  finalRevealClue, finalWagerUndo, finalAnswer, finalLock, finalShowAnswer, finalJudge, finalFinish, endGame,
  setTeamName, setSettings, newGame, setLoaded, leaveJeopardy, leaveMinis,
  miniSetTable, miniDrawRound, miniDrawStart, miniDrawCancel, miniDrawSubmitted, miniDrawJudge, voteSetup, voteToggle, voteOpen, castVote, voteReveal, voteBack,
  miniTables, miniTableAdd, miniTableRemove, miniAdd, miniUpdate, miniRemove, miniMove, miniReset, minisStart, minisEnd, miniPlay, miniClose,
  miniNext, miniRepick, miniSetPlayer, miniMatch, miniMatchRemove, miniScore, miniEntryRemove, miniFinish,
};
