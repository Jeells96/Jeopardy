// Player phone view.
import { esc, money, cls, verb } from "./util.js";
import * as E from "../engine.js";
import { tn, findQ } from "./stage.js";
import { playerMinis } from "./minis.js";
import { renameBlock } from "./team.js";
import { OWN, OPP, punText } from "../puns.js";

export function renderPlayer(G) {
  const S = G.S;
  const me = G.me;
  return `<div class="phone ${me.team}">
    <header class="ph-top">
      <div class="me"><span class="dot ${me.team}"></span><div><b>${esc(me.name)}</b><small>${esc(tn(G, me.team))}</small></div></div>
      <div class="ph-scores">${E.TEAMS.map((t) => `<div class="${cls("phs", t, t === me.team && "mine")}"><small>${esc(tn(G, t))}</small><b class="${S.scores[t] < 0 ? "neg" : ""}">${money(S.scores[t])}</b></div>`).join("")}</div>
    </header>
    <main class="ph-main">${body(G)}</main>
  </div>`;
}

// Box the answering player types into (opens as soon as they win the buzz).
function answerBox(G, key, label) {
  const sent = G.spoken && G.spoken.key === key ? G.spoken : null;
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
      mine ? "Shout a category and amount to Jaren." : "Get that buzzer finger ready.");
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
      won ? "Merry Christmas, champion! 🎉" : "Thanks for playing — Merry Christmas!");
  }
  return card("⏳", "Hang tight…");
}

function clueBox(G, c, q) {
  const value = c.dd ? `Daily Double${c.dd.wager ? " · " + money(c.dd.wager) : ""}` : money(q.points);
  return `<div class="${cls("ph-clue", c.dd && "dd")}"><div class="ph-cat"><span>${esc(q.category)}</span><span>${esc(value)}</span></div><div class="ph-q">${esc(q.question)}</div></div>`;
}

function choices(G, c, q) {
  return `<div class="ph-mcq">${q.choices.map((ch, i) => ch
    ? `<button class="mcqbtn" data-action="mcq" data-i="${i}"${c.eliminated.includes(i) ? " disabled" : ""}><b>${"ABCDEF"[i]}</b><span>${esc(ch)}</span></button>` : "").join("")}</div>`;
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
    const mine = c.dd.team === me.team;
    return `<div class="ph-card dd-card"><div class="dd-mini">DAILY DOUBLE!</div><p>${mine ? "Your team found it! Tell Jaren your wager." : c.dd.team ? `${esc(tn(G, c.dd.team))} found it and ${verb(tn(G, c.dd.team), "is", "are")} wagering…` : "Someone found a Daily Double!"}</p><small class="muted">${esc(q.category)}</small></div>`;
  }
  if (c.stage === "reading") {
    return `${clueBox(G, c, q)}<button class="buzz wait" disabled aria-label="Buzzer not open yet"><span>WAIT</span><small>Buzzers open soon</small></button>`;
  }
  if (c.stage === "open") {
    if (c.blocked.includes(me.team)) return `${clueBox(G, c, q)}<div class="ph-note">Your team already had a go — fingers crossed! 🤞</div>`;
    if (G.myBuzzKey === key) return `${clueBox(G, c, q)}<button class="buzz sent" disabled><span>BUZZED!</span><small>Checking who was first…</small></button>`;
    return `${clueBox(G, c, q)}<button class="buzz live" data-action="buzz" aria-label="Buzz in"><span>BUZZ!</span></button>`;
  }
  if (c.stage === "paused") return `${clueBox(G, c, q)}<div class="ph-note">Buzzers paused…</div>`;

  if (c.stage === "answering" && c.locked) {
    const L = c.locked;
    const total = (set.answerSeconds || 15) * 1000;
    const clock = c.submitted === key ? `<div class="ph-note">✓ Answer in — waiting for Jaren to judge</div>` : c.timeUp === key ? `<div class="ph-note timeup">⏰ Time's up!</div>` : timer(L.at + total, total);
    if (c.dd) {
      if (me.team === c.dd.team) {
        return q.type === "mcq"
          ? `${clueBox(G, c, q)}<div class="youup">⭐ Your team's Daily Double — pick together!</div>${choices(G, c, q)}${clock}`
          : `<div class="youup">⭐ Your team's Daily Double!</div>${answerBox(G, key, "Your team's answer")}${clock}${clueBox(G, c, q)}`;
      }
      return `${clueBox(G, c, q)}<div class="ph-note">${esc(tn(G, c.dd.team))} ${verb(tn(G, c.dd.team), "is", "are")} answering their Daily Double (${money(c.dd.wager)}).</div>${clock}`;
    }
    if (L.deviceId === G.deviceId) {
      if (q.type === "mcq") return `<div class="youup big">🎉 You're up! Tap your answer</div>${clueBox(G, c, q)}${choices(G, c, q)}${clock}`;
      return `<div class="youup big">🎉 You're up!</div>${answerBox(G, key, "Your answer")}${clock}${clueBox(G, c, q)}`;
    }
    const mine = L.team === me.team;
    const pun = c.pun || {};
    const line = mine ? punText(OWN, pun.own, L.name) : punText(OPP, pun.opp, L.name);
    return `<div class="${cls("punbox", mine ? "ours" : "theirs")}" data-key="pun-${esc(key)}">
        <div class="pun-who">🔔 ${esc(L.name)} buzzed in${mine ? " for your team!" : ""}</div>
        <div class="pun-line">${esc(line)}</div>
      </div>${clock}${clueBox(G, c, q)}`;
  }

  if (c.stage === "done") {
    let res = "";
    if (c.result === "correct") {
      const mine = c.winner === me.team;
      res = `<div class="${cls("ph-result", mine ? "yes" : "no")}">${mine ? "🎉" : "😬"} ${esc(c.dd ? tn(G, c.winner) : c.locked ? c.locked.name : tn(G, c.winner))} got it! <b>+${money(c.dd ? c.dd.wager : q.points)}</b></div>`;
    } else if (c.result === "nobody") res = `<div class="ph-result none">Nobody got it!</div>`;
    else if (c.result === "wrong") res = `<div class="ph-result none">Daily Double missed!</div>`;
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
    return `<div class="ph-card final-card">
      <div class="kicker">Final Jeopardy!</div>
      <div class="ph-final-cat">${esc(cat)}</div>
      <p>Huddle up and choose your team's wager. The other team can't see it.</p>
      <label class="wager-box big"><span>$</span><input id="fw-input" class="wager-input" type="number" inputmode="numeric" min="0" max="${max}" placeholder="0 – ${max}" data-sticky></label>
      <div class="quick">${[[0, "$0"], [Math.floor(max / 2), "Half"], [max, "All in!"]].map(([v, l]) => `<button class="chipbtn" data-action="fw-quick" data-v="${v}">${l}</button>`).join("")}</div>
      <button class="btn primary big" data-action="final-wager">${cur ? "Update our wager" : "Lock in our wager"}</button>
      ${cur ? `<div class="locked-note">✓ Your team's wager: <b>${money(cur.amount)}</b> <small>set by ${esc(cur.by)}</small></div>` : ""}
      <small class="muted">Your team has ${money(S.scores[me.team])} — you can wager up to ${money(max)}.</small>
    </div>`;
  }
  if (f.stage === "clue") {
    const total = (S.settings.finalSeconds || 31) * 1000;
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
    <div class="ph-vote">${options.map((pid) => `<button class="${cls("mcqbtn", mine === pid && "picked")}" data-action="vote-cast" data-pid="${esc(pid)}"><b>${mine === pid ? "✓" : "🧶"}</b><span>${esc(V.names[pid] || "?")}</span></button>`).join("")}</div>
    ${mine ? `<div class="locked-note">✓ Vote saved for <b>${esc(V.names[mine] || "?")}</b> <small>— you can change it until everyone has voted</small></div>` : `<p class="muted">Your vote is secret. Results show once everyone has voted.</p>`}
    <p class="muted">${pr.cast} of ${pr.total} votes in</p>
  </div>`;
}
