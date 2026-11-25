// Player phone view.
import { esc, money, cls, verb } from "./util.js";
import * as E from "../engine.js";
import { tn, findQ, categories, winnerNames } from "./stage.js";
import { playerMinis } from "./minis.js";
import { renameBlock } from "./team.js";
import { OWN, OPP, punText } from "../puns.js";

export function renderPlayer(G) {
  const S = G.S;
  const me = G.me;
  return `<div class="phone ${me.team}">
    <header class="ph-top">
      <div class="me"><span class="dot ${me.team}"></span><div><b>${esc(me.name)}</b><small>${esc(tn(G, me.team))}</small></div></div>
      <button class="${cls("ph-sound", G.soundOn && "on")}" data-action="toggle-sound" title="Game sounds on this phone" aria-label="Sound ${G.soundOn ? "on" : "off"}">${G.soundOn ? "🔊" : "🔇"}</button>
      <div class="ph-scores">${E.TEAMS.map((t) => `<div class="${cls("phs", t, t === me.team && "mine")}"><small>${esc(tn(G, t))}</small><b class="${S.scores[t] < 0 ? "neg" : ""}">${money(S.scores[t])}</b></div>`).join("")}</div>
    </header>
    <main class="ph-main">${body(G)}</main>
  </div>`;
}

// Box the answering player types into (opens as soon as they win the buzz).
function answerBox(G, key, label, c) {
  const sent = G.spoken && G.spoken.key === key ? G.spoken : null;
  if (c && c.timeUp === key) {
    // Out of time: no more typing. Whatever was sent before the bell is what Jaren judges,
    // and the line under this says he's deciding.
    return sent && sent.text
      ? `<div class="typebox closed" data-key="tb-${esc(key)}-up"><div class="locked-note">Sent in time: “${esc(sent.text)}”</div></div>`
      : "";
  }
  return `<div class="typebox" data-key="tb-${esc(key)}">
    <label class="lbl" for="typed-answer">${label}</label>
    <textarea id="typed-answer" class="answer-input" rows="2" maxlength="200" placeholder="Type your answer…" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" data-sticky></textarea>
    <button class="btn primary big" data-action="typed-submit">Submit answer</button>
    ${sent && sent.text ? `<div class="locked-note">✓ Sent: “${esc(sent.text)}”${sent.name && sent.deviceId !== G.deviceId ? ` <small>by ${esc(sent.name)}</small>` : ""} <small>— you can change it until Jaren decides</small></div>` : ""}
  </div>`;
}

function card(emoji, title, text = "", extra = "") {
  return `<div class="ph-card hero">${emoji ? `<div class="big-emoji">${emoji}</div>` : ""}<h2>${title}</h2>${text ? `<p>${text}</p>` : ""}${extra}</div>`;
}
const timer = (deadline, total) => `<div class="ph-timer"><span class="cd" data-deadline="${deadline}" data-format="s"></span><div class="bar" data-deadline="${deadline}" data-total="${total}"><i></i></div></div>`;

function body(G) {
  const S = G.S;
  const me = G.me;
  if (S.phase === "lobby") {
    const mates = G.P.filter((p) => p.team === me.team);
    return card("🎄", `You're in, ${esc(me.name)}!`, "Waiting for Jaren to start the game.",
      `<div class="tips"><b>How to play</b><ul>
        <li>When the button turns <b class="red">red</b>, tap it as fast as you can.</li>
        <li>First tap wins — a box opens to type your answer.</li>
        <li>Multiple choice? Just tap your answer.</li>
      </ul></div>
      <div class="mates"><small>${esc(tn(G, me.team))}</small>${mates.map((p) => `<span class="chip" data-key="m-${esc(p.id)}">${esc(p.name)}</span>`).join("")}</div>
      ${renameBlock(G)}`);
  }
  if (S.phase === "minis") return playerMinis(G, renameBlock(G));
  if (S.phase === "board") {
    const mine = S.control === me.team;
    return card(mine ? "🎁" : "👀", mine ? "Your team picks next!" : S.control ? `${esc(tn(G, S.control))} ${verb(tn(G, S.control), "picks", "pick")} next` : "Next question coming up…",
      mine ? "Shout a category and amount to Jaren." : "Get that buzzer finger ready.") + phoneBoard(G);
  }
  if (S.phase === "clue" && S.clue) return clueBody(G);
  if (S.phase === "final") return finalBody(G);
  if (S.phase === "over" && S.vote && S.vote.stage !== "off") return voteBody(G);
  if (S.phase === "over") {
    const sc = S.scores;
    const tie = sc.team1 === sc.team2;
    const won = !tie && (sc.team1 > sc.team2 ? "team1" : "team2") === me.team;
    const champ = tn(G, sc.team1 > sc.team2 ? "team1" : "team2");
    return card(tie ? "🤝" : won ? "🏆" : "🎄", tie ? "It's a tie!" : won ? "Your team wins!" : `${esc(champ)} ${verb(champ, "wins", "win")}!`,
      won ? "Merry Christmas, champion! 🎉" : "Thanks for playing — Merry Christmas!") + myNight(G);
  }
  return card("⏳", "Hang tight…");
}

// What's left on the board, so the team can choose without looking at the TV.
function phoneBoard(G) {
  const cats = categories(G, G.S.round);
  if (!cats.length) return "";
  const rows = Math.max(...cats.map((c) => c.clues.length));
  let cells = cats.map((c) => `<div class="r-cat">${esc(c.name)}</div>`).join("");
  for (let r = 0; r < rows; r++) for (const c of cats) { const q = c.clues[r]; cells += !q || q.used ? `<div class="r-cell used"></div>` : `<div class="r-cell">${money(q.points)}</div>`; }
  const left = E.cluesLeft(G.Q, G.S.round);
  return `<div class="ph-board"><div class="lbl">🎁 Still under the tree — ${left} question${left === 1 ? "" : "s"}</div><div class="r-grid ph-grid" style="--cols:${cats.length}">${cells}</div></div>`;
}

// Game over: how this player did tonight, and the night's awards.
function myNight(G) {
  const me = E.playerStats(G.S)[G.deviceId];
  const list = E.nightAwards(G.S);
  const mine = list.filter((a) => a.winners.some((w) => w.pid === G.deviceId));
  const stat = (ico, v, label) => `<div class="ns"><i>${ico}</i><b>${v}</b><small>${label}</small></div>`;
  const stats = me ? [
    stat("🎁", me.right, `right answer${me.right === 1 ? "" : "s"}`),
    stat("❄️", me.wrong, me.wrong === 1 ? "miss" : "misses"),
    me.earned > 0 ? stat("💰", "+" + money(me.earned), `for ${esc(tn(G, G.me.team))}`) : "",
    me.fast != null ? stat("🦌", (me.fast / 1000).toFixed(2) + "s", "fastest buzz") : "",
    me.minis > 0 ? stat("🏆", me.minis, `mini-game win${me.minis === 1 ? "" : "s"}`) : "",
    me.drawing != null ? stat("🎨", me.drawing + "%", "best drawing") : "",
  ].join("") : "";
  // Awards this player won: one gold tag each (no run-on sentence).
  const won = mine.length ? `<div class="night-won"><div class="nw-head">🌟 You made the North Pole Awards! 🌟</div>
      ${mine.map((a) => `<div class="nw-tag aw-${a.id}"><span>${a.icon}</span><b>${esc(a.title)}</b></div>`).join("")}</div>` : "";
  const night = `<div class="ph-card night" data-key="night">
    <div class="lbl">📜 Your Nice List report</div>
    ${stats ? `<div class="night-stats">${stats}</div>` : `<p class="muted">Santa didn't catch you buzzing in this year — there's always next Christmas! 🎅</p>`}
    ${won}
  </div>`;
  if (!list.length) return night;
  return night + `<div class="ph-card ph-awards" data-key="awards"><div class="lbl">🌟 The North Pole Awards</div>
    ${list.map((a) => `<div class="${cls("pa-row", "aw-" + a.id, a.winners.some((w) => w.pid === G.deviceId) && "me")}"><span class="pa-ico">${a.icon}</span><span class="pa-txt"><small>${esc(a.title)}</small><b>${esc(winnerNames(G, a))}</b></span><span class="pa-det">${esc(a.detail)}</span></div>`).join("")}
  </div>`;
}

// Who just missed (shown while the other team gets a go).
function missedNote(G, c, q) {
  const m = c.missed;
  if (!m || !m.name) return "";
  const lost = q && !c.dd ? ` (−${money(q.points)})` : "";
  const out = m.why === "timeout";
  if (m.deviceId === G.deviceId) return `<div class="ph-missed mine">${out ? "⏰ Out of time — Santa's sleigh waits for no one!" : "🥶 Brrr — not quite!"}${lost}</div>`;
  if (m.team === G.me.team) return `<div class="ph-missed mine">${out ? `⏰ ${esc(m.name)} ran out of time` : `🥶 ${esc(m.name)} missed`}${lost}</div>`;
  return `<div class="ph-missed theirs">🎁 ${esc(m.name)} ${out ? "ran out of time" : "missed"} — your turn to steal it!</div>`;
}

// The question (and, for multiple choice, the options — so nobody has to look at the TV).
function clueBox(G, c, q, { options = true } = {}) {
  const value = c.dd ? `Daily Double${c.dd.wager ? " · " + money(c.dd.wager) : ""}` : money(q.points);
  const list = options && q.type === "mcq" && Array.isArray(q.choices)
    ? `<div class="ph-opts">${q.choices.map((ch, i) => (ch ? `<div class="${cls("ph-opt", c.eliminated.includes(i) && "out")}"><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></div>` : "")).join("")}</div>` : "";
  return `<div class="${cls("ph-clue", c.dd && "dd")}"><div class="ph-cat"><span>${esc(q.category)}</span><span>${esc(value)}</span></div><div class="ph-q">${esc(q.question)}</div>${list}</div>`;
}

function choices(G, c, q) {
  return `<div class="ph-mcq">${q.choices.map((ch, i) => ch
    ? `<button class="mcqbtn" data-action="mcq" data-i="${i}"${c.eliminated.includes(i) || E.isLate(c) ? " disabled" : ""}><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></button>` : "").join("")}</div>`;
}

// Who was fastest, to the hundredth of a second (and how you did, if you buzzed).
function reactionLine(G, c, key) {
  const order = c.order || [];
  if (!order.length) return "";
  const mineMs = G.myBuzzKey === key && Number.isFinite(G.myBuzzMs) && !order.some((o) => o.name === (G.me && G.me.name)) ? G.myBuzzMs : null;
  return `<div class="reaction">${order.slice(0, 3).map((o) => `<span class="${o.team}">⚡ ${esc(o.name)} ${(o.ms / 1000).toFixed(2)}s</span>`).join("")}${mineMs != null ? `<span class="me">you ${(mineMs / 1000).toFixed(2)}s</span>` : ""}</div>`;
}
function clueBody(G) {
  const S = G.S;
  const me = G.me;
  const c = S.clue;
  const q = findQ(G, c.id);
  if (!q) return card("⏳", "Loading question…");
  const set = S.settings || {};
  const key = E.lockKey(c);

  if (c.stage === "dd") {
    const team = c.dd.team;
    const head = `<div class="dd-mini">DAILY DOUBLE!</div>`;
    const cat = `<small class="muted">${esc(q.category)}</small>`;
    if (!team) return `<div class="ph-card dd-card">${head}<p>Someone found a Daily Double!</p>${cat}</div>`;
    // Anyone on the team can enter the wager; the first one locked counts.
    if (me.team !== team) return `<div class="ph-card dd-card">${head}<p>${esc(tn(G, team))} found it and ${verb(tn(G, team), "is", "are")} choosing a wager…</p>${cat}</div>`;
    const lim = E.ddLimits(S, G.Q, team);
    const half = Math.max(lim.min, Math.round(lim.max / 2 / 50) * 50);
    const quick = [[lim.min, `Min ${money(lim.min)}`], [half, money(half)], [lim.max, (S.scores[team] || 0) > 0 ? "All in!" : `Max ${money(lim.max)}`]]
      .filter((o, i, a) => a.findIndex((x) => x[0] === o[0]) === i)
      .map(([v, l]) => `<button class="chipbtn" data-action="ph-dd-quick" data-v="${v}">${l}</button>`).join("");
    return `<div class="ph-card dd-card">${head}<p>Your team found it — choose your wager! <small>(anyone on your team can lock it in)</small></p>${cat}
      <label class="wager-box big"><span>$</span><input id="ph-dd-wager" class="wager-input" type="number" inputmode="numeric" min="${lim.min}" max="${lim.max}" placeholder="Wager" autocomplete="off" data-sticky></label>
      <div class="quick">${quick}</div>
      <div class="hint">${money(lim.min)} – ${money(lim.max)}</div>
      <button class="btn primary big" data-action="ph-dd-lock">🔒 Lock my wager</button></div>`;
  }
  if (c.stage === "reading") {
    if (Date.now() < (G.earlyUntil || 0)) return `${clueBox(G, c, q)}<button class="buzz early" data-action="buzz" aria-label="Too soon"><span>TOO SOON!</span><small>Wait for it to turn green</small></button>`;
    return `${clueBox(G, c, q)}<button class="buzz wait" data-action="buzz" aria-label="Buzzer not open yet"><span>WAIT</span><small>Buzzers open soon</small></button>`;
  }
  if (c.stage === "open") {
    if (c.blocked.includes(me.team)) return `${missedNote(G, c, q)}${clueBox(G, c, q)}<div class="ph-note">Your team already had a go — fingers crossed! 🤞</div>`;
    if (G.myBuzzKey === key) return `${clueBox(G, c, q)}<button class="buzz sent" disabled><span>BUZZED!</span><small>⚡ ${(G.myBuzzMs / 1000).toFixed(2)}s — checking who was fastest…</small></button>`;
    if (Date.now() < (G.earlyUntil || 0)) return `${clueBox(G, c, q)}<button class="buzz early" data-action="buzz" aria-label="Too soon"><span>TOO SOON!</span><small>Wait for it to turn green</small></button>`;
    // Not open yet (it opens at the same instant on every phone): pressing now is too soon.
    if (G.now() < c.openedAt) return `${clueBox(G, c, q)}<button class="buzz wait" data-action="buzz" aria-label="Buzzer not open yet"><span>WAIT…</span><small>Get ready</small></button>`;
    const until = E.buzzDeadline(c, S.settings);
    return `${c.blocked.length ? missedNote(G, c, q) : ""}${clueBox(G, c, q)}<button class="buzz live" data-action="buzz" aria-label="Buzz in"><span>BUZZ!</span>${c.blocked.length ? "<small>Steal it!</small>" : ""}</button>${until ? timer(until, until - c.openedAt) : ""}`;
  }
  if (c.stage === "paused") return `${c.blocked.length ? missedNote(G, c, q) : ""}${clueBox(G, c, q)}<div class="ph-note">Buzzers paused…</div>`;

  if (c.stage === "answering" && c.locked) {
    const L = c.locked;
    const total = E.answerMs(c, set);
    const clock = c.submitted === key ? `<div class="ph-note">✓ Answer in — waiting for Jaren to judge</div>` : E.isLate(c) ? `<div class="ph-note timeup">⏰ Time's up — Jaren is deciding…</div>` : timer(L.at + total, total);
    if (c.dd) {
      if (me.team === c.dd.team) {
        return q.type === "mcq"
          ? `${clueBox(G, c, q, { options: false })}<div class="youup">⭐ Your team's Daily Double — pick together!</div>${choices(G, c, q)}${clock}`
          : `<div class="youup">⭐ Your team's Daily Double!</div>${answerBox(G, key, "Your team's answer", c)}${clock}${clueBox(G, c, q)}`;
      }
      return `${clueBox(G, c, q)}<div class="ph-note">${esc(tn(G, c.dd.team))} ${verb(tn(G, c.dd.team), "is", "are")} answering their Daily Double (${money(c.dd.wager)}).</div>${clock}`;
    }
    if (L.deviceId === G.deviceId) {
      if (q.type === "mcq") return `<div class="youup big">🎉 You're up! Tap your answer</div>${clueBox(G, c, q, { options: false })}${choices(G, c, q)}${clock}`;
      return `<div class="youup big">🎉 You're up!</div>${answerBox(G, key, "Your answer", c)}${clock}${clueBox(G, c, q)}`;
    }
    const mine = L.team === me.team;
    const pun = c.pun || {};
    const line = mine ? punText(OWN, pun.own, L.name) : punText(OPP, pun.opp, L.name);
    return `<div class="${cls("punbox", mine ? "ours" : "theirs")}" data-key="pun-${esc(key)}">
        <div class="pun-who">🔔 ${esc(L.name)} buzzed in${mine ? " for your team!" : ""}</div>
        <div class="pun-line">${esc(line)}</div>
      </div>${reactionLine(G, c, key)}${clock}${clueBox(G, c, q)}`;
  }

  if (c.stage === "done") {
    let res = "";
    if (c.result === "correct") {
      const mine = c.winner === me.team;
      const amt = `<b>+${money(c.dd ? c.dd.wager : q.points)}</b>`;
      const who = c.dd ? tn(G, c.winner) : c.locked ? c.locked.name : tn(G, c.winner);
      const line = !c.dd && c.locked && c.locked.deviceId === G.deviceId ? `🎅 Ho ho ho — you got it! ${amt} for your team`
        : c.dd && mine ? `🌟 Your team nailed the Daily Double! ${amt}`
          : mine ? `🎄 ${esc(who)} got it for your team! ${amt}`
            : `🥶 ${esc(who)} got it — ${esc(tn(G, c.winner))} ${amt}`;
      res = `<div class="${cls("ph-result", mine ? "yes" : "no")}">${line}</div>`;
    } else if (c.result === "nobody") {
      const meMissed = c.missed && c.missed.deviceId === G.deviceId;
      res = `<div class="ph-result none">${meMissed ? `🥶 Brrr — not quite (−${money(q.points)}). N` : "☃️ N"}obody got it!</div>`;
    } else if (c.result === "wrong") {
      const mine = c.dd && c.dd.team === me.team;
      res = `<div class="ph-result none">${mine ? `🥶 Your team missed the Daily Double (−${money(c.dd.wager)})` : `☃️ ${esc(tn(G, c.dd ? c.dd.team : ""))} missed the Daily Double!`}</div>`;
    }
    return `${res}${c.revealed ? `<div class="ph-answer"><small>Answer</small>${esc(q.answer)}</div>` : ""}${clueBox(G, c, q)}`;
  }
  return clueBox(G, c, q);
}

function finalBody(G) {
  const S = G.S;
  const me = G.me;
  const f = S.final;
  const fq = E.finalClue(G.Q);
  const cat = fq ? fq.category : "Final Jeopardy";
  const playing = f.eligible[me.team];
  if (f.stage === "wager") {
    if (!playing) return card("🍿", "Your team is sitting out Final Jeopardy", "Teams need more than $0 to play. Cheer everyone on!");
    const max = E.finalMax(S, me.team);
    const cur = f.wagers[me.team];
    if (cur) {
      // Locked in for the whole team; anyone on the team can take it back to change it.
      return `<div class="ph-card final-card">
      <div class="kicker">Final Jeopardy!</div>
      <div class="ph-final-cat">${esc(cat)}</div>
      <div class="sent-note"><div>✓ <b>Wager locked in for your team</b> by ${esc(cur.by)}</div><div class="sent-ans">${money(cur.amount)}</div>
        <button class="btn ghost" data-action="final-wager-undo">↩ Undo &amp; change it</button></div>
      <small class="muted">The other team can't see it.</small>
    </div>`;
    }
    return `<div class="ph-card final-card">
      <div class="kicker">Final Jeopardy!</div>
      <div class="ph-final-cat">${esc(cat)}</div>
      <p>Huddle up and choose your team's wager. The other team can't see it.</p>
      <label class="wager-box big"><span>$</span><input id="fw-input" class="wager-input" type="number" inputmode="numeric" min="0" max="${max}" placeholder="0 – ${max}" data-sticky></label>
      <div class="quick">${[[0, "$0"], [Math.floor(max / 2), "Half"], [max, "All in!"]].map(([v, l]) => `<button class="chipbtn" data-action="fw-quick" data-v="${v}">${l}</button>`).join("")}</div>
      <button class="btn primary big" data-action="final-wager">Lock in our wager</button>
      <small class="muted">Your team has ${money(S.scores[me.team])} — you can wager up to ${money(max)}.</small>
    </div>`;
  }
  if (f.stage === "clue") {
    const total = (S.settings.finalSeconds || 62) * 1000;
    const clue = `<div class="ph-clue ph-clue--final"><div class="ph-cat"><span>${esc(cat)}</span><span>Final</span></div><div class="ph-q">${esc(fq ? fq.question : "")}</div></div>`;
    if (!playing) return `${clue}${timer(f.deadline, total)}<div class="ph-note">Your team is sitting out — enjoy the show!</div>`;
    const cur = f.answers[me.team];
    // One answer per team: whoever submits first submits it for everyone; anyone on the
    // team can undo it and change it until the time is up.
    const sent = cur && cur.done && cur.text;
    const sentNote = sent ? `<div class="sent-note"><div>✓ <b>Submitted for your team</b> by ${esc(cur.by)}</div><div class="sent-ans">“${esc(cur.text)}”</div>
        <button class="btn ghost" data-action="final-undo">↩ Undo &amp; change it</button></div>` : "";
    if (fq && fq.type === "mcq") {
      return `${clue}${timer(f.deadline, total)}
      <div class="ph-card">
        <div class="lbl">${sent ? "Your team's answer" : "Pick your team's answer — one tap submits it for everyone"}</div>
        <div class="ph-mcq">${fq.choices.map((ch, i) => `<button class="${cls("mcqbtn", cur && cur.text === ch && "picked")}" data-action="final-choice" data-v="${esc(ch)}"${sent ? " disabled" : ""}><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></button>`).join("")}</div>
        ${sentNote}
      </div>`;
    }
    if (sent) return `${clue}${timer(f.deadline, total)}<div class="ph-card">${sentNote}</div>`;
    return `${clue}${timer(f.deadline, total)}
      <div class="ph-card">
        <label class="lbl" for="fa-input">Your team's answer <small class="muted">— anyone on your team can submit it</small></label>
        <textarea id="fa-input" class="answer-input" rows="2" maxlength="200" placeholder="What is…?" data-input="final-answer" data-sticky>${esc(cur ? cur.text : "")}</textarea>
        <button class="btn primary big" data-action="final-answer">Submit for my team</button>
        ${cur && cur.text ? `<small class="muted">Draft saved: “${esc(cur.text)}” (${esc(cur.by)}) — counts if time runs out.</small>` : `<small class="muted">Saves as you type. Whatever's saved when time runs out counts.</small>`}
      </div>`;
  }
  // reveal
  const res = f.results[me.team];
  const w = f.wagers[me.team];
  return card(res === "correct" ? "🎉" : res === "wrong" ? "😬" : "🎬",
    res ? (res === "correct" ? "Your team got Final Jeopardy right!" : "Not this time!") : "Watch the big screen!",
    res && w ? `Your wager: ${money(w.amount)}` : playing ? "Answers are being revealed…" : "");
}

// ---------------- ugly sweater vote ----------------
function voteBody(G) {
  const S = G.S, V = E.voteOf(S);
  if (V.stage === "setup") return card("🧶", "Ugly sweater vote!", "Jaren is checking who's in the running. Get ready to vote…");
  if (V.stage === "reveal") {
    const r = E.voteResults(S);
    const me = r.winners.some((w) => w.pid === G.deviceId);
    return card(me ? "👑" : "🧶", r.winners.length ? `${esc(r.winners.map((w) => w.name).join(" & "))} ${r.winners.length > 1 ? "win" : "wins"}!` : "No votes this time",
      me ? "Your sweater is officially the ugliest. Congratulations! 🎉" : "Ugliest sweater of the year — check the big screen!");
  }
  const pr = E.voteProgress(S, G.P);
  const mine = V.votes[G.deviceId];
  const options = V.candidates.filter((pid) => pid !== G.deviceId);
  return `<div class="ph-card">
    <div class="lbl">🧶 Vote for the ugliest sweater</div>
    <div class="${cls("ph-vote", options.length > 10 && "many")}">${options.map((pid) => `<button class="${cls("mcqbtn", mine === pid && "picked")}" data-action="vote-cast" data-pid="${esc(pid)}"><b>${mine === pid ? "✓" : "🧶"}</b><span>${esc(V.names[pid] || "?")}</span></button>`).join("")}</div>
    ${mine ? `<div class="locked-note">✓ Vote saved for <b>${esc(V.names[mine] || "?")}</b> <small>— you can change it until everyone has voted</small></div>` : `<p class="muted">Your vote is secret. Results show once everyone has voted.</p>`}
    <p class="muted">${pr.cast} of ${pr.total} votes in</p>
  </div>`;
}
