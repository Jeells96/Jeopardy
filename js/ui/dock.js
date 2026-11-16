// "What should the host do next?" — shared by the host console and the phone remote.
// hostSteps(G) returns { status, panel, buttons }, where each button is
// { label, action, params, kind: primary|good|bad|ghost, key }.
import { esc, money, cls, verb } from "./util.js";
import * as E from "../engine.js";
import { tn, findQ } from "./stage.js";
import { miniSteps } from "./minis.js";

function firstPickPanel(G) {
  const fp = G.ui.firstPick || "random";
  return `<div class="seg-wrap"><span class="seg-label">Who picks first in Jeopardy?</span><div class="seg">
    ${["team1", "team2", "random"].map((v) => `<button class="${cls("seg-btn", v, fp === v && "on")}" data-action="first-pick" data-v="${v}">${v === "random" ? "🎲 Random" : esc(tn(G, v))}</button>`).join("")}
  </div></div>`;
}

export function hostSteps(G, { privateView = false } = {}) {
  const S = G.S;
  const B = [];
  let status = "";
  let panel = "";
  const btn = (label, action, params = {}, kind = "ghost", key = "") => B.push({ label, action, params, kind, key });
  const act = (name, p = {}) => ({ name, p });

  if (S.phase === "lobby") {
    const n1 = E.boardClues(G.Q, 1).length, n2 = E.boardClues(G.Q, 2).length, fq = E.finalClue(G.Q);
    const c1 = G.P.filter((p) => p.team === "team1").length, c2 = G.P.filter((p) => p.team === "team2").length;
    const item = (done, text) => `<li class="${done ? "ok" : ""}"><span class="tick">${done ? "✓" : ""}</span>${text}</li>`;
    const M = E.minisOf(S);
    const todo = M.list.filter((g) => g.status !== "done").length;
    status = `<ul class="checklist">
      ${item(n1 > 0, n1 ? `<b>${n1}</b> clues${n2 ? ` + <b>${n2}</b> Double Jeopardy` : ""}${fq ? " + Final Jeopardy" : ""}` : "Load your Jeopardy questions (⚙ Settings → Questions)")}
      ${M.list.length ? item(true, `<b>${M.list.length}</b> mini game${M.list.length === 1 ? "" : "s"} ready`) : ""}
      ${item(c1 + c2 > 0, `Players: ${esc(tn(G, "team1"))} <b>${c1}</b> · ${esc(tn(G, "team2"))} <b>${c2}</b>`)}
      ${item(G.soundOn, G.soundOn ? "Sound is on" : "Turn on 🔊 on the screen connected to speakers")}
    </ul>`;
    const fp = G.ui.firstPick || "random";
    const resume = S.jStarted;
    if (resume) status += `<div class="muted">Jeopardy is paused — scores and the board are saved.</div>`;
    if (todo) {
      // Mini games come first; their points carry into Jeopardy.
      btn("▶ Start the mini games", "act", act("minisStart"), "primary", "Space");
      if (n1) {
        if (resume) btn("▶ Resume Jeopardy", "act", act("startGame"));
        else btn("Skip to Jeopardy", "confirm", { what: "startGame" }); // asks first, so it can't happen by accident
      }
      btn("🎯 Edit mini games", "drawer", { tab: "minis" });
    } else {
      if (n1 && resume) btn("▶ Resume Jeopardy", "act", act("startGame"), "primary", "Space");
      else if (n1) { panel = firstPickPanel(G); btn("▶ Start Jeopardy!", "act", act("startGame", { control: fp }), "primary", "Space"); }
      else btn("📥 Load questions", "drawer", { tab: "questions" }, "primary", "Space");
      btn("🎯 Add mini games", "drawer", { tab: "minis" });
    }
    return { status, panel, buttons: B };
  }

  if (S.phase === "minis") {
    const steps = miniSteps(G, { privateView });
    return { status: steps.status, panel: steps.panel || (steps.wantFirstPick ? firstPickPanel(G) : ""), buttons: steps.buttons };
  }

  if (S.phase === "board") {
    const left = E.cluesLeft(G.Q, S.round);
    if (left > 0) {
      status = S.control
        ? `🎁 <b>${esc(tn(G, S.control))}</b> ${verb(tn(G, S.control), "picks", "pick")} next — ${privateView ? "tap" : "click"} their clue on the board. <span class="muted">${left} left</span>`
        : `${privateView ? "Tap" : "Click"} any clue on the board to begin. <span class="muted">${left} left</span>`;
      btn("⇄ Switch who picks", "act", act("setControl", { team: S.control ? E.otherTeam(S.control) : "team1" }), "ghost", "");
    } else if (S.round === 1 && E.hasRound2(G.Q)) {
      status = "That's the end of the first round! 🎄";
      btn("▶ Start Double Jeopardy!", "act", act("startRound2"), "primary", "Space");
    } else if (E.finalClue(G.Q)) {
      status = "The board is clear — time for Final Jeopardy!";
      btn("▶ Start Final Jeopardy!", "act", act("finalStart"), "primary", "Space");
    } else {
      status = "The board is clear!";
      btn("🏁 End the game", "act", act("endGame"), "primary", "Space");
    }
    if (E.minisOf(S).list.length) btn("🎯 Mini games", "act", act("leaveJeopardy", { to: "minis" }));
    btn("↩ Back to lobby", "act", act("leaveJeopardy", { to: "lobby" }));
    return { status, panel, buttons: B };
  }

  if (S.phase === "clue" && S.clue) {
    const c = S.clue;
    const q = findQ(G, c.id);
    const value = c.dd ? c.dd.wager : q ? q.points : 0;
    const set = S.settings || {};
    if (c.stage === "dd") {
      const team = G.ui.ddTeam || c.dd.team || null;
      const lim = team ? E.ddLimits(S, G.Q, team) : null;
      status = "⭐ <b>Daily Double!</b> Ask the team that found it for their wager.";
      panel = ddPanel(G, team, lim);
      const w = Number(G.ui.ddWager);
      const valid = lim && Number.isFinite(w) && G.ui.ddWager !== "" && w >= lim.min && w <= lim.max;
      btn(valid ? `🔒 Lock ${money(w)} & show clue` : "🔒 Lock wager & show clue", "dd-lock", {}, "primary", "Space");
      btn("↩ Put clue back", "act", act("unpickClue"), "ghost", "");
      return { status, panel, buttons: B };
    }
    if (c.stage === "reading") {
      status = set.readSeconds > 0
        ? `Read the clue — buzzers open automatically in <b class="cd" data-deadline="${c.pickedAt + set.readSeconds * 1000}" data-format="s"></b>.`
        : "Read the clue out loud, then open the buzzers.";
      btn("🔔 Open buzzers", "act", act("openBuzzers"), "primary", "Space");
      if (c.buzzRound === 0) btn("↩ Put clue back", "act", act("unpickClue"), "ghost", "");
      btn("🙅 Nobody — reveal", "act", act("nobody"), "ghost", "N");
      return { status, panel, buttons: B };
    }
    if (c.stage === "open") {
      status = c.blocked.length
        ? `🔔 Rebound! <b>${esc(tn(G, E.otherTeam(c.blocked[0])))}</b> can buzz in to steal it…`
        : "🔔 Buzzers are open — waiting for the first buzz…";
      btn("⏸ Pause buzzers", "act", act("pauseBuzzers"), "ghost", "P");
      btn("🙅 Nobody knows — reveal", "act", act("nobody"), "ghost", "N");
      return { status, panel, buttons: B };
    }
    if (c.stage === "paused") {
      const rem = E.TEAMS.filter((t) => !c.blocked.includes(t));
      status = c.blocked.length ? `${esc(tn(G, c.blocked[0]))} missed it.` : "Buzzers paused.";
      btn(rem.length === 1 ? `🔔 Open for ${esc(tn(G, rem[0]))}` : "🔔 Reopen buzzers", "act", act("openBuzzers"), "primary", "Space");
      btn("🙅 Nobody — reveal", "act", act("nobody"), "ghost", "N");
      return { status, panel, buttons: B };
    }
    if (c.stage === "answering" && c.locked) {
      const L = c.locked;
      const key = E.lockKey(c);
      const who = c.dd ? `<b>${esc(tn(G, L.team))}</b>` : `<b>${esc(L.name)}</b> <span class="muted">(${esc(tn(G, L.team))})</span>`;
      const clock = c.timeUp === key
        ? `<span class="timeup">⏰ Time's up — your call.</span>`
        : `<span class="pill-cd"><span class="cd" data-deadline="${L.at + (set.answerSeconds || 15) * 1000}" data-format="s"></span></span>`;
      const heard = G.spoken && G.spoken.key === key && G.spoken.text ? `<div class="heard-line">🎤 “${esc(G.spoken.text)}”</div>` : "";
      const isMcq = q && q.type === "mcq";
      status = `${who} ${c.dd ? verb(tn(G, L.team), "is", "are") : "is"} answering ${clock}${isMcq ? `<div class="muted">They choose on ${c.dd ? "their team's phones" : "their phone"} — scored automatically.</div>` : ""}${heard}`;
      if (isMcq) {
        btn("✗ Mark wrong", "act", act("judge", { result: "wrong" }), "bad", "W");
        btn("Skip (no penalty)", "act", act("judge", { result: "skip" }), "ghost", "S");
      } else {
        btn(`✓ Correct +${money(value)}`, "act", act("judge", { result: "correct" }), "good", "C");
        btn(`✗ Wrong −${money(value)}`, "act", act("judge", { result: "wrong" }), "bad", "W");
        btn("Skip (no penalty)", "act", act("judge", { result: "skip" }), "ghost", "S");
      }
      return { status, panel, buttons: B };
    }
    if (c.stage === "done") {
      status = c.result === "correct" ? `✅ ${esc(tn(G, c.winner))} got it!` : c.result === "nobody" ? "Nobody got it." : "Clue finished.";
      btn("↩ Back to the board", "close", {}, "primary", "Space");
      if (!c.revealed) btn("👁 Show answer", "act", act("revealAnswer"), "ghost", "R");
      return { status, panel, buttons: B };
    }
  }

  if (S.phase === "final") {
    const f = S.final;
    if (f.stage === "wager") {
      status = `<b>Final Jeopardy!</b> Teams lock their wagers on their phones.`;
      panel = finalWagerPanel(G, privateView);
      const missing = E.TEAMS.filter((t) => f.eligible[t] && !f.wagers[t]);
      btn(missing.length ? `▶ Reveal clue (${missing.map((t) => esc(tn(G, t))).join(" & ")} → $0)` : "▶ Reveal the Final clue", "act", act("finalRevealClue"), "primary", "Space");
      return { status, panel, buttons: B };
    }
    if (f.stage === "clue") {
      const ins = E.TEAMS.filter((t) => f.eligible[t]).map((t) => `${esc(tn(G, t))}: ${f.answers[t] && f.answers[t].text ? "✓ answer in" : "writing…"}`).join(" · ");
      status = `Think music! <span class="pill-cd"><span class="cd" data-deadline="${f.deadline}" data-format="s"></span></span> <span class="muted">${ins}</span>`;
      btn("🔒 Lock answers now", "act", act("finalLock", { force: true }), "ghost", "");
      return { status, panel, buttons: B };
    }
    if (f.stage === "reveal") {
      const next = f.order.find((t) => f.eligible[t] && !f.results[t]);
      if (next) {
        const w = (f.wagers[next] && f.wagers[next].amount) || 0;
        if (!f.shown[next].answer) {
          status = `Reveal answers one team at a time — lowest score first.`;
          btn(`👁 Reveal ${esc(tn(G, next))}'s answer`, "act", act("finalShowAnswer", { team: next }), "primary", "Space");
        } else {
          const a = f.answers[next];
          status = `<b>${esc(tn(G, next))}</b> wrote: “${esc(a && a.text ? a.text : "(no answer)")}”`;
          btn(`✓ Correct +${privateView ? money(w) : "wager"}`, "act", act("finalJudge", { team: next, correct: true }), "good", "C");
          btn(`✗ Wrong −${privateView ? money(w) : "wager"}`, "act", act("finalJudge", { team: next, correct: false }), "bad", "W");
        }
      } else {
        status = "All answers are in. Drumroll…";
        btn("🏆 Show the winner", "act", act("finalFinish"), "primary", "Space");
      }
      return { status, panel, buttons: B };
    }
  }

  if (S.phase === "over") {
    const sc = S.scores;
    const champ = tn(G, sc.team1 > sc.team2 ? "team1" : "team2");
    status = sc.team1 === sc.team2 ? "It's a tie!" : `🏆 ${esc(champ)} ${verb(champ, "wins", "win")}!`;
    btn("🎄 New game", "confirm", { what: "newGame" }, "primary", "");
    return { status, panel, buttons: B };
  }
  return { status, panel, buttons: B };
}

function ddPanel(G, team, lim) {
  const S = G.S;
  const roundMax = E.roundMaxValue(G.Q, S.round);
  let quick = "";
  if (lim) {
    const half = Math.max(lim.min, Math.round(lim.max / 2 / 50) * 50);
    const score = S.scores[team] || 0;
    const opts = [[lim.min, `Min ${money(lim.min)}`], [half, money(half)], [lim.max, score >= roundMax && score > 0 ? "All in! (True DD)" : `Max ${money(lim.max)}`]];
    quick = opts.filter((o, i, a) => a.findIndex((x) => x[0] === o[0]) === i)
      .map(([v, l]) => `<button class="chipbtn" data-action="dd-quick" data-v="${v}">${l}</button>`).join("");
  }
  return `<div class="ddpanel">
    <div class="seg">${E.TEAMS.map((t) => `<button class="${cls("seg-btn", t, team === t && "on")}" data-action="dd-team" data-team="${t}">${esc(tn(G, t))} <small>${money(S.scores[t] || 0)}</small></button>`).join("")}</div>
    ${lim ? `<div class="wager-row">
      <label class="wager-box"><span>$</span><input id="dd-wager" class="wager-input" type="number" inputmode="numeric" min="${lim.min}" max="${lim.max}" placeholder="Wager" value="${esc(G.ui.ddWager)}" data-input="dd-wager"></label>
      <div class="quick">${quick}</div>
    </div>
    <div class="hint">Allowed ${money(lim.min)} – ${money(lim.max)} (their score, or ${money(roundMax)} if that's higher)</div>`
    : `<div class="hint">Which team found the Daily Double?</div>`}
  </div>`;
}

function finalWagerPanel(G, privateView) {
  const f = G.S.final;
  return `<div class="fwpanel">${E.TEAMS.map((t) => {
    const max = E.finalMax(G.S, t);
    const w = f.wagers[t];
    const st = !f.eligible[t] ? "Sitting out" : w ? `✓ Locked${privateView ? ` · ${money(w.amount)}` : ""} <small>by ${esc(w.by)}</small>` : "Waiting for their phones…";
    return `<div class="fwrow ${t}">
      <label class="toggle"><input type="checkbox" data-change="final-eligible" data-team="${t}"${f.eligible[t] ? " checked" : ""}><span>${esc(tn(G, t))} ${verb(tn(G, t), "plays", "play")}</span></label>
      <span class="fw-status">${st}</span>
      ${f.eligible[t] ? `<span class="fw-set"><input id="fw-${t}" class="wager-input sm" type="${privateView ? "number" : "password"}" inputmode="numeric" placeholder="0–${max}" data-sticky autocomplete="off"><button class="btn ghost sm" data-action="final-host-wager" data-team="${t}">Set</button></span>` : ""}
    </div>`;
  }).join("")}${privateView ? "" : `<div class="hint">Wagers stay hidden on this screen. Typed wagers are masked.</div>`}</div>`;
}

// Render the buttons. `data-p` carries the params as JSON.
export function renderButtons(buttons, { showKeys = true } = {}) {
  return buttons.map((b) => {
    const k = showKeys && b.key ? `<kbd>${b.key === "Space" ? "Space" : b.key}</kbd>` : "";
    return `<button class="btn ${b.kind}" data-action="${b.action}" data-p="${esc(JSON.stringify(b.params || {}))}">${b.label}${k}</button>`;
  }).join("");
}
