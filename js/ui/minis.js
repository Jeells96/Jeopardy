// Mini games UI: big-screen views, the host's next steps, the setup tab,
// the finish dialog, and what players see on their phones.
import { esc, money, cls, verb } from "./util.js";
import * as E from "../engine.js";

const tn = (G, t) => E.teamName(G.S || {}, t);
export const TYPE_LABEL = { h2h: "Head-to-head", best: "Best overall" };
const J = (o) => esc(JSON.stringify(o));
const actAttr = (name, p = {}, extra = {}) => `data-action="act" data-p="${J({ name, p, ...extra })}"`;
const num = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const scoreText = (g, v) => `${num(v)}${g.unit ? " " + esc(g.unit) : ""}`;
const prize = (g) => (g.type === "h2h" && g.award === "match" ? `${money(g.points)} per matchup win` : `${money(g.points)} to the winners`);
const namesOn = (G, team) => G.P.filter((p) => !team || p.team === team).map((p) => p.name);
const currentGame = (M) => (M.current ? M.list.find((x) => x.id === M.current) : null) || null;

// Ideas the host can add with one tap.
export const PRESETS = [
  { name: "Snowball Toss", type: "h2h", desc: "Toss cotton-ball snowballs into a cup from 6 feet. Most in 30 seconds wins the matchup." },
  { name: "Candy Cane Hook", type: "h2h", desc: "Hook candy canes out of a bowl using one held in your mouth — no hands! First to 5 wins." },
  { name: "Ornament Spoon Race", type: "h2h", desc: "Carry an ornament on a spoon across the room and back. Drop it and you start over." },
  { name: "Present Stack", type: "best", better: "high", unit: "boxes", desc: "Stack gift boxes one-handed for 30 seconds. Tallest tower still standing wins." },
  { name: "Speed Wrap", type: "best", better: "low", unit: "seconds", desc: "Wrap a box as fast as you can — every side covered. Fastest time wins." },
  { name: "Reindeer Ring Toss", type: "best", better: "high", unit: "rings", desc: "Five tosses at the antlers. Most rings landed wins." },
];

function resultBits(G, g) {
  const r = g.result;
  if (!r) return null;
  if (r.winner === "tie") return { cls: "tie", text: "🤝 Tie", pts: r.team1 || r.team2 ? `+${money(r.team1)} each` : "" };
  if (r.winner === "none") return { cls: "none", text: "No winner", pts: "" };
  return { cls: r.winner, text: `🏆 ${tn(G, r.winner)}`, pts: r[r.winner] ? `+${money(r[r.winner])}` : "" };
}
function kicker(M, g) {
  const i = M.list.findIndex((x) => x.id === g.id) + 1;
  return `Mini game ${i} of ${M.list.length} · ${TYPE_LABEL[g.type]} · ${prize(g)}`;
}
// A name that shuffles through the candidates, then lands on the pick (driven by app.js tick()).
function spin(names, final, at, extra = "") {
  // --len lets the CSS shrink long names to fit instead of cutting them off.
  return `<span class="${cls("spin", extra)}" style="--len:${Math.max(7, String(final).length)}" data-keep data-spin="${J(names.slice(0, 40))}" data-until="${(at || 0) + E.SPIN_MS}" data-final="${esc(final)}">${esc(final)}</span>`;
}
function matchChip(G, m) {
  const a = m.p1 ? m.p1.name : tn(G, "team1");
  const b = m.p2 ? m.p2.name : tn(G, "team2");
  if (m.winner === "tie") return `<span class="mchip tie">${esc(a)} 🤝 ${esc(b)}</span>`;
  const [w, l] = m.winner === "team1" ? [a, b] : [b, a];
  return `<span class="mchip ${m.winner}"><b>${esc(w)}</b> beat ${esc(l)}</span>`;
}
function isSpinning(G) {
  const pick = E.currentPick(G.S);
  return !!pick && G.now() < pick.at + E.SPIN_MS;
}

// =====================================================================
// Big screen (projector + host console)
// =====================================================================
export function minisStage(G, opts = {}) {
  const M = E.minisOf(G.S);
  const g = currentGame(M);
  if (!g) return hub(G, M, opts);
  if (g.status === "done") return resultView(G, g);
  return g.type === "h2h" ? h2hView(G, M, g) : bestView(G, M, g);
}

function hub(G, M, opts) {
  if (!M.list.length) {
    return `<div class="mhub"><div class="mhub-title">🎯 Mini Games</div><div class="mhub-sub">No mini games set up yet.</div>${opts.pick ? `<div class="muted">Add some in ⚙ Settings → Mini games.</div>` : ""}</div>`;
  }
  const next = M.list.find((g) => g.status === "active") || M.list.find((g) => g.status === "pending");
  const n = M.list.length;
  const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : n <= 12 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const scale = rows <= 2 ? 1 : +(2 / rows).toFixed(2); // shrink everything when there are lots of games
  return `<div class="mhub" data-key="mhub" style="--cols:${cols};--s:${scale}">
    <div class="mhub-title">🎯 Mini Games</div>
    ${rows <= 2 ? `<div class="mhub-sub">${next ? "Win points for your team!" : "That's all of them — great playing!"}</div>` : ""}
    <div class="mcards">${M.list.map((g, i) => {
      const r = resultBits(G, g);
      const tag = r ? `<div class="mc-status ${r.cls}">${esc(r.text)}${r.pts ? ` <b>${r.pts}</b>` : ""}</div>`
        : g.status === "active" ? `<div class="mc-status live">▶ In progress</div>`
        : next && next.id === g.id ? `<div class="mc-status next">Up next</div>` : `<div class="mc-status"></div>`;
      return `<div class="${cls("mcard", g.status, r && "w-" + r.cls, opts.pick && "pick")}" data-key="mc-${esc(g.id)}"${opts.pick ? ` ${actAttr("miniPlay", { id: g.id })} role="button" tabindex="0"` : ""}>
        <div class="mc-num">${i + 1}</div>
        <div class="mc-name">${esc(g.name)}</div>
        <div class="mc-meta">${TYPE_LABEL[g.type]} · ${money(g.points)}${g.type === "h2h" && g.award === "match" ? " a win" : ""}</div>
        ${tag}
      </div>`;
    }).join("")}</div>
  </div>`;
}

function gameHead(M, g) {
  return `<div class="mg-kicker">${esc(kicker(M, g))}</div>
    <div class="${cls("mg-title", g.name.length > 24 && "long")}">${esc(g.name)}</div>
    ${g.desc ? `<div class="mg-desc">${esc(g.desc)}</div>` : ""}`;
}

function h2hView(G, M, g) {
  const st = E.miniStanding(g);
  const m = E.openMatch(g);
  const side = (team, p) => `<div class="vs-side ${team}" data-key="vs-${team}-${p ? esc(p.id) + "-" + p.at : "none"}">
      <small>${esc(tn(G, team))}</small>
      ${p ? spin(namesOn(G, team), p.name, p.at) : `<span class="spin">${esc(tn(G, team))}</span>`}
    </div>`;
  const center = m
    ? `<div class="versus" data-key="match-${esc(m.id)}">${side("team1", m.p1)}<div class="vs-mid">VS</div>${side("team2", m.p2)}</div>`
    : `<div class="mg-wait" data-key="wait-${g.matches.length}">${g.matches.length ? "Who's up next? 🎲" : "Who's up first? 🎲"}</div>`;
  const past = g.matches.filter((x) => x.winner).slice(-5).reverse();
  return `<div class="mgame" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g)}
    ${center}
    <div class="tally">
      <span class="t team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span>
      <span class="t-sep">–</span>
      <span class="t team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span>
    </div>
    <div class="mhistory">${past.map((x) => matchChip(G, x)).join("")}${st.wins.ties ? `<span class="mchip tie">${st.wins.ties} tied</span>` : ""}</div>
  </div>`;
}

function bestView(G, M, g) {
  const st = E.miniStanding(g);
  const t = g.turn;
  const up = t
    ? `<div class="upnext ${t.team}" data-key="turn-${esc(t.id)}"><small>Up now</small>${spin(namesOn(G), t.name, t.at)}<em>${esc(tn(G, t.team))}</em></div>`
    : `<div class="upnext idle" data-key="idle-${g.entries.length}"><small>${g.entries.length ? "Next up" : "First up"}</small><span class="spin">🎲</span><em>${g.better === "low" ? "Lowest" : "Highest"} score wins</em></div>`;
  const rows = st.sorted.slice(0, 8).map((e, i) =>
    `<div class="${cls("lb-row", e.team, i === 0 && "top")}" data-key="lb-${esc(e.id)}"><span class="lb-n">${i === 0 ? "👑" : i + 1}</span><span class="lb-name">${esc(e.name)}</span><span class="lb-team">${esc(tn(G, e.team))}</span><b class="lb-score">${scoreText(g, e.score)}</b></div>`).join("");
  return `<div class="mgame mgame--best" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g)}
    <div class="best-cols">
      ${up}
      <div class="lboard" style="--rows:${Math.max(3, Math.min(8, st.sorted.length))}"><div class="lb-head">Leaderboard${st.sorted.length > 8 ? ` <small>top 8 of ${st.sorted.length}</small>` : ""}</div>${rows || `<div class="lb-empty">No scores yet</div>`}</div>
    </div>
  </div>`;
}

function resultView(G, g) {
  const r = g.result || { winner: "none", team1: 0, team2: 0 };
  const st = E.miniStanding(g);
  const title = r.winner === "tie" ? "🤝 It's a tie!" : r.winner === "none" ? "No winner this time"
    : `🏆 ${esc(tn(G, r.winner))} ${verb(tn(G, r.winner), "wins", "win")}!`;
  let pts = "";
  if (g.award === "match" && (r.team1 || r.team2)) pts = E.TEAMS.map((t) => `${esc(tn(G, t))} +${money(r[t])}`).join(" · ");
  else if (r.winner === "tie" && r.team1) pts = `+${money(r.team1)} each`;
  else if (E.TEAMS.includes(r.winner) && r[r.winner]) pts = `+${money(r[r.winner])}`;
  const detail = g.type === "h2h"
    ? (g.matches.length ? `${esc(tn(G, "team1"))} ${st.wins.team1} – ${st.wins.team2} ${esc(tn(G, "team2"))}` : "")
    : (st.sorted[0] ? `Best: ${esc(st.sorted[0].name)} — ${scoreText(g, st.sorted[0].score)}` : "");
  return `<div class="mresult w-${r.winner}" data-key="mr-${esc(g.id)}">
    <div class="mr-kicker">${esc(g.name)}</div>
    <div class="mr-title">${title}</div>
    ${pts ? `<div class="mr-points">${pts}</div>` : ""}
    ${detail ? `<div class="mr-detail">${detail}</div>` : ""}
  </div>`;
}

// =====================================================================
// Host: what to do next (shared by the console dock and the phone remote)
// =====================================================================
export function miniSteps(G, { privateView = false } = {}) {
  const S = G.S;
  const M = E.minisOf(S);
  const B = [];
  let status = "";
  let panel = "";
  let wantFirstPick = false;
  const btn = (label, action, params = {}, kind = "ghost", key = "") => B.push({ label, action, params, kind, key });
  const act = (name, p = {}) => ({ name, p });
  const g = currentGame(M);
  const hasClues = E.boardClues(G.Q, 1).length > 0;
  const jeopardy = (primary) => {
    const kind = primary ? "primary" : "ghost";
    const key = primary ? "Space" : "";
    if (M.back === "board") btn("↩ Back to Jeopardy", "act", act("minisEnd"), kind, key);
    else if (hasClues && S.jStarted) btn("▶ Resume Jeopardy", "act", act("startGame"), kind, key);
    else if (hasClues && primary) btn("▶ Start Jeopardy!", "act", act("startGame", { control: G.ui.firstPick || "random" }), kind, key);
    else if (hasClues) btn("Skip to Jeopardy", "confirm", { what: "startGame" }, kind, key);
    else btn("📥 Load Jeopardy questions", "drawer", { tab: "questions" }, kind, key);
  };

  // ---- the list of games ----
  if (!g) {
    const done = M.list.filter((x) => x.status === "done").length;
    const next = M.list.find((x) => x.status === "active") || M.list.find((x) => x.status === "pending");
    if (!M.list.length) {
      status = "No mini games yet — add a few, or head straight to Jeopardy.";
      btn("🎯 Add mini games", "drawer", { tab: "minis" }, "primary", "Space");
      jeopardy(false);
    } else if (next) {
      status = `<b>${done}</b> of <b>${M.list.length}</b> played. Next up: <b>${esc(next.name)}</b> <span class="muted">${TYPE_LABEL[next.type]} · ${money(next.points)}</span>`;
      btn(`▶ ${next.status === "active" ? "Continue" : "Play"} “${esc(next.name)}”`, "act", act("miniPlay", { id: next.id }), "primary", "Space");
      jeopardy(false);
      btn("✏️ Edit mini games", "drawer", { tab: "minis" });
    } else {
      status = "All the mini games are done! 🎉";
      wantFirstPick = M.back !== "board" && hasClues;
      jeopardy(true);
      btn("✏️ Edit mini games", "drawer", { tab: "minis" });
    }
    if (M.back !== "board") btn("↩ Back to lobby", "act", act("leaveMinis"));
    return { status, panel, buttons: B, wantFirstPick };
  }

  // ---- a finished game ----
  if (g.status === "done") {
    const r = resultBits(G, g);
    status = `<b>${esc(g.name)}</b> — ${esc(r.text)}${r.pts ? ` <b>${r.pts}</b>` : ""}`;
    btn("↩ Back to the mini games", "act", act("miniClose"), "primary", "Space");
    return { status, panel, buttons: B };
  }

  const st = E.miniStanding(g);
  const spinning = isSpinning(G) && !privateView; // keep the suspense on the mirrored screen
  const everyone = E.miniEveryonePlayed(g, G.P);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];

  // ---- head-to-head ----
  if (g.type === "h2h") {
    const tally = `${esc(n1)} <b>${st.wins.team1}</b> – <b>${st.wins.team2}</b> ${esc(n2)}`;
    const m = E.openMatch(g);
    if (m) {
      const a = m.p1 ? m.p1.name : n1;
      const b = m.p2 ? m.p2.name : n2;
      if (spinning) {
        status = `🎲 Drawing names… <span class="muted">${tally}</span>`;
      } else {
        status = `<b>${esc(a)}</b> vs <b>${esc(b)}</b> — who won? <span class="muted">${tally}</span>`;
        btn(`🏆 ${esc(a)}`, "act", act("miniMatch", { id: g.id, winner: "team1" }), "t1", "1");
        btn(`🏆 ${esc(b)}`, "act", act("miniMatch", { id: g.id, winner: "team2" }), "t2", "2");
        btn("🤝 Tie", "act", act("miniMatch", { id: g.id, winner: "tie" }), "ghost", "T");
        panel = `<div class="mpanel"><span class="muted">Swap a player:</span>${E.TEAMS.map((t) => sidePicker(G, g, t, t === "team1" ? m.p1 : m.p2)).join("")}</div>`;
      }
    } else {
      const played = g.matches.length;
      status = `<b>${esc(g.name)}</b> · ${tally}${st.wins.ties ? ` · ${st.wins.ties} tied` : ""}${everyone ? ` <span class="muted">Everyone's had a turn.</span>` : ""}`;
      btn(played ? "🎲 Next matchup" : "🎲 Who's up first?", "act", act("miniNext", { id: g.id }), everyone ? "ghost" : "primary", everyone ? "" : "Space");
      btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, everyone ? "primary" : "ghost", everyone ? "Space" : "");
      btn("↩ Games list", "act", act("miniClose"));
      if (played) {
        panel = `<div class="mpanel wrap"><span class="muted">Results:</span>${g.matches.filter((x) => x.winner).map((x) =>
          `<span class="echip">${matchChip(G, x)}<button class="x" title="Remove this result" ${actAttr("miniMatchRemove", { id: g.id, matchId: x.id })}>✕</button></span>`).join("")}</div>`;
      }
    }
    return { status, panel, buttons: B };
  }

  // ---- best overall ----
  const top = st.sorted[0];
  const leaderTxt = top ? `Best so far: <b>${esc(top.name)}</b> <span class="muted">(${esc(tn(G, top.team))})</span> ${scoreText(g, top.score)}` : `${g.better === "low" ? "Lowest" : "Highest"} score wins.`;
  if (g.turn) {
    if (spinning) {
      status = `🎲 Drawing a name… <span class="muted">${leaderTxt}</span>`;
    } else {
      status = `<b>${esc(g.turn.name)}</b> <span class="muted">(${esc(tn(G, g.turn.team))})</span> is up — type their score. <span class="muted">${leaderTxt}</span>`;
      btn("✓ Save score", "mini-score", { id: g.id }, "primary", "Space");
      panel = `<div class="mpanel">
        <label class="score-box"><input id="mini-score" class="wager-input" type="number" step="any" inputmode="decimal" placeholder="Score" autocomplete="off" data-sticky>${g.unit ? `<span>${esc(g.unit)}</span>` : ""}</label>
        <span class="mside"><span class="muted">Swap player:</span>${playerSelect(G, g, null, g.turn.pid)}<button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id })} title="Draw someone else">🎲 Someone else</button></span>
      </div>`;
    }
  } else {
    status = `<b>${esc(g.name)}</b> · ${leaderTxt}${everyone ? ` <span class="muted">Everyone's had a turn.</span>` : ""}`;
    btn(g.entries.length ? "🎲 Who's next?" : "🎲 Who's up first?", "act", act("miniNext", { id: g.id }), everyone ? "ghost" : "primary", everyone ? "" : "Space");
    btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, everyone ? "primary" : "ghost", everyone ? "Space" : "");
    btn("↩ Games list", "act", act("miniClose"));
    if (g.entries.length) {
      panel = `<div class="mpanel wrap"><span class="muted">Scores:</span>${st.sorted.map((e) =>
        `<span class="echip"><span class="mchip ${e.team}"><b>${esc(e.name)}</b> ${scoreText(g, e.score)}</span><button class="x" title="Remove this score" ${actAttr("miniEntryRemove", { id: g.id, entryId: e.id })}>✕</button></span>`).join("")}</div>`;
    }
  }
  return { status, panel, buttons: B };
}

function playerSelect(G, g, team, selectedId) {
  const list = G.P.filter((p) => !team || p.team === team);
  const opt = (p) => `<option value="${esc(p.id)}"${p.id === selectedId ? " selected" : ""}>${esc(p.name)}${team ? "" : " — " + esc(tn(G, p.team))}</option>`;
  return `<select class="msel" data-change="mini-player" data-id="${esc(g.id)}"${team ? ` data-team="${team}"` : ""} aria-label="Choose who's up">${list.map(opt).join("")}</select>`;
}
function sidePicker(G, g, team, p) {
  const has = G.P.some((x) => x.team === team);
  if (!has) return `<span class="mside ${team}"><span class="dot ${team}"></span><span class="muted">No ${esc(tn(G, team))} have joined — just pick the winner</span></span>`;
  return `<span class="mside ${team}"><span class="dot ${team}"></span>${playerSelect(G, g, team, p ? p.id : "")}
    <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, team })} title="Draw a different player">🎲</button></span>`;
}

// =====================================================================
// Dialogs
// =====================================================================
export function miniModal(G, m) {
  const g = E.miniById(G.S, m.id);
  if (!g) return "";
  const wrap = (inner) => `<div class="modal-scrim" data-action="modal-close"></div><div class="modal" role="dialog">${inner}</div>`;
  const cancel = (label = "Cancel") => `<button class="btn ghost" data-action="modal-close">${label}</button>`;
  if (m.type === "miniReset") {
    return wrap(`<h3>Reset “${esc(g.name)}”?</h3><p>Its results are cleared and any points it gave out are taken back.</p>
      <div class="btnrow end">${cancel()}<button class="btn primary" ${actAttr("miniReset", { id: g.id }, { then: "modal" })}>Reset game</button></div>`);
  }
  if (m.type === "miniRemove") {
    return wrap(`<h3>Delete “${esc(g.name)}”?</h3><p>The game is removed from the list. Points already awarded stay on the scoreboard.</p>
      <div class="btnrow end">${cancel()}<button class="btn bad" ${actAttr("miniRemove", { id: g.id }, { then: "modal" })}>Delete game</button></div>`);
  }
  // Finish: confirm (or overrule) the winner.
  const st = E.miniStanding(g);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];
  const summary = g.type === "h2h"
    ? (g.matches.some((x) => x.winner) ? `${esc(n1)} <b>${st.wins.team1}</b> – <b>${st.wins.team2}</b> ${esc(n2)}${st.wins.ties ? ` (${st.wins.ties} tied)` : ""}` : "No matchups were recorded — just pick who won.")
    : (st.sorted[0] ? `Best score: <b>${esc(st.sorted[0].name)}</b> (${esc(tn(G, st.sorted[0].team))}) — ${scoreText(g, st.sorted[0].score)}` : "No scores were recorded — just pick who won.");
  if (g.award === "match") {
    return wrap(`<h3>Finish “${esc(g.name)}”?</h3><p>${summary}</p><p class="muted">Points were already given for each matchup win.</p>
      <div class="btnrow end">${cancel("Keep playing")}<button class="btn primary" ${actAttr("miniFinish", { id: g.id }, { then: "modal" })}>🏁 Finish game</button></div>`);
  }
  const half = Math.round(g.points / 2);
  const opt = (winner, label, kind) => {
    const lead = st.leader === winner;
    return `<button class="${cls("btn", kind, "big", lead && "suggested")}" ${actAttr("miniFinish", { id: g.id, winner }, { then: "modal" })}>${label}${lead ? ` <small>★ ${winner === "tie" ? "level" : "leading"}</small>` : ""}</button>`;
  };
  return wrap(`<h3>Who won “${esc(g.name)}”?</h3><p>${summary}</p>
    <div class="finish-opts">
      ${opt("team1", `🏆 ${esc(n1)} · +${money(g.points)}`, "t1")}
      ${opt("team2", `🏆 ${esc(n2)} · +${money(g.points)}`, "t2")}
      ${opt("tie", `🤝 Tie · +${money(half)} each`, "ghost")}
      ${opt("none", "No winner · no points", "ghost")}
    </div>
    <div class="btnrow end">${cancel("Keep playing")}</div>`);
}

// =====================================================================
// Settings → Mini games
// =====================================================================
export function minisTab(G) {
  const M = E.minisOf(G.S);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];
  const field = (g, f) => `data-change="mini-field" data-id="${esc(g.id)}" data-f="${f}" data-key="mf-${esc(g.id)}-${f}"`;
  const cards = M.list.map((g, i) => {
    const r = resultBits(G, g);
    const started = g.status !== "pending" || g.matches.length || g.entries.length;
    const state = r ? `<span class="ms ${r.cls}">${esc(r.text)}${r.pts ? " " + r.pts : ""}</span>` : g.status === "active" ? `<span class="ms live">In progress</span>` : `<span class="ms">Not played yet</span>`;
    return `<div class="minicard" data-key="mini-${esc(g.id)}">
      <div class="mini-row">
        <span class="mini-num">${i + 1}</span>
        <input class="grow" value="${esc(g.name)}" maxlength="40" aria-label="Game name" ${field(g, "name")}>
        <button class="btn ghost sm" ${actAttr("miniMove", { id: g.id, dir: -1 })}${i === 0 ? " disabled" : ""} title="Move up">▲</button>
        <button class="btn ghost sm" ${actAttr("miniMove", { id: g.id, dir: 1 })}${i === M.list.length - 1 ? " disabled" : ""} title="Move down">▼</button>
        <button class="btn bad sm" data-action="mini-remove" data-id="${esc(g.id)}" title="Delete">✕</button>
      </div>
      <div class="mini-row">
        <select aria-label="Type of game" ${field(g, "type")}${started ? " disabled" : ""}>
          <option value="h2h"${g.type === "h2h" ? " selected" : ""}>⚔️ Head-to-head</option>
          <option value="best"${g.type === "best" ? " selected" : ""}>🏅 Best overall</option>
        </select>
        <label class="pts"><span>$</span><input type="number" inputmode="numeric" min="0" step="50" value="${g.points}" aria-label="Points" ${field(g, "points")}></label>
      </div>
      <div class="mini-row">${g.type === "h2h"
        ? `<select class="grow" aria-label="How points are won" ${field(g, "award")}${started ? " disabled" : ""}>
             <option value="game"${g.award === "game" ? " selected" : ""}>Points go to the team that wins the game</option>
             <option value="match"${g.award === "match" ? " selected" : ""}>Points for every matchup win</option>
           </select>`
        : `<select class="grow" aria-label="Which score wins" ${field(g, "better")}>
             <option value="high"${g.better === "high" ? " selected" : ""}>Highest score wins</option>
             <option value="low"${g.better === "low" ? " selected" : ""}>Lowest wins (fastest time)</option>
           </select>
           <input class="unit" value="${esc(g.unit)}" maxlength="16" placeholder="unit, e.g. seconds" aria-label="Unit" ${field(g, "unit")}>`}
      </div>
      <input class="desc" value="${esc(g.desc)}" maxlength="240" placeholder="How to play (shown on the big screen) — optional" aria-label="How to play" ${field(g, "desc")}>
      <div class="mini-row foot">${state}<span class="grow"></span>
        ${started ? `<button class="btn ghost sm" data-action="mini-reset-ask" data-id="${esc(g.id)}">↺ Reset</button>` : ""}
        ${g.status !== "done" ? `<button class="btn ghost sm" ${actAttr("miniPlay", { id: g.id }, { then: "drawer" })}>▶ Play</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
  <section class="sect"><h4>Your mini games <small>${M.list.length ? `(${M.list.length})` : ""}</small></h4>
    ${cards || `<p class="muted">None yet. Mini games are played before Jeopardy and the points count toward each team's score.</p>`}
  </section>
  <section class="sect"><h4>Add a mini game</h4>
    <input id="mini-new-name" class="newname" maxlength="40" placeholder="Name, e.g. Snowball Toss" aria-label="New game name" data-sticky>
    <div class="btnrow add">
      <button class="btn primary sm" data-action="mini-add" data-type="h2h">+ ⚔️ Head-to-head</button>
      <button class="btn primary sm" data-action="mini-add" data-type="best">+ 🏅 Best overall</button>
    </div>
    <ul class="explain">
      <li><b>Head-to-head:</b> one of the ${esc(n1)} faces one of the ${esc(n2)} each round. You tap who won.</li>
      <li><b>Best overall:</b> everyone takes a turn and you type their score. The best score wins it for their team.</li>
      <li>The game draws who's up next at random, and nobody repeats until everyone's had a go.</li>
    </ul>
  </section>
  <section class="sect"><h4>Need ideas? <small>tap to add</small></h4>
    <div class="ideas">${PRESETS.map((p, i) => `<button class="chipbtn" data-action="mini-preset" data-i="${i}" title="${esc(p.desc)}">${p.type === "h2h" ? "⚔️" : "🏅"} ${esc(p.name)}</button>`).join("")}</div>
  </section>`;
}

// =====================================================================
// Host remote: list of games to start
// =====================================================================
export function remoteMinis(G) {
  const M = E.minisOf(G.S);
  if (G.S.phase !== "minis" || M.current || !M.list.length) return "";
  return `<div class="r-minis">${M.list.map((g, i) => {
    const r = resultBits(G, g);
    return `<button class="${cls("r-mini", g.status)}" ${actAttr("miniPlay", { id: g.id })}>
      <b>${i + 1}. ${esc(g.name)}</b><span>${TYPE_LABEL[g.type]} · ${money(g.points)}</span>
      <em>${r ? esc(r.text) : g.status === "active" ? "In progress ▶" : "Play ▶"}</em></button>`;
  }).join("")}</div>`;
}

// =====================================================================
// Players' phones
// =====================================================================
export function playerMinis(G, extra = "") {
  const S = G.S;
  const me = G.me;
  const M = E.minisOf(S);
  const g = currentGame(M);
  if (!g) {
    const next = M.list.find((x) => x.status === "active") || M.list.find((x) => x.status === "pending");
    return `<div class="ph-card hero"><div class="big-emoji">🎯</div><h2>Mini games!</h2>
      <p>${next ? `Up next: <b>${esc(next.name)}</b>` : M.list.length ? "All done — Jeopardy is next!" : "Jaren is setting things up…"}</p>
      <div class="ph-minis">${M.list.map((x) => {
        const r = resultBits(G, x);
        return `<div class="${cls("ph-mrow", x.status)}" data-key="pm-${esc(x.id)}"><span class="pm-name">${esc(x.name)}</span><span class="pm-meta">${money(x.points)}</span><span class="pm-res ${r ? r.cls : ""}">${r ? esc(r.text) : x.status === "active" ? "▶" : ""}</span></div>`;
      }).join("")}</div>
      ${extra}
    </div>`;
  }
  if (g.status === "done") {
    const r = g.result || { winner: "none" };
    const mine = r.winner === me.team;
    const title = r.winner === "tie" ? "It's a tie!" : r.winner === "none" ? "No winner this time" : mine ? "Your team won!" : `${esc(tn(G, r.winner))} won`;
    const pts = r.winner === "tie" ? (r.team1 ? `+${money(r.team1)} each` : "") : E.TEAMS.includes(r.winner) && r[r.winner] ? `+${money(r[r.winner])}` : "";
    return `<div class="ph-card hero"><div class="big-emoji">${r.winner === "tie" ? "🤝" : mine ? "🏆" : r.winner === "none" ? "🎄" : "😤"}</div>
      <h2>${title}</h2><p><b>${esc(g.name)}</b>${pts ? ` · ${pts}` : ""}</p></div>`;
  }

  const head = `<div class="ph-mini-head"><div class="kicker">${TYPE_LABEL[g.type]} · ${prize(g)}</div><h2>${esc(g.name)}</h2>${g.desc ? `<p>${esc(g.desc)}</p>` : ""}</div>`;
  const pick = E.currentPick(S);
  const spinning = isSpinning(G);
  const mine = !!pick && pick.pids.includes(G.deviceId);
  const st = E.miniStanding(g);
  let now;
  if (!pick) now = `<div class="ph-note">Get ready — the next name is about to be drawn! 🎲</div>`;
  else if (spinning) now = `<div class="ph-note drawing">🎲 Drawing who's up…</div>`;
  else if (g.type === "h2h") {
    const m = E.openMatch(g);
    const a = m.p1 ? m.p1.name : tn(G, "team1");
    const b = m.p2 ? m.p2.name : tn(G, "team2");
    const rival = me.team === "team1" ? b : a;
    now = mine
      ? `<div class="youup big">🎯 You're up!<small>You vs ${esc(rival)}</small></div>`
      : `<div class="ph-versus"><span class="team1">${esc(a)}</span><i>vs</i><span class="team2">${esc(b)}</span></div>`;
  } else {
    const t = g.turn;
    now = mine
      ? `<div class="youup big">🎯 You're up!<small>${g.better === "low" ? "Lowest" : "Highest"} score wins</small></div>`
      : `<div class="ph-versus solo"><small>Up now</small><span class="${t.team}">${esc(t.name)}</span></div>`;
  }
  let board;
  if (g.type === "h2h") {
    board = `<div class="ph-tally"><span class="team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span><span>–</span><span class="team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span></div>`;
  } else {
    const my = st.sorted.find((e) => e.pid === G.deviceId);
    board = `<div class="ph-lb">${st.sorted.slice(0, 5).map((e, i) => `<div class="${cls("ph-lbrow", e.team, e.pid === G.deviceId && "me")}" data-key="plb-${esc(e.id)}"><span>${i === 0 ? "👑" : i + 1}</span><span class="grow">${esc(e.name)}</span><b>${scoreText(g, e.score)}</b></div>`).join("") || `<div class="muted">No scores yet</div>`}</div>
      ${my ? `<div class="locked-note">Your score: <b>${scoreText(g, my.score)}</b></div>` : ""}`;
  }
  return `${head}${now}${board}`;
}
