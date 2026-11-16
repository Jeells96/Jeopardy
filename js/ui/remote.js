// Host remote: private phone view with the answer key + every control.
// Keep this device OFF the projector.
import { esc, money, cls } from "./util.js";
import * as E from "../engine.js";
import { tn, findQ, categories, roundLabel } from "./stage.js";
import { hostSteps, renderButtons } from "./dock.js";
import { answerMatches } from "../speech.js";
import { modal, drawer } from "./host.js";
import { remoteMinis } from "./minis.js";

export function renderRemote(G) {
  const S = G.S;
  const steps = hostSteps(G, { privateView: true });
  const last = (S.history || [])[S.history.length - 1];
  return `<div class="remote">
    <header class="r-top">
      <div class="r-brand">🎅 Jaren's Control <small>${esc(roundLabel(S))}</small></div>
      <div class="r-tools">
        <button class="hbtn sm" data-action="act" data-p='{"name":"undo","p":{}}'${last ? "" : " disabled"} title="Undo last score change (U)">↶ Undo</button>
        <button class="${cls("hbtn sm", G.soundOn && "on")}" data-action="toggle-sound" title="Sound on this screen (M)">${G.soundOn ? "🔊" : "🔇"}</button>
        <a class="hbtn sm" href="#/board" target="_blank" rel="noopener" title="Open the projector board">📺 Board</a>
        <button class="hbtn sm" data-action="drawer" data-p='{"tab":"game"}' title="Settings">⚙</button>
      </div>
    </header>
    <div class="r-scores">${E.TEAMS.map((t) => `<button class="${cls("r-score", t, S.control === t && (S.phase === "board" || S.phase === "clue") && "ctl")}" data-action="score-panel" data-team="${t}"><span>${esc(tn(G, t))}</span><b class="${S.scores[t] < 0 ? "neg" : ""}">${money(S.scores[t])}</b></button>`).join("")}</div>
    ${secret(G)}
    <div class="r-status">${steps.status}</div>
    ${steps.panel ? `<div class="r-panel">${steps.panel}</div>` : ""}
    <div class="r-buttons">${renderButtons(steps.buttons, { showKeys: false })}</div>
    ${S.phase === "board" ? miniGrid(G) : ""}
    ${remoteMinis(G)}
    <div class="r-foot"><span class="muted">Put 📺 Board on the projector — keep this screen private 🤫</span></div>
    ${drawer(G)}
    ${modal(G)}
  </div>`;
}

function secret(G) {
  const S = G.S;
  if (S.phase === "clue" && S.clue) {
    const c = S.clue;
    const q = findQ(G, c.id);
    if (!q) return "";
    let extra = "";
    if (q.type === "mcq" && q.correctIndex >= 0) extra += `<div class="s-mcq">Correct choice: <b>${"ABCDEF"[q.correctIndex]}. ${esc(q.choices[q.correctIndex])}</b></div>`;
    const key = E.lockKey(c);
    if (c.stage === "answering" && q.type !== "mcq") {
      const sp = G.spoken && G.spoken.key === key ? G.spoken : null;
      if (sp && sp.text) {
        const m = answerMatches(sp.text, q.answer);
        extra += `<div class="s-heard ${m ? "match" : "nomatch"}">✍️ Typed: “${esc(sp.text)}” <b>${m ? "— matches ✅" : "— not a clear match"}</b></div>`;
      } else {
        extra += `<div class="s-heard muted">✍️ Waiting for their typed answer…</div>`;
      }
    }
    return `<div class="secret">
      <div class="s-head"><span>${esc(q.category)}</span><span>${c.dd ? `Daily Double${c.dd.wager ? " · " + money(c.dd.wager) : ""}` : money(q.points)}</span></div>
      <div class="s-q">${esc(q.question)}</div>
      <div class="s-ans"><small>Answer</small>${esc(q.answer || "(no answer written)")}</div>
      ${q.note ? `<div class="s-note">📝 ${esc(q.note)}</div>` : ""}
      ${extra}
    </div>`;
  }
  if (S.phase === "final") {
    const f = S.final;
    const fq = E.finalClue(G.Q);
    return `<div class="secret">
      <div class="s-head"><span>Final Jeopardy · ${esc(fq ? fq.category : "")}</span></div>
      <div class="s-q">${esc(fq ? fq.question : "")}</div>
      <div class="s-ans"><small>Answer</small>${esc(fq ? fq.answer : "")}</div>
      <div class="s-teams">${E.TEAMS.map((t) => {
        if (!f.eligible[t]) return `<div class="s-team ${t}"><b>${esc(tn(G, t))}</b> sitting out</div>`;
        const w = f.wagers[t], a = f.answers[t];
        return `<div class="s-team ${t}"><b>${esc(tn(G, t))}</b> wager ${w ? money(w.amount) : "—"}${a && a.text ? ` · “${esc(a.text)}”${fq && answerMatches(a.text, fq.answer) ? " ✅" : ""}` : ""}</div>`;
      }).join("")}</div>
    </div>`;
  }
  return "";
}

function miniGrid(G) {
  const cats = categories(G, G.S.round);
  if (!cats.length) return "";
  const rows = Math.max(...cats.map((c) => c.clues.length));
  let cells = cats.map((c) => `<div class="r-cat">${esc(c.name)}</div>`).join("");
  for (let r = 0; r < rows; r++) {
    for (const c of cats) {
      const q = c.clues[r];
      cells += !q || q.used
        ? `<div class="r-cell used"></div>`
        : `<button class="r-cell" data-action="pick" data-id="${esc(q.id)}">${money(q.points)}${q.dailyDouble ? "<i>DD</i>" : ""}</button>`;
    }
  }
  return `<div class="r-grid" style="--cols:${cats.length}">${cells}</div>`;
}
