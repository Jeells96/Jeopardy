// Pure Jeopardy game rules.
//
// Every action is `(state, params, ctx) => change | null`, where
//   ctx    = { now, questions, deviceId }   (now = synced server-clock ms)
//   change = { set: { topLevelField: value, ... }, questions: [{ id, data }], error }
// Actions never mutate `state`. The data layer runs them inside a Firestore transaction,
// so concurrent devices can't double-apply anything (e.g. 50 phones buzzing at once).

export const TEAMS = ["team1", "team2"];
export const otherTeam = (t) => (t === "team1" ? "team2" : "team1");

export const DEFAULT_SETTINGS = {
  answerSeconds: 15,      // time the buzzed-in player has to answer
  buzzWindowSeconds: 0,   // 0 = buzzers stay open until someone buzzes
  readSeconds: 0,         // 0 = host opens buzzers manually; >0 = auto-open after reading time
  finalSeconds: 30,       // Final Jeopardy think time
  autoRebound: true,      // after a miss, instantly reopen buzzers for the other team
  finalNeedsPositive: true, // official rule: only teams with $1+ play Final Jeopardy
};

export const LIMITS = {
  answerSeconds: [3, 120], buzzWindowSeconds: [0, 120], readSeconds: [0, 30], finalSeconds: [10, 300],
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
    teamNames: keep.teamNames || { team1: "Team 1", team2: "Team 2" },
    scores: { team1: 0, team2: 0 },
    settings: { ...DEFAULT_SETTINGS, ...(keep.settings || {}) },
    clue: null,
    final: freshFinal(),
    history: [],
    sfx: null,
  };
}

// ---------- question helpers (also used by the UI) ----------
export const roundOf = (q) => (q && q.round === 2 ? 2 : 1);
export const boardClues = (questions, round) =>
  (questions || []).filter((q) => !q.isFinal && roundOf(q) === round);
export const finalClue = (questions) => (questions || []).find((q) => q.isFinal) || null;
export const hasRound2 = (questions) => boardClues(questions, 2).length > 0;
export const roundMaxValue = (questions, round) =>
  boardClues(questions, round).reduce((m, q) => Math.max(m, Number(q.points) || 0), 0);
export const cluesLeft = (questions, round) => boardClues(questions, round).filter((q) => !q.used).length;
export const lockKey = (clue) => (clue ? `${clue.id}:${clue.buzzRound}` : "");

export function ddLimits(state, questions, team) {
  const score = (state.scores && state.scores[team]) || 0;
  const max = Math.max(score, roundMaxValue(questions, state.round) || 1000);
  return { min: Math.min(5, max), max };
}
export function finalMax(state, team) {
  return Math.max(0, (state.scores && state.scores[team]) || 0);
}
export const teamName = (state, t) => (state.teamNames && state.teamNames[t]) || (t === "team1" ? "Team 1" : "Team 2");

// ---------- change-set builder ----------
function builder(state, ctx) {
  const set = {};
  const questions = [];
  let scores = null;
  let history = null;
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
      history.push({ id: rid(), team, delta, why, at: ctx.now, ...meta });
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
  if (!boardClues(ctx.questions, 1).length) return fail("Load your questions first.");
  const ctrl = control === "random" ? TEAMS[Math.floor(Math.random() * 2)] : TEAMS.includes(control) ? control : null;
  return builder(s, ctx)
    .field("phase", "board").field("round", 1).field("control", ctrl)
    .field("clue", null).field("final", freshFinal())
    .sfx("fill").done();
}

export function setControl(s, { team }, ctx) {
  if (!TEAMS.includes(team)) return null;
  return builder(s, ctx).field("control", team).done();
}

export function startRound2(s, _p, ctx) {
  if (!hasRound2(ctx.questions)) return fail("There's no Double Jeopardy round in your questions.");
  const sc = s.scores || {};
  // Official rule: the player in last place picks first in Double Jeopardy.
  const ctrl = sc.team1 === sc.team2 ? s.control : sc.team1 < sc.team2 ? "team1" : "team2";
  return builder(s, ctx)
    .field("phase", "board").field("round", 2).field("control", ctrl).field("clue", null)
    .sfx("fill").done();
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

export function openBuzzers(s, _p, ctx) {
  const c = s.clue;
  if (!c || !["reading", "paused"].includes(c.stage)) return null;
  if (TEAMS.every((t) => c.blocked.includes(t))) return null;
  return builder(s, ctx).field("clue", {
    ...c, stage: "open", buzzRound: c.buzzRound + 1, openedAt: ctx.now, locked: null, mcq: null, timeUp: null,
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
    b.field("clue", { ...base, stage: "open", blocked, locked: null, buzzRound: c.buzzRound + 1, openedAt: ctx.now, timeUp: null, mcq: null });
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

export function answerTimeout(s, { key }, ctx) {
  const c = s.clue;
  if (!c || c.stage !== "answering" || !c.locked || lockKey(c) !== key || c.timeUp === key) return null;
  const secs = (s.settings && s.settings.answerSeconds) || 15;
  if (ctx.now < c.locked.at + secs * 1000 - 60) return null;
  const q = findQ(ctx, c.id);
  if (q && q.type === "mcq") return resolve(s, "timeout", ctx);
  // Spoken answers: flag it and let the host make the call.
  return builder(s, ctx).field("clue", { ...c, timeUp: key }).sfx("timesup").done();
}

export function buzzWindowTimeout(s, { key }, ctx) {
  const c = s.clue;
  const secs = (s.settings && s.settings.buzzWindowSeconds) || 0;
  if (!c || c.stage !== "open" || lockKey(c) !== key || secs <= 0) return null;
  if (ctx.now < c.openedAt + secs * 1000 - 60) return null;
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
  const last = hist.pop();
  if (!last) return null;
  const scores = { ...s.scores, [last.team]: (s.scores[last.team] || 0) - last.delta };
  const b = builder(s, ctx).field("scores", scores).field("history", hist);
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

export function finalRevealClue(s, _p, ctx) {
  const f = s.final;
  if (!f || f.stage !== "wager") return null;
  if (!TEAMS.some((t) => f.eligible[t])) return fail("No team is playing Final Jeopardy — mark at least one team as playing.");
  const wagers = { ...f.wagers };
  for (const t of TEAMS) if (f.eligible[t] && !wagers[t]) wagers[t] = { amount: 0, by: "(no wager)", at: ctx.now };
  const secs = (s.settings && s.settings.finalSeconds) || 30;
  return builder(s, ctx).field("final", { ...f, wagers, stage: "clue", deadline: ctx.now + secs * 1000 }).done();
}

export function finalAnswer(s, { team, text, by }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "clue" || !TEAMS.includes(team) || !f.eligible[team]) return null;
  if (ctx.now > f.deadline + 1500) return fail("Time's up — answers are locked.");
  return builder(s, ctx).field("final", {
    ...f, answers: { ...f.answers, [team]: { text: String(text || "").trim().slice(0, 200), by: String(by || "").slice(0, 40), at: ctx.now } },
  }).done();
}

export function finalLock(s, { force } = {}, ctx) {
  const f = s.final;
  if (!f || f.stage !== "clue") return null;
  if (!force && ctx.now < f.deadline - 60) return null;
  return builder(s, ctx).field("final", { ...f, stage: "reveal" }).sfx("timesup").done();
}

export function finalShowAnswer(s, { team }, ctx) {
  const f = s.final;
  if (!f || f.stage !== "reveal" || !TEAMS.includes(team) || f.shown[team].answer) return null;
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
export function setTeamName(s, { team, name }, ctx) {
  if (!TEAMS.includes(team)) return null;
  const clean = String(name || "").trim().slice(0, 24) || (team === "team1" ? "Team 1" : "Team 2");
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
  const b = builder(s, ctx);
  for (const [k, v] of Object.entries(fresh)) b.field(k, v);
  return b.done();
}

export const ACTIONS = {
  startGame, setControl, startRound2, pickClue, unpickClue, setDDTeam, lockDDWager, openBuzzers,
  autoOpen, pauseBuzzers, claimBuzz, judge, mcqPick, answerTimeout, buzzWindowTimeout, nobody,
  revealAnswer, closeClue, adjustScore, setScore, undo, finalStart, finalSetEligible, finalWager,
  finalRevealClue, finalAnswer, finalLock, finalShowAnswer, finalJudge, finalFinish, endGame,
  setTeamName, setSettings, newGame,
};
