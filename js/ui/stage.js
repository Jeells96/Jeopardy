// The show-style "stage": board grid, clue card, Daily Double, Final Jeopardy,
// podiums and lobby. Used by the projector board and the host console.
import { esc, money, cls, verb, possessive } from "./util.js";
import * as E from "../engine.js";
import { minisStage } from "./minis.js";

export const tn = (G, t) => E.teamName(G.S || {}, t);
export const findQ = (G, id) => G.Q.find((q) => q.id === id) || null;
export const nowMs = (G) => G.now();

export function roundLabel(S) {
  if (!S) return "";
  if (S.phase === "lobby") return "Get ready!";
  if (S.phase === "minis") return "Mini Games";
  if (S.phase === "final") return "Final Jeopardy!";
  if (S.phase === "over") return S.vote && S.vote.stage !== "off" ? "Ugly sweater vote" : "Final scores";
  return "Jeopardy! Round";
}

export function categories(G, round) {
  const order = [];
  const map = new Map();
  for (const q of E.boardClues(G.Q, round)) {
    if (!map.has(q.category)) { map.set(q.category, []); order.push(q.category); }
    map.get(q.category).push(q);
  }
  return order.map((name) => ({
    name,
    clues: map.get(name).sort((a, b) => (a.points - b.points) || (a.order - b.order)),
  }));
}

export function joinUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

// ---------------------------------------------------------------
export function stage(G, opts = {}) {
  const S = G.S;
  return `<div class="stage${opts.host ? " stage--host" : ""}" data-phase="${S.phase}">
    ${stageTop(G)}
    <div class="stage-main">${stageMain(G, opts)}</div>
    ${podiums(G, opts)}
  </div>`;
}

function stageTop(G) {
  const S = G.S;
  const showCtrl = (S.phase === "board" || S.phase === "clue") && S.control;
  return `<div class="stage-top">
    <div class="brand"><span class="brand-xmas">Christmas</span> <span class="brand-j">JEOPARDY!</span></div>
    <div class="roundtag">${esc(roundLabel(S))}</div>
    <div class="ctrl-slot">${showCtrl ? `<div class="ctrl ${S.control}">🎁 ${esc(tn(G, S.control))} ${verb(tn(G, S.control), "picks", "pick")} next</div>` : ""}</div>
  </div>`;
}

function stageMain(G, opts) {
  const S = G.S;
  if (S.phase === "lobby") return lobby(G);
  if (S.phase === "minis") return minisStage(G, opts);
  if (S.phase === "board") return grid(G, opts);
  if (S.phase === "clue" && S.clue) return clueCard(G);
  if (S.phase === "final") return finalView(G);
  if (S.phase === "over" && S.vote && S.vote.stage !== "off") return voteView(G);
  if (S.phase === "over") return overView(G);
  return grid(G, opts);
}

// ---------------- lobby ----------------
function lobby(G) {
  const url = joinUrl();
  const pretty = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `<div class="lobby">
    <div class="lobby-join">
      <div class="lobby-title">Grab your phone &amp; join!</div>
      <div class="qr" data-keep data-qr="${esc(url)}"></div>
      <div class="join-url">${esc(pretty)}</div>
      <ol class="lobby-steps">
        <li>Scan the code or type the address</li>
        <li>Enter your name &amp; pick a team</li>
        <li>Tap the red buzzer when you know it!</li>
      </ol>
    </div>
    <div class="lobby-teams">${E.TEAMS.map((t) => roster(G, t)).join("")}</div>
  </div>`;
}
function roster(G, t) {
  const ps = G.P.filter((p) => p.team === t);
  return `<div class="roster ${t}">
    <div class="roster-head"><span>${esc(tn(G, t))}</span><span class="roster-count">${ps.length}</span></div>
    <div class="roster-list">${ps.length ? ps.map((p) => `<span class="chip" data-key="p-${esc(p.id)}">${esc(p.name)}</span>`).join("") : `<span class="roster-empty">Waiting for players…</span>`}</div>
  </div>`;
}

// ---------------- board grid ----------------
export function grid(G, opts = {}) {
  const S = G.S;
  const cats = categories(G, S.round);
  if (!cats.length) {
    return `<div class="empty-board"><div class="empty-ico">🎁</div><div>No questions loaded yet.</div><div class="muted">Host: open ⚙ Settings → Questions to import your spreadsheet.</div></div>`;
  }
  const rows = Math.max(...cats.map((c) => c.clues.length));
  const fill = S.sfx && S.sfx.sound === "fill" && G.now() - S.sfx.at < 3500;
  let i = 0;
  let html = `<div class="jgrid${fill ? " filling" : ""}" style="--cols:${cats.length};--rows:${rows}" data-key="grid-${S.gameId}-${S.round}">`;
  for (const c of cats) html += `<div class="jcat"><span>${esc(c.name)}</span></div>`;
  for (let r = 0; r < rows; r++) {
    for (const c of cats) {
      const q = c.clues[r];
      const d = ((i++ * 137) % 900) + 80; // pseudo-random fill-in delay
      if (!q) { html += `<div class="jcell empty"></div>`; continue; }
      const can = opts.pick && !q.used;
      html += `<div class="${cls("jcell", q.used && "used", can && "pick")}" style="--d:${d}ms"${can ? ` data-action="pick" data-id="${esc(q.id)}" role="button" tabindex="0"` : ""}>`
        + (q.used ? "" : `<span class="val">${money(q.points)}</span>${opts.showDD && q.dailyDouble ? `<span class="ddmark">DD</span>` : ""}`)
        + `</div>`;
    }
  }
  return html + `</div>`;
}

// ---------------- clue ----------------
function clueCard(G) {
  const S = G.S;
  const c = S.clue;
  const q = findQ(G, c.id);
  if (!q) return `<div class="clue"><div class="clue-text">Loading question…</div></div>`;
  if (c.stage === "dd") return ddSplash(G, c, q);
  const value = c.dd ? `Daily Double · ${money(c.dd.wager)}` : money(q.points);
  return `<div class="clue${c.dd ? " clue--dd" : ""}" data-key="clue-${esc(c.id)}">
    <div class="clue-head"><span class="clue-cat">${esc(q.category)}</span><span class="clue-val">${esc(value)}</span></div>
    <div class="clue-body">
      <div class="clue-text"><span>${esc(q.question)}</span></div>
      ${q.type === "mcq" ? mcqBoard(c, q) : ""}
    </div>
    <div class="clue-foot">${clueStatus(G, c, q)}</div>
    ${buzzOrder(G, c)}
  </div>`;
}

function mcqBoard(c, q) {
  return `<div class="bmcq n${q.choices.filter(Boolean).length}">${q.choices.map((ch, i) => {
    if (!ch) return "";
    const elim = c.eliminated.includes(i);
    const right = c.revealed && i === q.correctIndex;
    const picked = c.mcq && c.mcq.index === i;
    return `<div class="${cls("bchoice", elim && "elim", right && "right", picked && !right && c.stage === "done" && "wrong")}"><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></div>`;
  }).join("")}</div>`;
}

export function timerLights(deadline, totalMs) {
  return `<div class="lights" data-deadline="${deadline}" data-total="${totalMs}">${"<i></i>".repeat(9)}</div>`;
}

function clueStatus(G, c, q) {
  const S = G.S;
  const set = S.settings || {};
  if (c.stage === "reading") {
    const auto = set.readSeconds > 0 ? ` <span class="cd" data-deadline="${c.pickedAt + set.readSeconds * 1000}" data-format="s"></span>` : "";
    return `<div class="status status--wait">Get ready to buzz…${auto}</div>`;
  }
  if (c.stage === "open" && G.now() < c.openedAt) return `<div class="status status--wait">Get ready…</div>`;
  if (c.stage === "open") {
    const until = E.buzzDeadline(c, set);
    const win = until ? timerLights(until, until - c.openedAt) : "";
    const reb = c.blocked.length ? `<div class="status-sub">${esc(tn(G, E.otherTeam(c.blocked[0])))} can steal it!</div>` : "";
    return `<div class="status status--open">🔔 BUZZERS OPEN</div>${reb}${win}`;
  }
  if (c.stage === "paused") return `<div class="status status--wait">Buzzers paused</div>`;
  if (c.stage === "answering" && c.locked) {
    const L = c.locked;
    const total = E.answerMs(c, set);
    const key = E.lockKey(c);
    const sp = G.spoken && G.spoken.key === key && G.spoken.text ? `<div class="heard">✍️ “${esc(G.spoken.text)}”</div>` : "";
    const tu = c.timeUp === key ? `<div class="status-sub timeup">⏰ Time's up! — Jaren's call</div>` : "";
    const who = c.dd ? `${esc(tn(G, L.team))}` : `${esc(L.name)} <small>${esc(tn(G, L.team))}</small>`;
    const done = c.submitted === key ? `<div class="status-sub">✓ Answer in</div>` : "";
    const fast = !c.dd && Number.isFinite(L.ms) ? `<div class="status-sub">⚡ ${(L.ms / 1000).toFixed(2)}s</div>` : "";
    return `<div class="answerer ${L.team}">${who}</div>${fast}${c.timeUp === key || c.submitted === key ? "" : timerLights(L.at + total, total)}${tu}${done}${sp}`;
  }
  if (c.stage === "done") {
    let banner = "";
    if (c.result === "correct") {
      const who = c.dd ? tn(G, c.winner) : (c.locked ? `${c.locked.name}` : tn(G, c.winner));
      const amt = c.dd ? c.dd.wager : q.points;
      banner = `<div class="result result--yes">✅ ${esc(who)} — ${esc(tn(G, c.winner))} +${money(amt)}</div>`;
    } else if (c.result === "wrong") {
      banner = `<div class="result result--no">❌ ${esc(tn(G, c.dd ? c.dd.team : c.winner || ""))} missed the Daily Double</div>`;
    } else if (c.result === "nobody") {
      banner = `<div class="result result--none">Nobody got it!</div>`;
    } else if (c.result === "skipped") {
      banner = `<div class="result result--none">Question skipped</div>`;
    }
    const ans = c.revealed ? `<div class="answer-reveal"><span>Answer</span>${esc(q.answer)}</div>` : "";
    return banner + ans;
  }
  return "";
}

// Reaction times: how long after the buzzers opened each phone pressed (fastest first).
function buzzOrder(G, c) {
  if (!["answering", "open", "done"].includes(c.stage) || c.dd) return "";
  const rows = c.order && c.order.length ? c.order.map((o, i) => ({ id: "o" + i, ...o }))
    : G.B.filter((b) => Number.isFinite(b.t)).map((b) => ({ id: b.id, name: b.name, team: b.team, ms: Math.max(0, b.t - c.openedAt) }));
  if (!rows.length) return "";
  return `<div class="buzzorder"><div class="bo-head">Fastest buzz</div>${rows.slice(0, 5).map((b, i) =>
    `<div class="bo-row ${b.team}${i === 0 ? " first" : ""}" data-key="bo-${esc(b.id)}"><span class="bo-n">${i + 1}</span><span class="bo-name">${esc(b.name)}</span><span class="bo-dt">${(b.ms / 1000).toFixed(2)}s</span></div>`).join("")}</div>`;
}

function ddSplash(G, c, q) {
  const team = c.dd && c.dd.team;
  return `<div class="dd" data-key="dd-${esc(c.id)}">
    <div class="dd-burst"></div>
    <div class="dd-title"><span>DAILY</span><span>DOUBLE!</span></div>
    <div class="dd-sub">${esc(q.category)}</div>
    <div class="dd-team">${team ? `${esc(tn(G, team))} ${verb(tn(G, team), "is", "are")} making a wager…` : "Who found it?"}</div>
  </div>`;
}

// ---------------- Final Jeopardy ----------------
function finalView(G) {
  const S = G.S;
  const f = S.final;
  const fq = E.finalClue(G.Q);
  const cat = fq ? fq.category : "Final Jeopardy";
  if (f.stage === "wager") {
    return `<div class="final final--cat" data-key="final-cat">
      <div class="final-kicker">Final Jeopardy!</div>
      <div class="final-cat">${esc(cat)}</div>
      <div class="final-teams">${E.TEAMS.map((t) => {
        const st = !f.eligible[t] ? `<span class="fstat out">Sitting out</span>` : f.wagers[t] ? `<span class="fstat ok">Wager locked ✓</span>` : `<span class="fstat wait">Deciding wager…</span>`;
        return `<div class="fteam ${t}"><span>${esc(tn(G, t))}</span>${st}</div>`;
      }).join("")}</div>
    </div>`;
  }
  if (f.stage === "clue") {
    const total = (S.settings.finalSeconds || 62) * 1000;
    return `<div class="clue final--clue" data-key="final-clue">
      <div class="clue-head"><span class="clue-cat">${esc(cat)}</span><span class="clue-val">Final Jeopardy!</span></div>
      <div class="clue-body"><div class="clue-text"><span>${esc(fq ? fq.question : "")}</span></div>
        ${fq && fq.type === "mcq" ? `<div class="bmcq n${fq.choices.filter(Boolean).length}">${fq.choices.map((ch, i) => `<div class="bchoice"><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></div>`).join("")}</div>` : ""}</div>
      <div class="clue-foot">
        <div class="final-clock"><span class="cd" data-deadline="${f.deadline}" data-format="s"></span></div>
        ${timerLights(f.deadline, total)}
        <div class="final-teams small">${E.TEAMS.filter((t) => f.eligible[t]).map((t) => `<div class="fteam ${t}"><span>${esc(tn(G, t))}</span>${f.answers[t] && f.answers[t].text ? `<span class="fstat ok">Answer in ✓</span>` : `<span class="fstat wait">Writing…</span>`}</div>`).join("")}</div>
      </div>
    </div>`;
  }
  // reveal
  const next = f.order.find((t) => f.eligible[t] && !f.results[t]);
  return `<div class="final final--reveal" data-key="final-reveal">
    <div class="final-kicker">Final Jeopardy! · ${esc(cat)}</div>
    ${next ? `<div class="final-next">🤫 Jaren is reading the <b>${esc(possessive(tn(G, next)))}</b> answer…</div>` : ""}
    <div class="reveal-row">${f.order.map((t) => revealPanel(G, t)).join("")}</div>
    ${f.order.every((t) => !f.eligible[t] || f.results[t]) ? `<div class="answer-reveal big"><span>Correct response</span>${esc(fq ? fq.answer : "")}</div>` : ""}
  </div>`;
}
function revealPanel(G, t) {
  const f = G.S.final;
  if (!f.eligible[t]) {
    return `<div class="rpanel ${t} out"><div class="rp-team">${esc(tn(G, t))}</div><div class="rp-ans muted">Sitting out</div></div>`;
  }
  const a = f.answers[t];
  const w = f.wagers[t];
  const res = f.results[t];
  return `<div class="rpanel ${t}${res ? " " + res : ""}" data-key="rp-${t}">
    <div class="rp-team">${esc(tn(G, t))}</div>
    <div class="rp-ans">${f.shown[t].answer ? esc(a && a.text ? a.text : "(no answer)") : `<span class="rp-hidden">?</span>`}</div>
    <div class="rp-wager">${f.shown[t].wager ? `Wager ${money(w ? w.amount : 0)}` : "Wager ???"}</div>
    ${res ? `<div class="rp-res">${res === "correct" ? "✅ Correct!" : "❌ Wrong"}</div>` : ""}
  </div>`;
}

// ---------------- game over ----------------
function overView(G) {
  const sc = G.S.scores || {};
  const tie = sc.team1 === sc.team2;
  const win = sc.team1 > sc.team2 ? "team1" : "team2";
  const conf = Array.from({ length: 70 }, (_, i) => {
    const x = (i * 53) % 100, d = (i * 37) % 30 / 10, s = 6 + (i * 7) % 10, col = ["#ffcf40", "#d7263d", "#139a4b", "#ffffff", "#5ab0ff"][i % 5];
    return `<i style="left:${x}%;animation-delay:-${d}s;width:${s}px;height:${s * 1.6}px;background:${col}"></i>`;
  }).join("");
  const aw = awards(G);
  return `<div class="${cls("over", aw && "awarded")}" data-key="over">
    <div class="confetti" data-keep>${conf}</div>
    <div class="over-kicker">${tie ? "What a finish!" : "Merry Christmas, champions!"}</div>
    <div class="over-title">${tie ? "🤝 It's a tie!" : `🏆 ${esc(tn(G, win))} ${verb(tn(G, win), "wins", "win")}!`}</div>
    <div class="over-scores">${E.TEAMS.map((t) => `<div class="os ${t}${!tie && t === win ? " win" : ""}"><span>${esc(tn(G, t))}</span><b>${money(sc[t])}</b></div>`).join("")}</div>
    ${aw}
  </div>`;
}

// The North Pole Awards (Head Elf, Fastest Reindeer, …), revealed one after another.
export const winnerNames = (G, a) => a.winners.map((w) => ((G.P.find((p) => p.id === w.pid) || {}).name || w.name)).join(" & ");
export function awards(G, { cls: extra = "" } = {}) {
  const list = E.nightAwards(G.S);
  if (!list.length) return "";
  return `<div class="${cls("awards-wrap", extra)}"><div class="aw-head">🌟 The North Pole Awards 🌟</div>
    <div class="${cls("awards", list.length > 4 && "many")}">${list.map((a, i) => `<div class="award" style="animation-delay:${(0.6 + i * 0.45).toFixed(2)}s" data-key="aw-${a.id}">
      <div class="aw-ico">${a.icon}</div><div class="aw-title">${esc(a.title)}</div>
      <div class="${cls("aw-name", a.winners.length === 1 && a.winners[0].team)}">${esc(winnerNames(G, a))}</div><div class="aw-detail">${esc(a.detail)}</div></div>`).join("")}</div></div>`;
}

// ---------------- podiums ----------------
export function podiums(G, opts = {}) {
  const S = G.S;
  const answering = S.clue && S.clue.stage === "answering" && S.clue.locked ? S.clue.locked.team : null;
  return `<div class="podiums">${E.TEAMS.map((t) => {
    const score = (S.scores && S.scores[t]) || 0;
    const count = G.P.filter((p) => p.team === t).length;
    const ctl = (S.phase === "board" || S.phase === "clue") && S.control === t;
    return `<div class="${cls("podium", t, ctl && "has-control", answering === t && "answering")}">
      <div class="${cls("pscore", score < 0 && "neg")}"${opts.host ? ` data-action="score-panel" data-team="${t}" title="Adjust score"` : ""}>${money(score)}</div>
      <div class="pname">${esc(tn(G, t))}</div>
      <div class="pmeta">${count} player${count === 1 ? "" : "s"}${ctl ? " · 🎁 picking next" : ""}</div>
    </div>`;
  }).join("")}</div>`;
}

// ---------------- ugly sweater vote ----------------
function voteView(G) {
  const S = G.S, V = E.voteOf(S);
  if (V.stage === "setup") {
    return `<div class="vote" data-key="vote-setup"><div class="over-kicker">One more contest…</div>
      <div class="over-title">🧶 Ugly Sweater Vote</div><div class="vote-sub">Get your phones ready!</div></div>`;
  }
  if (V.stage === "open") {
    const pr = E.voteProgress(S, G.P);
    const pct = pr.total ? Math.round((pr.cast / pr.total) * 100) : 0;
    return `<div class="vote" data-key="vote-open"><div class="over-kicker">Vote on your phone</div>
      <div class="over-title">🧶 Who has the ugliest sweater?</div>
      <div class="vote-cands">${V.candidates.map((pid) => `<span class="vcand">${esc(V.names[pid] || "?")}</span>`).join("")}</div>
      <div class="vote-bar"><i style="width:${pct}%"></i></div>
      <div class="vote-sub"><b>${pr.cast}</b> of <b>${pr.total}</b> votes in — results stay secret until everyone has voted 🤫</div></div>`;
  }
  const r = E.voteResults(S);
  const max = Math.max(1, ...r.rows.map((x) => x.votes));
  return `<div class="vote" data-key="vote-reveal"><div class="confetti" data-keep>${Array.from({ length: 50 }, (_, i) => `<i style="left:${(i * 53) % 100}%;animation-delay:-${((i * 37) % 30) / 10}s;width:${6 + (i * 7) % 10}px;height:${(6 + (i * 7) % 10) * 1.6}px;background:${["#ffcf40", "#d7263d", "#139a4b", "#ffffff", "#5ab0ff"][i % 5]}"></i>`).join("")}</div>
    <div class="over-kicker">Ugliest sweater of the year</div>
    <div class="over-title">${r.winners.length ? `👑 ${esc(r.winners.map((w) => w.name).join(" & "))}` : "No votes were cast"}</div>
    <div class="vote-rows">${r.rows.slice(0, 8).map((x, i) => `<div class="${cls("vrow", r.winners.some((w) => w.pid === x.pid) && "win")}" style="animation-delay:${0.15 * i}s"><span class="vname">${esc(x.name)}</span><span class="vbar"><i style="width:${Math.round((x.votes / max) * 100)}%"></i></span><b>${x.votes}</b></div>`).join("")}</div></div>`;
}
