// Host console ("Jaren's View"): the stage (safe to mirror on the projector) plus a
// guided control dock, a settings drawer, and modals.
import { esc, money, cls } from "./util.js";
import * as E from "../engine.js";
import { stage, tn, roundLabel } from "./stage.js";
import { hostSteps, renderButtons } from "./dock.js";
import { minisTab, miniModal } from "./minis.js";

export function renderHost(G) {
  const S = G.S;
  const steps = hostSteps(G);
  const last = (S.history || [])[S.history.length - 1];
  const undoTip = last ? `${last.delta > 0 ? "+" : "−"}${money(Math.abs(last.delta)).replace("-", "")} ${tn(G, last.team)}` : "";
  return `<div class="host">
    <header class="hbar">
      <div class="hbrand">🎅 <span>Jaren's Control</span></div>
      <div class="hround">${esc(roundLabel(S))}</div>
      <div class="hspacer"></div>
      <button class="hbtn" data-action="act" data-p='{"name":"undo","p":{}}'${last ? "" : " disabled"} title="Undo last score change (U)">↶ Undo${last ? ` <small>${esc(undoTip)}</small>` : ""}</button>
      <button class="${cls("hbtn", G.soundOn && "on")}" data-action="toggle-sound" title="Sound on this screen (M)">${G.soundOn ? "🔊 Sound on" : "🔇 Sound off"}</button>
      <a class="hbtn" href="#/board" target="_blank" rel="noopener" title="Open the projector board in a new tab">📺 Board</a>
      <a class="hbtn" href="#/remote" target="_blank" rel="noopener" title="Open the host remote (answers + controls) on your phone">📱 Remote</a>
      <button class="hbtn" data-action="fullscreen" title="Fullscreen (F)">⛶</button>
      <button class="hbtn" data-action="drawer" data-p='{"tab":"game"}' title="Settings">⚙ Settings</button>
    </header>
    ${stage(G, { host: true, pick: true })}
    <div class="dock">
      <div class="dock-status">${steps.status}</div>
      ${steps.panel ? `<div class="dock-panel">${steps.panel}</div>` : ""}
      <div class="dock-buttons">${renderButtons(steps.buttons)}</div>
    </div>
    ${drawer(G)}
    ${modal(G)}
  </div>`;
}

// ---------------- settings drawer ----------------
function drawer(G) {
  const open = !!G.ui.drawer;
  const tab = G.ui.drawerTab || "game";
  const nMinis = E.minisOf(G.S).list.length;
  const tabs = [["game", "Game"], ["minis", `Mini games${nMinis ? ` (${nMinis})` : ""}`], ["questions", "Questions"], ["players", `Players (${G.P.length})`], ["help", "Help"]];
  let body = "";
  if (tab === "game") body = gameTab(G);
  else if (tab === "minis") body = minisTab(G);
  else if (tab === "questions") body = questionsTab(G);
  else if (tab === "players") body = playersTab(G);
  else body = helpTab();
  return `<div class="${cls("scrim", open && "open")}" data-action="drawer-close"></div>
  <aside class="${cls("drawer", open && "open")}" aria-hidden="${!open}"${open ? "" : " inert"}>
    <div class="drawer-head"><span>⚙ Settings</span><button class="iconbtn" data-action="drawer-close" title="Close (Esc)">✕</button></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${cls("tab", tab === k && "on")}" data-action="drawer" data-p='{"tab":"${k}"}'>${l}</button>`).join("")}</nav>
    <div class="drawer-body">${body}</div>
  </aside>`;
}

function num(id, label, value, min, max, hint) {
  return `<label class="field"><span>${label}</span>
    <input type="number" inputmode="numeric" min="${min}" max="${max}" value="${value}" data-change="setting" data-key="${id}">
    ${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function toggle(id, label, on, hint) {
  return `<label class="field field--toggle"><input type="checkbox" data-change="setting-bool" data-key="${id}"${on ? " checked" : ""}>
    <span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
}

function gameTab(G) {
  const S = G.S;
  const st = S.settings || E.DEFAULT_SETTINGS;
  const r2 = E.hasRound2(G.Q), fq = E.finalClue(G.Q);
  return `
  <section class="sect"><h4>Teams</h4>
    ${E.TEAMS.map((t) => `<label class="field"><span class="dot ${t}"></span><input value="${esc(tn(G, t))}" maxlength="24" data-change="team-name" data-team="${t}" aria-label="Team name"></label>`).join("")}
  </section>
  <section class="sect"><h4>Timers <small>(seconds)</small></h4>
    <div class="grid2">
      ${num("answerSeconds", "Answer time", st.answerSeconds, 3, 120, "After someone buzzes")}
      ${num("finalSeconds", "Final Jeopardy", st.finalSeconds, 10, 300, "Think-music time")}
      ${num("buzzWindowSeconds", "Buzz-in window", st.buzzWindowSeconds, 0, 120, "0 = unlimited")}
      ${num("readSeconds", "Auto-open buzzers", st.readSeconds, 0, 30, "0 = I'll open them")}
    </div>
  </section>
  <section class="sect"><h4>Rules</h4>
    ${toggle("autoRebound", "Auto-rebound", st.autoRebound, "After a miss, the other team can buzz in right away")}
    ${toggle("finalNeedsPositive", "Official Final Jeopardy rule", st.finalNeedsPositive, "Only teams above $0 can play Final")}
    ${toggle("playersRename", "Teams can rename themselves", st.playersRename !== false, "From their phones, until Jeopardy starts")}
    ${toggle("announce", "Announce who's up out loud", st.announce !== false, "Mini games: the screen with 🔊 on reads the names aloud")}
  </section>
  <section class="sect"><h4>Scores</h4>
    ${E.TEAMS.map((t) => `<div class="field-row"><span class="dot ${t}"></span><span class="grow">${esc(tn(G, t))}</span><b>${money(S.scores[t])}</b><button class="btn ghost sm" data-action="score-panel" data-team="${t}">Adjust</button></div>`).join("")}
  </section>
  <section class="sect"><h4>Jump to</h4>
    <div class="btnrow">
      ${S.phase === "board" || S.phase === "lobby" ? `<button class="btn ghost sm" data-action="act" data-p='{"name":"minisStart","p":{},"then":"drawer"}'>🎯 Mini games</button>` : ""}
      ${S.phase !== "lobby" && r2 && S.round !== 2 ? `<button class="btn ghost sm" data-action="confirm" data-p='{"what":"startRound2"}'>Double Jeopardy</button>` : ""}
      ${S.phase !== "lobby" && fq && S.phase !== "final" ? `<button class="btn ghost sm" data-action="confirm" data-p='{"what":"finalStart"}'>Final Jeopardy</button>` : ""}
      ${S.phase !== "lobby" && S.phase !== "over" ? `<button class="btn ghost sm" data-action="confirm" data-p='{"what":"endGame"}'>End game</button>` : ""}
    </div>
  </section>
  <section class="sect danger"><h4>Start over</h4>
    <div class="btnrow">
      <button class="btn bad sm" data-action="confirm" data-p='{"what":"newGame"}'>New game</button>
      <button class="btn bad sm" data-action="confirm" data-p='{"what":"clearPlayers"}'>Remove all players</button>
    </div>
    <small class="muted">New game resets scores and the board but keeps players, team names, settings and questions.</small>
  </section>`;
}

function questionsTab(G) {
  const r1 = E.boardClues(G.Q, 1), r2 = E.boardClues(G.Q, 2), fq = E.finalClue(G.Q);
  const cats = (list) => [...new Set(list.map((q) => q.category))];
  const dd = (list) => list.filter((q) => q.dailyDouble).length;
  const mc = (list) => list.filter((q) => q.type === "mcq").length;
  const row = (label, list) => list.length
    ? `<div class="qstat"><b>${label}</b><span>${list.length} clues · ${cats(list).length} categories · ${dd(list)} Daily Double${dd(list) === 1 ? "" : "s"} · ${mc(list)} multiple choice</span><small>${cats(list).map(esc).join(" · ")}</small></div>` : "";
  return `
  <section class="sect"><h4>Your questions</h4>
    ${G.Q.length ? `${row("Jeopardy!", r1)}${row("Double Jeopardy!", r2)}${fq ? `<div class="qstat"><b>Final Jeopardy!</b><span>${esc(fq.category)}</span></div>` : `<div class="qstat warn">No Final Jeopardy tab found.</div>`}` : `<p class="muted">No questions loaded yet.</p>`}
    <div class="import-msg" role="status">${esc(G.ui.importMsg || "")}</div>
  </section>
  <section class="sect"><h4>Load questions</h4>
    <ol class="howto">
      <li><button class="btn ghost sm" data-action="download-template">⬇ Download the template</button></li>
      <li>Fill it in (works great in the Excel or Google Sheets phone app)</li>
      <li><label class="btn primary sm file">⬆ Import your spreadsheet<input type="file" accept=".xlsx,.xls" hidden data-change="import"></label></li>
    </ol>
    <small class="muted">Importing replaces all current questions. Each category is its own tab; add “DJ ” to the start of a tab name to put it in Double Jeopardy.</small>
  </section>
  <section class="sect"><h4>Board</h4>
    <button class="btn ghost sm" data-action="confirm" data-p='{"what":"resetBoard"}'>Put every clue back on the board</button>
  </section>`;
}

function playersTab(G) {
  return E.TEAMS.map((t) => {
    const ps = G.P.filter((p) => p.team === t);
    return `<section class="sect"><h4><span class="dot ${t}"></span> ${esc(tn(G, t))} <small>(${ps.length})</small></h4>
      ${ps.length ? ps.map((p) => `<div class="prow" data-key="pr-${esc(p.id)}">
        <input value="${esc(p.name)}" maxlength="20" data-change="player-name" data-id="${esc(p.id)}" aria-label="Player name">
        <button class="btn ghost sm" data-action="player-team" data-id="${esc(p.id)}" data-team="${E.otherTeam(t)}" title="Move to the other team">⇄</button>
        <button class="btn bad sm" data-action="player-remove" data-id="${esc(p.id)}" title="Remove (they can rejoin)">✕</button>
      </div>`).join("") : `<p class="muted">Nobody yet.</p>`}
      <div class="prow add"><input id="add-player-${t}" maxlength="20" placeholder="Add someone without a phone" aria-label="Add a player to ${esc(tn(G, t))}" data-sticky>
        <button class="btn ghost sm" data-action="player-add" data-team="${t}">+ Add</button></div>
    </section>`;
  }).join("") + `<small class="muted">Players can't change their own name or team — fix it here and their phone updates instantly. People you add by hand can be drawn for mini games too.</small>`;
}

function helpTab() {
  const keys = [["Space / Enter", "Do the highlighted (gold) step"], ["1 / 2 / T", "Mini game matchup: left team won / right team won / tie"], ["C", "Correct"], ["W", "Wrong"], ["S", "Skip — no penalty"],
    ["N", "Nobody knows — reveal answer"], ["P", "Pause buzzers"], ["R", "Show answer"], ["U", "Undo last score change"],
    ["M", "Sound on/off"], ["F", "Fullscreen"], ["Esc", "Close panels"]];
  return `<section class="sect"><h4>Keyboard shortcuts</h4>
    <div class="keys">${keys.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join("")}</div></section>
  <section class="sect"><h4>Running the game</h4>
    <ol class="howto">
      <li>Put <b>this screen</b> (or 📺 Board) on the projector. Turn 🔊 sound on for whichever screen has speakers.</li>
      <li>Open <b>📱 Remote</b> on your phone — it shows the answer for each clue and has every control, so you can host from anywhere in the room.</li>
      <li>Players scan the QR code in the lobby, join a team and enable their mic.</li>
      <li><b>Mini games</b> (optional) come first: set them up in the Mini games tab. Their points carry into Jeopardy.</li>
      <li>Just follow the gold button. It always shows the next step.</li>
    </ol></section>`;
}

// ---------------- modals ----------------
const CONFIRMS = {
  newGame: ["Start a new game?", "Scores and the board reset. Players, team names, settings and questions stay.", "Start new game"],
  clearPlayers: ["Remove all players?", "Everyone will need to rejoin from their phone.", "Remove everyone"],
  resetBoard: ["Put every clue back?", "All clues become available again. Scores don't change.", "Reset board"],
  startRound2: ["Jump to Double Jeopardy?", "Any clues left in this round are skipped.", "Start Double Jeopardy"],
  finalStart: ["Jump to Final Jeopardy?", "Any clues left on the board are skipped.", "Start Final Jeopardy"],
  endGame: ["End the game now?", "Shows the final scores.", "End game"],
};

export function modal(G) {
  const m = G.ui.modal;
  if (!m) return "";
  if (String(m.type).startsWith("mini")) return miniModal(G, m);
  if (m.type === "confirm") {
    const [title, text, cta] = CONFIRMS[m.what] || ["Are you sure?", "", "Yes"];
    return `<div class="modal-scrim" data-action="modal-close"></div><div class="modal" role="dialog">
      <h3>${title}</h3><p>${text}</p>
      <div class="btnrow end"><button class="btn ghost" data-action="modal-close">Cancel</button><button class="btn primary" data-action="confirm-yes" data-p='${esc(JSON.stringify({ what: m.what }))}'>${cta}</button></div></div>`;
  }
  if (m.type === "score") {
    const t = m.team;
    const sc = G.S.scores[t] || 0;
    const deltas = [-500, -200, -100, 100, 200, 500];
    return `<div class="modal-scrim" data-action="modal-close"></div><div class="modal" role="dialog">
      <h3><span class="dot ${t}"></span> ${esc(tn(G, t))}: ${money(sc)}</h3>
      <div class="deltas">${deltas.map((d) => `<button class="btn ${d < 0 ? "bad" : "good"}" data-action="act" data-p='${JSON.stringify({ name: "adjustScore", p: { team: t, delta: d } })}'>${d > 0 ? "+" : "−"}${money(Math.abs(d))}</button>`).join("")}</div>
      <label class="field"><span>Set exact score</span><div class="inline"><input id="exact-score" type="number" inputmode="numeric" value="${sc}" data-sticky><button class="btn primary" data-action="set-exact" data-team="${t}">Set</button></div></label>
      <div class="btnrow end"><button class="btn ghost" data-action="modal-close">Done</button></div></div>`;
  }
  return "";
}
