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
    dd: q.dailyDouble ? { team: s.control || null, wager: null } : null,
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
  return builder(s, ctx).field("clue", { ...c, dd: { ...c.dd, team } }).done();
}

export function lockDDWager(s, { team, wager }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "dd") return null;
  if (!TEAMS.includes(team)) return fail("Choose which team found the Daily Double.");
  const { min, max } = ddLimits(s, ctx.questions, team);
  const w = Math.round(Number(wager));
  if (!Number.isFinite(w) || w < min || w > max) return fail(`Daily Double wager must be between $${min} and $${max}.`);
  return builder(s, ctx)
    .field("control", team)
    .field("clue", {
      ...c, stage: "answering", dd: { team, wager: w },
      locked: { deviceId: "dd", name: teamName(s, team), team, at: ctx.now },
    }).done();
}

const reboundMs = (s) => ((s.settings && s.settings.reboundSeconds) || 30) * 1000;
// When the open buzzers close by themselves: a rebound always has a time limit; the first
// open only if a buzz-in window is set.
export function buzzDeadline(c, settings) {
  if (!c || c.stage !== "open") return null;
  if (c.windowUntil) return c.windowUntil;
  const secs = (settings && settings.buzzWindowSeconds) || 0;
  return secs > 0 ? c.openedAt + secs * 1000 : null;
}
export function openBuzzers(s, _p, ctx) {
  const c = s.clue;
  if (!c || !["reading", "paused"].includes(c.stage)) return null;
  if (TEAMS.every((t) => c.blocked.includes(t))) return null;
  return builder(s, ctx).field("clue", {
    ...c, stage: "open", buzzRound: c.buzzRound + 1, openedAt: ctx.now, locked: null, mcq: null, timeUp: null,
    windowUntil: c.blocked.length ? ctx.now + reboundMs(s) : null,
  }).done();
}

export function autoOpen(s, { pickedAt }, ctx) {
  const c = s.clue;
  const secs = (s.settings && s.settings.readSeconds) || 0;
  if (!c || c.stage !== "reading" || c.pickedAt !== pickedAt || secs <= 0) return null;
  if (ctx.now < c.pickedAt + secs * 1000 - 60) return null;
  return openBuzzers(s, {}, ctx);
}

export function pauseBuzzers(s, _p, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "open") return null;
  return builder(s, ctx).field("clue", { ...c, stage: "paused" }).done();
}

export function claimBuzz(s, { me, buzzRound, pun }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "open" || c.buzzRound !== buzzRound) return null;
  if (!me || !TEAMS.includes(me.team) || c.blocked.includes(me.team)) return null;
  return builder(s, ctx).field("clue", {
    ...c, stage: "answering",
    locked: { deviceId: me.deviceId, name: me.name, team: me.team, at: ctx.now },
    pun: pun || null, timeUp: null, mcq: null,
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
    b.field("clue", { ...base, stage: "open", blocked, locked: null, buzzRound: c.buzzRound + 1, openedAt: ctx.now, timeUp: null, mcq: null, submitted: null, windowUntil: ctx.now + reboundMs(s) });
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
  const secs = (s.settings && s.settings.answerSeconds) || 15;
  if (ctx.now < c.locked.at + secs * 1000 - 60) return null;
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
  return builder(s, ctx).score(team, Math.round(Number(delta)), "manual", { kind: "manual" }).done();
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
function blankProgress() {
  return { status: "pending", matches: [], entries: [], turn: null, played: { team1: [], team2: [] }, result: null };
}

function cleanMini(src) {
  const type = src.type === "best" ? "best" : "h2h";
  const pts = Math.round(Number(src.points));
  return {
    name: String(src.name == null ? "" : src.name).replace(/\s+/g, " ").trim().slice(0, 40) || "Mini game",
    type,
    points: src.points === "" || src.points == null || !Number.isFinite(pts) ? 500 : clamp(pts, [0, 100000]),
    award: type === "h2h" && src.award === "match" ? "match" : "game", // points for the game, or per matchup win
    better: src.better === "low" ? "low" : "high",                     // best: highest or lowest score wins
    unit: String(src.unit == null ? "" : src.unit).trim().slice(0, 16),
    desc: String(src.desc == null ? "" : src.desc).trim().slice(0, 240),
    table: String(src.table == null ? "" : src.table).trim().slice(0, 24), // "" = any table (drawn each time)
  };
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

// The pick currently on screen (a matchup or a turn) and when it was made.
export function currentPick(s) {
  const M = minisOf(s);
  const g = M.current ? M.list.find((x) => x.id === M.current) : null;
  if (!g || g.status !== "active") return null;
  if (g.type === "h2h") {
    const m = openMatch(g);
    if (!m) return null;
    const sides = [m.p1, m.p2].filter(Boolean);
    return {
      type: "h2h",
      key: m.id + sides.map((p) => ":" + p.id + "@" + p.at).join(""),
      at: sides.reduce((t, p) => Math.max(t, p.at || 0), 0),
      pids: sides.map((p) => p.id),
      names: [m.p1 ? m.p1.name : null, m.p2 ? m.p2.name : null],
      table: m.table || null, summon: m.summon == null ? null : m.summon,
    };
  }
  if (!g.turn) return null;
  return { type: "best", key: g.turn.id, at: g.turn.at || 0, pids: [g.turn.pid], names: [g.turn.name], table: g.turn.table || null, summon: g.turn.summon == null ? null : g.turn.summon };
}

// Everyone on both teams has had a go in this game.
export function miniEveryonePlayed(g, players) {
  const seen = new Set();
  for (const m of g.matches || []) if (m.winner) { if (m.p1) seen.add(m.p1.id); if (m.p2) seen.add(m.p2.id); }
  for (const e of g.entries || []) seen.add(e.pid);
  const all = (players || []).filter((p) => TEAMS.includes(p.team));
  return all.length > 0 && all.every((p) => seen.has(p.id));
}

const teamPlayers = (ctx, team) => (ctx.players || []).filter((p) => p.team === team);
const random = (ctx) => (ctx.rand || Math.random)();

// Random player from a team: nobody repeats until the whole team has had a turn.
function choose(ctx, team, played, avoid = []) {
  const all = teamPlayers(ctx, team);
  if (!all.length) return null;
  let pool = all.filter((p) => !played.includes(p.id) && !avoid.includes(p.id));
  if (!pool.length) pool = all.filter((p) => !avoid.includes(p.id)); // whole team has been — start a new cycle
  if (!pool.length) pool = all;                                      // a team of one
  const p = pool[Math.floor(random(ctx) * pool.length)];
  return { id: p.id, name: p.name, at: ctx.now };
}
function markPlayed(played, team, pid, ctx) {
  if (!pid) return played;
  const cur = played[team] || [];
  if (!cur.includes(pid)) return { ...played, [team]: [...cur, pid] };
  const everyone = teamPlayers(ctx, team).every((p) => cur.includes(p.id));
  return everyone ? { ...played, [team]: [pid] } : played;
}
function lastSide(g, key) {
  for (let i = g.matches.length - 1; i >= 0; i--) if (g.matches[i][key]) return g.matches[i][key].id;
  return null;
}
function pickTurn(g, ctx, replacing) {
  const has = TEAMS.filter((t) => teamPlayers(ctx, t).length);
  if (!has.length) return null;
  let team;
  if (replacing && teamPlayers(ctx, replacing.team).length > 1) {
    team = replacing.team; // swap in a teammate
  } else {
    const fresh = has.filter((t) => teamPlayers(ctx, t).some((p) => !g.played[t].includes(p.id)));
    const cands = fresh.length ? fresh : has;
    const last = g.entries.length ? g.entries[g.entries.length - 1].team : null;
    team = cands.length === 1 ? cands[0] : last ? otherTeam(last) : TEAMS[Math.floor(random(ctx) * 2)];
  }
  const lastPid = g.entries.length ? g.entries[g.entries.length - 1].pid : null;
  const p = choose(ctx, team, g.played[team], [replacing ? replacing.pid : null, lastPid]);
  return { id: rid(), pid: p.id, name: p.name, team, at: ctx.now };
}
const withList = (s, list, extra = {}) => ({ ...minisOf(s), list, ...extra });
// Where the drawn player(s) should go, and a summon line that hasn't been used lately.
// With no tables set up there's nothing to say. keep: the table to stay at (a re-draw).
function placeFor(s, g, ctx, keep) {
  const M = minisOf(s);
  const tables = M.tables || [];
  if (!tables.length) return { where: {}, extra: {} };
  const table = keep && tables.includes(keep) ? keep : tables.includes(g.table) ? g.table : tables[Math.floor(random(ctx) * tables.length)];
  const recent = M.recent || [];
  let pool = SUMMONS.map((_, i) => i).filter((i) => !recent.includes(i));
  if (!pool.length) pool = SUMMONS.map((_, i) => i);
  const summon = pool[Math.floor(random(ctx) * pool.length)];
  return { where: { table, summon }, extra: { recent: [...recent, summon].slice(-Math.min(24, SUMMONS.length - 1)) } };
}
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
  const next = cleanMini({ ...g, ...patch });
  if (started && (next.type !== g.type || next.award !== g.award)) return fail("That game has already started — reset it before changing how it's played.");
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
export function miniNext(s, { id }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active") return null;
  if (g.type === "h2h") {
    if (openMatch(g)) return null;
    const m = {
      id: rid(), winner: null, at: ctx.now,
      p1: choose(ctx, "team1", g.played.team1, [lastSide(g, "p1")]),
      p2: choose(ctx, "team2", g.played.team2, [lastSide(g, "p2")]),
    };
    const pl = placeFor(s, g, ctx);
    Object.assign(m, pl.where);
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: [...x.matches, m] })), pl.extra))
      .sfx(m.p1 || m.p2 ? "pick" : "buzz").done();
  }
  if (g.turn) return null;
  const turn = pickTurn(g, ctx, null);
  if (!turn) return fail("No players yet. Add them in ⚙ Settings → Players, or just finish the game and choose the winner.");
  const pl = placeFor(s, g, ctx);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, turn: { ...turn, ...pl.where } })), pl.extra)).sfx("pick").done();
}
export function miniRepick(s, { id, team }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active") return null;
  if (g.type === "h2h") {
    const m = openMatch(g);
    if (!m) return null;
    const next = { ...m };
    for (const t of TEAMS.includes(team) ? [team] : TEAMS) {
      const key = t === "team1" ? "p1" : "p2";
      next[key] = choose(ctx, t, g.played[t], [m[key] ? m[key].id : null]);
    }
    const pl = placeFor(s, g, ctx, m.table);
    Object.assign(next, pl.where);
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: x.matches.map((y) => (y.id === m.id ? next : y)) })), pl.extra))
      .sfx("pick").done();
  }
  if (!g.turn) return null;
  const turn = pickTurn(g, ctx, g.turn);
  if (!turn) return null;
  const pl = placeFor(s, g, ctx, g.turn.table);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, turn: { ...turn, ...pl.where } })), pl.extra)).sfx("pick").done();
}
// Host sends the current draw to a particular table.
export function miniSetTable(s, { id, table }, ctx) {
  const g = miniById(s, id);
  const tables = minisTables(s);
  if (!g || g.status !== "active" || !tables.includes(table)) return null;
  const summon = (x) => (x.summon == null ? Math.floor(random(ctx) * SUMMONS.length) : x.summon);
  if (g.type === "h2h") {
    const m = openMatch(g);
    if (!m || m.table === table) return null;
    const next = { ...m, table, summon: summon(m) };
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: x.matches.map((y) => (y.id === m.id ? next : y)) })))).done();
  }
  if (!g.turn || g.turn.table === table) return null;
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, turn: { ...x.turn, table, summon: summon(x.turn) } })))).done();
}

// Host hand-picks who's up instead of the random draw.
export function miniSetPlayer(s, { id, team, pid }, ctx) {
  const g = miniById(s, id);
  const p = (ctx.players || []).find((x) => x.id === pid);
  if (!g || g.status !== "active" || !p || !TEAMS.includes(p.team)) return null;
  if (g.type === "h2h") {
    const m = openMatch(g);
    if (!m || p.team !== team) return null;
    const key = team === "team1" ? "p1" : "p2";
    const next = { ...m, [key]: { id: p.id, name: p.name, at: 0 } };
    return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, matches: x.matches.map((y) => (y.id === m.id ? next : y)) })))).done();
  }
  if (!g.turn) return null;
  const turn = { id: rid(), pid: p.id, name: p.name, team: p.team, at: 0 };
  if (g.turn.table) Object.assign(turn, { table: g.turn.table, summon: g.turn.summon });
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, turn })))).done();
}

// ---------- results ----------
export function miniMatch(s, { id, winner }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || g.type !== "h2h" || !["team1", "team2", "tie"].includes(winner)) return null;
  const m = openMatch(g);
  if (!m) return null;
  let played = g.played;
  if (m.p1) played = markPlayed(played, "team1", m.p1.id, ctx);
  if (m.p2) played = markPlayed(played, "team2", m.p2.id, ctx);
  const b = builder(s, ctx);
  if (g.award === "match" && winner !== "tie" && g.points) b.score(winner, g.points, "mini", { kind: "mini", miniId: g.id, matchId: m.id });
  b.field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, matches: x.matches.map((y) => (y.id === m.id ? { ...y, winner } : y)) }))));
  return b.sfx(winner === "tie" ? "buzz" : "correct").done();
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
export function miniScore(s, { id, score }, ctx) {
  const g = miniById(s, id);
  if (!g || g.status !== "active" || g.type !== "best" || !g.turn) return null;
  const v = typeof score === "string" && score.trim() === "" ? NaN : Number(score);
  if (score == null || !Number.isFinite(v)) return fail("Type their score as a number first.");
  const t = g.turn;
  const entry = { id: rid(), pid: t.pid, name: t.name, team: t.team, score: Math.round(v * 100) / 100, at: ctx.now };
  const played = markPlayed(g.played, t.team, t.pid, ctx);
  return builder(s, ctx).field("minis", withList(s, mapMini(s, id, (x) => ({ ...x, played, turn: null, entries: [...x.entries, entry] }))))
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
  const done = (x) => ({ ...x, status: "done", turn: null, matches: x.matches.filter((m) => m.winner), result: { winner: w, team1: got.team1, team2: got.team2 } });
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
  miniSetTable, voteSetup, voteToggle, voteOpen, castVote, voteReveal, voteBack,
  miniTables, miniAdd, miniUpdate, miniRemove, miniMove, miniReset, minisStart, minisEnd, miniPlay, miniClose,
  miniNext, miniRepick, miniSetPlayer, miniMatch, miniMatchRemove, miniScore, miniEntryRemove, miniFinish,
};
