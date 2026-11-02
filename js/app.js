// Christmas Jeopardy — routing + all views.
import * as D from "./data.js";
import { downloadTemplate, parseWorkbook } from "./xlsx.js";
import * as Speech from "./speech.js";
import * as Sounds from "./sounds.js";
import { OWN, OPP, punText } from "./puns.js";

const ADMIN_CODE = "2325";

// ---- Live caches ----
let S = null;              // game state
let QUESTIONS = [];        // all question docs
let PLAYERS = [];          // all players
let BUZZES = [];           // buzzes for the current round
let buzzUnsub = null;      // unsubscribe for the per-round buzz query
let watchedRound = -1;

const app = () => document.getElementById("app");
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  return h || "home";
}
function go(r) { location.hash = "#/" + r; }

function isAdminOk() { return sessionStorage.getItem("jeop_admin_ok") === "1"; }
function setAdminOk() { sessionStorage.setItem("jeop_admin_ok", "1"); }

// ---- Question helpers ----
function qById(id) { return QUESTIONS.find((q) => q.id === id) || null; }
function boardQuestions() { return QUESTIONS.filter((q) => !q.isFinal); }
function finalQuestion() { return QUESTIONS.find((q) => q.isFinal) || null; }

function categories() {
  const order = [];
  const map = {};
  for (const q of boardQuestions()) {
    if (!map[q.category]) { map[q.category] = []; order.push(q.category); }
    map[q.category].push(q);
  }
  for (const c of order) {
    map[c].sort((a, b) => (a.points - b.points) || (a.order - b.order));
  }
  return order.map((c) => ({ name: c, clues: map[c] }));
}

function teamName(t) { return (S && S.teamNames && S.teamNames[t]) || (t === "team1" ? "Team 1" : "Team 2"); }

// ---- Countdown ----
function remainingAnswer() {
  if (!S || !S.lockedAt) return null;
  const secs = (S.settings && S.settings.answerSeconds) || 30;
  return Math.max(0, secs - (Date.now() - S.lockedAt) / 1000);
}
function remainingFinal() {
  if (!S || !S.final || !S.final.deadline) return null;
  return Math.max(0, (S.final.deadline - Date.now()) / 1000);
}

// =================================================================
// RENDER
// =================================================================
function render() {
  const r = route();
  if (r === "home") return renderHome();
  if (r === "play") return renderPlay();
  if (r === "board") return renderBoard();
  if (r === "admin") return isAdminOk() ? renderAdmin() : renderCodeGate("admin", "Jaren's View");
  if (r === "cheat") return isAdminOk() ? renderCheat() : renderCodeGate("cheat", "Cheat Sheet");
  return renderHome();
}

// ---------------- HOME / JOIN ----------------
function renderHome() {
  const id = D.getLocalIdentity();
  if (id) {
    app().innerHTML = `
      <div class="screen center">
        <div class="snowcard">
          <h1 class="title">🎄 Christmas Jeopardy 🎅</h1>
          <p class="welcome">Welcome back, <strong>${esc(id.name)}</strong> — ${esc(teamName(id.team))}!</p>
          <button class="btn big" data-action="goto" data-r="play">Go to my game ▶</button>
          <div class="homelinks">
            <button class="btn ghost" data-action="goto" data-r="admin">🔒 Jaren's View</button>
            <button class="btn ghost" data-action="goto" data-r="board">📺 Projector Board</button>
          </div>
          <p class="fineprint">Not you? Ask Jaren to reset your name.</p>
        </div>
      </div>`;
    return;
  }
  app().innerHTML = `
    <div class="screen center">
      <div class="snowcard">
        <h1 class="title">🎄 Christmas Jeopardy 🎅</h1>
        <p class="subtitle">Enter your name and pick a team to play.</p>
        <div class="warnbox">⚠️ <strong>Choose carefully!</strong> Your name and team are saved on this device and <strong>can't be changed</strong> once you join.</div>
        <label class="fld">Your name
          <input id="jn-name" class="input" maxlength="24" placeholder="e.g. Grandma Jo" />
        </label>
        <div class="teampick">
          <button class="teambtn t1" data-action="pickteam" data-t="team1">
            <span class="tball">🔴</span> ${esc(teamName("team1"))}
          </button>
          <button class="teambtn t2" data-action="pickteam" data-t="team2">
            <span class="tball">🟢</span> ${esc(teamName("team2"))}
          </button>
        </div>
        <button class="btn big" id="jn-go" data-action="join" disabled>Join the game 🎁</button>
        <div class="homelinks">
          <button class="btn ghost" data-action="goto" data-r="admin">🔒 Jaren's View</button>
          <button class="btn ghost" data-action="goto" data-r="board">📺 Projector Board</button>
        </div>
      </div>
    </div>`;
}

// ---------------- CODE GATE ----------------
function renderCodeGate(target, label) {
  app().innerHTML = `
    <div class="screen center">
      <div class="snowcard">
        <h1 class="title">🔒 ${esc(label)}</h1>
        <p class="subtitle">Enter the host code to continue.</p>
        <input id="code-in" class="input code" inputmode="numeric" maxlength="8" placeholder="• • • •" />
        <div id="code-err" class="errline"></div>
        <button class="btn big" data-action="code-login" data-target="${target}">Enter</button>
        <button class="btn ghost" data-action="goto" data-r="home">← Back</button>
      </div>
    </div>`;
  setTimeout(() => document.getElementById("code-in")?.focus(), 50);
}

// ---------------- PLAYER ----------------
function renderPlay() {
  const id = D.getLocalIdentity();
  if (!id) { go("home"); return; }
  if (!S) { app().innerHTML = loading(); return; }

  const myTeam = id.team;
  const q = qById(S.currentQuestionId);
  let body = "";

  if (S.final && S.final.active) {
    body = playerFinal(id);
  } else if (!q || S.phase === "lobby") {
    body = `<div class="pstatus big">🎄 Get ready!<br><span class="dim">Waiting for the host to pick a clue…</span></div>`;
  } else {
    body = playerQuestion(id, q, myTeam);
  }

  app().innerHTML = `
    <div class="screen player">
      ${scoreBar()}
      <div class="pname">You: <strong>${esc(id.name)}</strong> · <span class="chip ${myTeam}">${esc(teamName(myTeam))}</span></div>
      ${micBanner()}
      ${body}
    </div>`;
}

// Mic status / pre-game enable prompt.
function micBanner() {
  if (!Speech.micSupported()) {
    return `<div class="micbar off">🎙️ This device can't capture speech — no problem, just answer out loud when it's your turn.</div>`;
  }
  if (Speech.micEnabled() && !Speech.speechDenied()) {
    return `<div class="micbar on">🎙️ Microphone ready — when you're the one answering, it listens automatically.</div>`;
  }
  return `<div class="micbar prompt">
    <div>🎙️ <strong>Enable your microphone before the game</strong> so it can capture your spoken answers.</div>
    <button class="btn gold" data-action="enable-mic">Enable microphone</button>
  </div>`;
}

function playerQuestion(id, q, myTeam) {
  const locked = S.lockedBuzzer;
  const iAmLocked = locked && locked.deviceId === D.deviceId();
  const blocked = (S.blockedTeams || []).includes(myTeam);
  const iBuzzed = BUZZES.some((b) => b.deviceId === D.deviceId() && b.round === S.buzzRound);

  // The clue text (everyone may read along).
  const clue = `<div class="pclue"><div class="pcat">${esc(q.category)} · ${q.points}${q.dailyDouble ? " · ⭐ DAILY DOUBLE" : ""}</div><div class="pq">${esc(q.question)}</div></div>`;

  if (S.resolved) {
    return clue + `<div class="pstatus">${S.revealAnswer ? "Answer: <strong>" + esc(q.answer) + "</strong>" : "✔ Clue closed."}<br><span class="dim">Waiting for the next clue…</span></div>`;
  }

  // I'm the one answering.
  if (iAmLocked) {
    if (q.type === "mcq") {
      const sel = S.mcqSelection;
      if (sel) {
        return clue + `<div class="pstatus big">${sel.correct ? "✅ Correct!" : "❌ Not quite."}</div>`;
      }
      return clue + `<div class="pstatus">👉 You're up! Tap your answer:</div>` +
        `<div class="mcq">` + q.choices.map((c, i) =>
          c ? `<button class="mcqbtn" data-action="mcq-pick" data-i="${i}"><b>${"ABCD"[i]}</b> ${esc(c)}</button>` : ""
        ).join("") + `</div><div class="timerline">⏱ ${fmt(remainingAnswer())}</div>`;
    }
    // Spoken answer — mic listens automatically and shows what it heard.
    const sa = S.spokenAnswer && S.spokenAnswer.deviceId === D.deviceId() ? S.spokenAnswer : null;
    let mic;
    if (!Speech.micSupported() || Speech.speechDenied() || !Speech.micEnabled()) {
      mic = `<div class="pstatus dim">Answer out loud — the host will score it.</div>`;
    } else {
      mic = `<div class="listening">🎙️ <span class="pulse-dot"></span> Listening…</div>` +
        (sa && sa.text ? `<div class="heard">I heard: “${esc(sa.text)}”</div>` : `<div class="heard dim">Say your answer…</div>`);
    }
    return clue + `<div class="pstatus big youup">🎤 You're up!</div>${mic}<div class="timerline">⏱ ${fmt(remainingAnswer())}</div>`;
  }

  // Someone else is answering — show this viewer's team-appropriate holiday pun.
  if (locked) {
    const onAnsweringTeam = myTeam === locked.team;
    const pun = S.pun || {};
    const line = onAnsweringTeam
      ? punText(OWN, pun.own, locked.name)
      : punText(OPP, pun.opp, locked.name);
    return clue +
      `<div class="punbox ${onAnsweringTeam ? "ourturn" : "theirturn"}">
         <div class="punwho">🔔 ${esc(locked.name)} buzzed in${onAnsweringTeam ? " for your team!" : "…"}</div>
         <div class="punline">${esc(line)}</div>
       </div>
       <div class="timerline">⏱ ${fmt(remainingAnswer())}</div>`;
  }

  // Buzzers open?
  if (S.buzzOpen) {
    if (blocked) return clue + `<div class="pstatus">🚫 Your team already had a turn on this clue.</div>`;
    if (iBuzzed) return clue + `<div class="pstatus big">✅ You buzzed!<br><span class="dim">Waiting to see who was first…</span></div>`;
    return clue + `<button class="buzzer" data-action="buzz">BUZZ!</button>`;
  }

  return clue + `<div class="pstatus">✋ Buzzers locked. Get ready…</div>`;
}

function playerFinal(id) {
  const f = S.final;
  const fq = finalQuestion();
  if (f.stage === "wager" || f.stage === "idle") {
    return `<div class="pstatus big">🎯 FINAL JEOPARDY<br><span class="dim">Category: ${esc(f.category || (fq && fq.category) || "?")}</span><br><br>Decide your team's wager with your teammates — the host will enter it.</div>`;
  }
  if (f.stage === "question") {
    return `<div class="pclue"><div class="pcat">FINAL JEOPARDY · ${esc(f.category || "")}</div><div class="pq">${esc(fq ? fq.question : "")}</div></div><div class="timerline big">⏱ ${fmt(remainingFinal())}</div><div class="pstatus dim">Write / say your final answer!</div>`;
  }
  return `<div class="pstatus big">🏁 Final results on the big screen!</div>`;
}

// ---------------- BOARD / PROJECTOR ----------------
function renderBoard() {
  if (!S) { app().innerHTML = loading(); return; }
  let body;
  if (S.final && S.final.active) body = boardFinal();
  else if (!qById(S.currentQuestionId) || S.phase === "lobby") body = boardGrid(false);
  else body = boardClue();

  app().innerHTML = `
    <div class="screen board">
      <button class="soundtoggle" data-action="toggle-sound">${Sounds.soundEnabled() ? "🔊" : "🔇 Tap for sound"}</button>
      <div class="boardhead">
        <h1 class="btitle">🎄 Christmas Jeopardy 🎅</h1>
        ${scoreBar(true)}
      </div>
      ${body}
    </div>`;
}

function boardGrid(clickable) {
  const cats = categories();
  if (!cats.length) {
    return `<div class="emptyboard">🎁 No questions loaded yet.<br><span class="dim">Host: import your spreadsheet in Jaren's View.</span></div>`;
  }
  const maxRows = Math.max(...cats.map((c) => c.clues.length));
  let html = `<div class="grid" style="grid-template-columns:repeat(${cats.length},1fr)">`;
  for (const c of cats) html += `<div class="gcat">${esc(c.name)}</div>`;
  for (let row = 0; row < maxRows; row++) {
    for (const c of cats) {
      const q = c.clues[row];
      if (!q) { html += `<div class="gcell empty"></div>`; continue; }
      const used = q.used;
      const attrs = clickable && !used ? `data-action="pick-question" data-id="${q.id}"` : "";
      html += `<div class="gcell ${used ? "used" : ""} ${clickable && !used ? "clickable" : ""}" ${attrs}>${used ? "" : q.points}${!used && q.dailyDouble && clickable ? " ⭐" : ""}</div>`;
    }
  }
  html += `</div>`;
  if (clickable) {
    const fq = finalQuestion();
    html += `<div class="finalrow">`;
    html += fq
      ? `<button class="btn gold" data-action="final-start">🎯 Start Final Jeopardy</button>`
      : `<span class="dim">No Final Jeopardy clue loaded.</span>`;
    html += `</div>`;
  }
  return html;
}

function boardClue() {
  const q = qById(S.currentQuestionId);
  const locked = S.lockedBuzzer;
  let banner = "";
  if (q.dailyDouble) banner = `<div class="ddbanner">⭐ DAILY DOUBLE ⭐</div>`;

  let status = "";
  if (S.resolved) {
    status = `<div class="revealbox">Answer: <strong>${esc(q.answer)}</strong></div>`;
  } else if (locked) {
    const sa = S.spokenAnswer && locked.deviceId !== "dd" ? S.spokenAnswer : null;
    const heard = sa && sa.text ? `<div class="boardheard">🎤 “${esc(sa.text)}”</div>` : "";
    status = `<div class="answering"><span class="chip ${locked.team}">${esc(locked.name)} · ${esc(teamName(locked.team))}</span><div class="bigtimer ${remainingAnswer() <= 5 ? "danger" : ""}">${Math.ceil(remainingAnswer())}</div>${heard}</div>`;
  } else if (S.buzzOpen) {
    status = `<div class="buzzopen">🔔 BUZZERS OPEN 🔔</div>`;
  } else {
    status = `<div class="buzzwait">✋ Buzzers locked — host is reading the clue…</div>`;
  }

  // Ordered buzz list (first highlighted)
  let queue = "";
  if (BUZZES.length) {
    queue = `<div class="queue"><div class="qhead">Buzz order</div>` +
      BUZZES.slice(0, 8).map((b, i) =>
        `<div class="qrow ${i === 0 ? "first" : ""}"><span class="qpos">${i + 1}</span> ${esc(b.name)} <span class="chip ${b.team} mini">${esc(teamName(b.team))}</span></div>`
      ).join("") + `</div>`;
  }

  // MCQ choices on board (reveal correct only when resolved)
  let choices = "";
  if (q.type === "mcq") {
    choices = `<div class="bmcq">` + q.choices.map((c, i) => {
      if (!c) return "";
      const isSel = S.mcqSelection && S.mcqSelection.index === i;
      const isCorrect = S.resolved && i === q.correctIndex;
      const isWrongSel = S.resolved && isSel && i !== q.correctIndex;
      return `<div class="bchoice ${isCorrect ? "correct" : ""} ${isWrongSel ? "wrong" : ""}"><b>${"ABCD"[i]}</b> ${esc(c)}</div>`;
    }).join("") + `</div>`;
  }

  return `
    <div class="clueview">
      ${banner}
      <div class="cluecat">${esc(q.category)} — ${q.points}${S.dailyDouble ? " (wager " + S.dailyDouble.wager + ")" : ""}</div>
      <div class="cluetext">${esc(q.question)}</div>
      ${choices}
      ${status}
      ${queue}
    </div>`;
}

function boardFinal() {
  const f = S.final;
  const fq = finalQuestion();
  if (f.stage === "wager" || f.stage === "idle") {
    return `<div class="clueview"><div class="ddbanner">🎯 FINAL JEOPARDY</div><div class="cluecat">Category</div><div class="cluetext">${esc(f.category || (fq && fq.category) || "")}</div><div class="buzzwait">Teams are placing their wagers…</div></div>`;
  }
  if (f.stage === "question") {
    return `<div class="clueview"><div class="ddbanner">🎯 FINAL JEOPARDY</div><div class="cluecat">${esc(f.category || "")}</div><div class="cluetext">${esc(fq ? fq.question : "")}</div><div class="bigtimer ${remainingFinal() <= 10 ? "danger" : ""}">${Math.ceil(remainingFinal())}</div></div>`;
  }
  // reveal / done
  const rows = ["team1", "team2"].map((t) => {
    const res = f.results[t];
    const w = f.wagers[t] || 0;
    return `<div class="frow"><span class="chip ${t}">${esc(teamName(t))}</span> wager ${w} — ${res ? (res === "correct" ? "✅ Correct" : "❌ Wrong") : "—"}</div>`;
  }).join("");
  let winner = "";
  if (f.stage === "done") {
    const s = S.scores || { team1: 0, team2: 0 };
    winner = `<div class="ddbanner">${s.team1 === s.team2 ? "🤝 It's a tie!" : "🏆 " + esc(teamName(s.team1 > s.team2 ? "team1" : "team2")) + " wins!"}</div>`;
  }
  return `<div class="clueview"><div class="ddbanner">🎯 FINAL — ${esc(f.category || "")}</div><div class="cluetext">${esc(fq ? fq.answer : "")}</div>${rows}${winner}</div>`;
}

// ---------------- CHEAT SHEET ----------------
function renderCheat() {
  if (!S) { app().innerHTML = loading(); return; }
  const f = S.final && S.final.active;
  const q = f ? finalQuestion() : qById(S.currentQuestionId);
  let inner;
  if (!q) {
    inner = `<div class="cheatwait">No clue selected yet.</div>`;
  } else {
    let correctLine = "";
    if (q.type === "mcq") {
      const idx = q.correctIndex;
      correctLine = `<div class="cheatmcq">Correct: <strong>${idx >= 0 ? "ABCD"[idx] + ". " + esc(q.choices[idx]) : "—"}</strong></div>`;
    }
    // Live spoken answer + whether it seems to match (host's private hint).
    let heardLine = "";
    if (!f && q.type !== "mcq" && S.lockedBuzzer && S.lockedBuzzer.deviceId !== "dd") {
      const sa = S.spokenAnswer;
      if (sa && sa.text) {
        const match = Speech.answerMatches(sa.text, q.answer);
        heardLine = `<div class="cheatheard ${match ? "match" : "nomatch"}">🎤 “${esc(sa.text)}” ${match ? "— ✅ sounds right" : "— ❓ not a clear match"}</div>`;
      } else if (!S.resolved) {
        heardLine = `<div class="cheatheard dim">🎤 waiting for them to speak…</div>`;
      }
    }
    inner = `
      <div class="cheatcat">${f ? "FINAL · " : ""}${esc(q.category)}${q.isFinal ? "" : " · " + q.points}${q.dailyDouble ? " · ⭐DD" : ""}</div>
      <div class="cheatq">${esc(q.question)}</div>
      <div class="cheatans">✅ ${esc(q.answer) || "(no answer typed)"}</div>
      ${correctLine}
      ${heardLine}`;
  }
  app().innerHTML = `
    <div class="screen cheat">
      <div class="cheathead">🤫 Cheat Sheet <span class="dim">(keep this device OFF the projector)</span></div>
      ${inner}
      <button class="btn ghost" data-action="goto" data-r="admin">← Controls</button>
    </div>`;
}

// ---------------- ADMIN ----------------
function renderAdmin() {
  if (!S) { app().innerHTML = loading(); return; }
  const q = qById(S.currentQuestionId);
  let main;
  if (S.final && S.final.active) main = adminFinal();
  else if (!q || S.phase === "lobby") main = `<div class="adminboardwrap">${boardGrid(true)}</div>`;
  else main = adminClue(q);

  const settings = S.settings || {};
  app().innerHTML = `
    <div class="screen admin">
      <div class="adminbar">
        <div class="abtitle">🎅 Jaren's Control</div>
        <div class="scoreedit">
          ${["team1", "team2"].map((t) => `
            <div class="se ${t}">
              <input class="tnin" data-action="rename-team" data-t="${t}" value="${esc(teamName(t))}" />
              <div class="sectl"><button class="mini-btn" data-action="adj" data-t="${t}" data-d="-100">−</button>
              <span class="sc">${(S.scores && S.scores[t]) || 0}</span>
              <button class="mini-btn" data-action="adj" data-t="${t}" data-d="100">+</button></div>
            </div>`).join("")}
        </div>
        <div class="setts">
          <label>Answer timer (s)<input type="number" min="3" class="numin" id="set-answer" value="${settings.answerSeconds || 30}" data-action="set-answer" /></label>
          <label>Final timer (s)<input type="number" min="5" class="numin" id="set-final" value="${settings.finalSeconds || 60}" data-action="set-final" /></label>
        </div>
        <div class="adminlinks">
          <button class="btn ghost" data-action="toggle-sound">${Sounds.soundEnabled() ? "🔊 Sound on" : "🔇 Sound off"}</button>
          <a class="btn ghost" href="#/board" target="_blank" rel="noopener">📺 Board</a>
          <a class="btn ghost" href="#/cheat" target="_blank" rel="noopener">🤫 Cheat Sheet</a>
        </div>
      </div>

      ${main}

      <details class="tools">
        <summary>🛠 Questions & Players</summary>
        <div class="toolgrid">
          <div class="toolcard">
            <h4>Questions</h4>
            <button class="btn" data-action="download-template">⬇ Download XLSX template</button>
            <label class="btn file">⬆ Import questions<input type="file" id="qfile" accept=".xlsx,.xls" hidden data-action="import" /></label>
            <div id="import-msg" class="dim">${QUESTIONS.length} clues loaded${finalQuestion() ? " (incl. Final)" : ""}.</div>
          </div>
          <div class="toolcard">
            <h4>Players (${PLAYERS.length})</h4>
            <div class="playerlist">
              ${PLAYERS.map((p) => `
                <div class="prow">
                  <input class="pnin" data-action="rename-player" data-id="${p.id}" value="${esc(p.name)}" />
                  <select data-action="reteam-player" data-id="${p.id}">
                    <option value="team1" ${p.team === "team1" ? "selected" : ""}>${esc(teamName("team1"))}</option>
                    <option value="team2" ${p.team === "team2" ? "selected" : ""}>${esc(teamName("team2"))}</option>
                  </select>
                  <button class="mini-btn danger" data-action="remove-player" data-id="${p.id}">✕</button>
                </div>`).join("") || `<div class="dim">No one has joined yet.</div>`}
            </div>
          </div>
          <div class="toolcard">
            <h4>Danger zone</h4>
            <button class="btn danger" data-action="reset-scores">Reset scores</button>
            <button class="btn danger" data-action="reset-board">Reset board (un-use all clues)</button>
            <button class="btn danger" data-action="full-reset">Full reset</button>
          </div>
        </div>
      </details>
    </div>`;
}

function adminClue(q) {
  const locked = S.lockedBuzzer;
  const rem = remainingAnswer();
  const expired = rem !== null && rem <= 0;
  const value = S.dailyDouble ? S.dailyDouble.wager : q.points;

  let controls = "";

  // Daily Double setup (before buzzers)
  if (q.dailyDouble && !S.dailyDouble && !S.buzzOpen && !locked && !S.resolved) {
    controls = `
      <div class="ddsetup">
        <div class="ddbanner small">⭐ DAILY DOUBLE — assign & wager</div>
        <div class="ddrow">
          <select id="dd-team">
            <option value="team1">${esc(teamName("team1"))}</option>
            <option value="team2">${esc(teamName("team2"))}</option>
          </select>
          <input type="number" id="dd-wager" class="numin wide" placeholder="Wager" value="${q.points}" />
          <button class="btn gold" data-action="dd-confirm">Set wager</button>
        </div>
        <p class="dim">Daily Doubles have no buzzing — only the chosen team answers.</p>
      </div>`;
  } else if (!locked && !S.resolved) {
    // Open buzzers (or, for a confirmed DD, go straight to answering)
    if (q.dailyDouble && S.dailyDouble) {
      controls = `<button class="btn big gold" data-action="dd-begin">▶ ${esc(teamName(S.dailyDouble.team))} answers (wager ${S.dailyDouble.wager})</button>`;
    } else if (!S.buzzOpen) {
      controls = `<button class="btn big green" data-action="open-buzzers">🔔 Open Buzzers</button>`;
    } else {
      controls = `<div class="buzzopen small">🔔 Buzzers are OPEN — waiting for first buzz…</div>
        <button class="btn" data-action="close-buzzers">Pause buzzers</button>`;
    }
  }

  // Someone is answering
  let answerPanel = "";
  if (locked && !S.resolved) {
    answerPanel = `
      <div class="answerpanel">
        <div class="answhead">Answering: <span class="chip ${locked.team}">${esc(locked.name)} · ${esc(teamName(locked.team))}</span></div>
        <div class="bigtimer ${rem <= 5 ? "danger" : ""}">${Math.ceil(rem)}s ${expired ? "— TIME!" : ""}</div>
        ${(q.type === "mcq" && !S.dailyDouble)
          ? `<div class="dim">🖥 Multiple choice — ${esc(locked.name)} taps a choice on their device and it's scored automatically.${expired ? " ⏰ Timed out — auto-scoring as wrong…" : ""}</div>`
          : `${transcriptLine(locked, expired)}
             <div class="judge">
               <button class="btn green" data-action="score" data-res="correct">✅ Correct (+${value})</button>
               <button class="btn danger" data-action="score" data-res="wrong">❌ Wrong (−${value})</button>
               <button class="btn" data-action="score" data-res="none">😐 No penalty / skip</button>
             </div>
             ${expired ? `<div class="timeoutnote">⏰ Time's up! Your call — ❌ to dock ${value}, or 😐 for no penalty. ${S.spokenAnswer && S.spokenAnswer.text ? "(They did answer — see transcript above.)" : "(No spoken answer was detected.)"}</div>` : ""}`}
      </div>`;
  }

  // After-resolve / close row
  let after = "";
  if (S.resolved) {
    after += `<button class="btn gold" data-action="reveal-answer">${S.revealAnswer ? "Answer shown" : "👁 Reveal answer on board"}</button>`;
    after += `<button class="btn big" data-action="close-question">✓ Done — back to board</button>`;
  } else {
    // Not resolved: either still in play, or a team just missed it.
    const anyBlocked = (S.blockedTeams || []).length > 0;
    if (anyBlocked && !locked) {
      after += `<div class="passnote">↪ A team missed it — tap <b>🔔 Open Buzzers</b> above to give the other team a chance, or close.</div>`;
    }
    after += `<button class="btn ghost" data-action="close-question">Cancel / back to board</button>`;
  }

  return `
    <div class="adminclue">
      <div class="acluehead">${esc(q.category)} · ${q.points}${q.dailyDouble ? " · ⭐ Daily Double" : ""} · <span class="ty">${q.type === "mcq" ? "Multiple choice (auto)" : "Spoken (you judge)"}</span></div>
      <div class="acluetext">${esc(q.question)}</div>
      <div class="cheatpoke">🤫 Answer is hidden here. Open the <a href="#/cheat" target="_blank" rel="noopener">Cheat Sheet</a> on your phone.</div>
      ${controls}
      ${answerPanel}
      <div class="afterrow">${after}</div>
    </div>`;
}

function adminFinal() {
  const f = S.final;
  const fq = finalQuestion();
  if (!fq) return `<div class="adminclue"><div class="dim">No Final Jeopardy clue loaded.</div><button class="btn" data-action="final-cancel">Back</button></div>`;

  if (f.stage === "wager" || f.stage === "idle") {
    return `
      <div class="adminclue">
        <div class="acluehead">🎯 FINAL JEOPARDY — Category: ${esc(f.category || fq.category)}</div>
        <div class="cheatpoke">Answer hidden — see <a href="#/cheat" target="_blank" rel="noopener">Cheat Sheet</a>.</div>
        <p>Enter each team's wager, then reveal the clue.</p>
        <div class="wagerrow">
          ${["team1", "team2"].map((t) => `
            <label class="chip ${t}">${esc(teamName(t))} wager
              <input type="number" class="numin wide" id="fw-${t}" value="${(f.wagers && f.wagers[t]) || 0}" min="0" />
            </label>`).join("")}
        </div>
        <button class="btn big gold" data-action="final-reveal">▶ Reveal clue & start ${(S.settings && S.settings.finalSeconds) || 60}s timer</button>
        <button class="btn ghost" data-action="final-cancel">Cancel</button>
      </div>`;
  }
  if (f.stage === "question") {
    const rem = remainingFinal();
    return `
      <div class="adminclue">
        <div class="acluehead">🎯 FINAL — ${esc(f.category || fq.category)}</div>
        <div class="acluetext">${esc(fq.question)}</div>
        <div class="cheatpoke">Answer: open <a href="#/cheat" target="_blank" rel="noopener">Cheat Sheet</a>.</div>
        <div class="bigtimer ${rem <= 10 ? "danger" : ""}">${Math.ceil(rem)}s</div>
        <button class="btn big" data-action="final-judge-stage">Time's up → judge answers</button>
      </div>`;
  }
  if (f.stage === "done") {
    const s = S.scores || { team1: 0, team2: 0 };
    const winner = s.team1 === s.team2 ? "It's a tie!" : "🏆 " + teamName(s.team1 > s.team2 ? "team1" : "team2") + " wins!";
    return `
      <div class="adminclue">
        <div class="acluehead">🎯 FINAL — results shown on the board</div>
        <div class="acluetext">${esc(winner)}</div>
        <div class="finalscores">${esc(teamName("team1"))}: ${s.team1} · ${esc(teamName("team2"))}: ${s.team2}</div>
        <button class="btn big" data-action="final-cancel">← Back to board</button>
      </div>`;
  }
  // reveal/judge
  return `
    <div class="adminclue">
      <div class="acluehead">🎯 FINAL — judge</div>
      <div class="acluetext">${esc(fq.question)}</div>
      <div class="cheatpoke">Answer: open <a href="#/cheat" target="_blank" rel="noopener">Cheat Sheet</a>.</div>
      ${["team1", "team2"].map((t) => `
        <div class="judgerow">
          <span class="chip ${t}">${esc(teamName(t))} (wager ${(f.wagers && f.wagers[t]) || 0})</span>
          <button class="btn green ${f.results[t] === "correct" ? "on" : ""}" data-action="final-mark" data-t="${t}" data-res="correct">✅ +${(f.wagers && f.wagers[t]) || 0}</button>
          <button class="btn danger ${f.results[t] === "wrong" ? "on" : ""}" data-action="final-mark" data-t="${t}" data-res="wrong">❌ −${(f.wagers && f.wagers[t]) || 0}</button>
        </div>`).join("")}
      <button class="btn big gold" data-action="final-finish">🏁 Finish & show results</button>
    </div>`;
}

// ---------------- shared bits ----------------
function scoreBar(big) {
  const s = S && S.scores ? S.scores : { team1: 0, team2: 0 };
  return `<div class="scorebar ${big ? "big" : ""}">
    <div class="teamscore team1"><span class="tn">${esc(teamName("team1"))}</span><span class="pts">${s.team1 || 0}</span></div>
    <div class="vs">vs</div>
    <div class="teamscore team2"><span class="tn">${esc(teamName("team2"))}</span><span class="pts">${s.team2 || 0}</span></div>
  </div>`;
}
function transcriptLine(locked, expired) {
  if (!locked || locked.deviceId === "dd") return ""; // Daily Double has no answering device
  const sa = S.spokenAnswer;
  if (sa && sa.text) {
    const at = typeof sa.at === "number" ? ` <span class="dim">(@${sa.at.toFixed(1)}s)</span>` : "";
    return `<div class="transcript">🎤 Heard: “${esc(sa.text)}”${at}</div>`;
  }
  return `<div class="transcript dim">🎤 ${expired ? "No spoken answer detected." : "Listening on their device…"}</div>`;
}
function loading() {
  if (firestoreError) {
    return `<div class="screen center"><div class="snowcard"><h1 class="title">🎄</h1>
      <p><strong>Not connected to Firebase yet.</strong></p>
      <p class="dim">The database rules haven't been published. Paste the security rules from the README into your Firebase console (Firestore → Rules → Publish), then reload.</p>
      <button class="btn ghost" data-action="goto" data-r="home">← Home</button></div></div>`;
  }
  return `<div class="screen center"><div class="snowcard"><h1 class="title">🎄</h1><p>Connecting…</p></div></div>`;
}
function fmt(sec) { return sec == null ? "" : Math.ceil(sec) + "s"; }

// =================================================================
// ACTIONS
// =================================================================
let selectedTeam = null;
let busy = false;

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;

  if (a === "goto") return go(t.dataset.r);
  if (a === "toggle-sound") {
    if (Sounds.soundEnabled()) { Sounds.disableSound(); finalPlaying = false; }
    else { await Sounds.enableSound(); lastSfxAt = (S && S.sfx && S.sfx.at) || Date.now(); }
    render();
    return;
  }

  if (a === "pickteam") {
    selectedTeam = t.dataset.t;
    document.querySelectorAll(".teambtn").forEach((b) => b.classList.remove("sel"));
    t.classList.add("sel");
    const gb = document.getElementById("jn-go");
    if (gb) gb.disabled = !document.getElementById("jn-name").value.trim();
    return;
  }
  if (a === "join") {
    const name = document.getElementById("jn-name").value.trim();
    if (!name || !selectedTeam) return;
    try { await D.joinGame(name, selectedTeam); }
    catch (err) { console.warn("join write failed (rules not set?):", err.message); }
    go("play");
    return;
  }
  if (a === "enable-mic") {
    t.textContent = "Requesting…";
    const ok = await Speech.requestMicPermission();
    render();
    if (!ok) alert("Microphone was blocked. You can still play — just answer out loud when it's your turn. (To enable later, allow mic access in your browser's site settings and tap again.)");
    return;
  }
  if (a === "code-login") {
    const v = document.getElementById("code-in").value.trim();
    if (v === ADMIN_CODE) {
      setAdminOk();
      // The gate lives at the same hash we're navigating to, so setting the hash
      // fires no event — re-render directly (and still sync the hash if different).
      if ("#/" + t.dataset.target !== location.hash) location.hash = "#/" + t.dataset.target;
      render();
    } else {
      document.getElementById("code-err").textContent = "Wrong code. Try again.";
    }
    return;
  }

  // ---- Player ----
  if (a === "buzz") {
    if (busy) return; busy = true;
    const id = D.getLocalIdentity();
    const me = { name: id.name, team: id.team, deviceId: D.deviceId() };
    try { await D.buzz(me, S.buzzRound, (S.settings && S.settings.answerSeconds) || 30); }
    finally { busy = false; }
    return;
  }
  if (a === "mcq-pick") {
    const i = Number(t.dataset.i);
    const q = qById(S.currentQuestionId);
    const correct = i === q.correctIndex;
    const value = S.dailyDouble ? S.dailyDouble.wager : q.points;
    const team = S.lockedBuzzer.team;
    await D.addScore(team, correct ? value : -value);
    await D.playSfx(correct ? "correct" : "wrong");
    if (correct) {
      await D.patchState({ mcqSelection: { index: i, correct: true }, resolved: true, revealAnswer: true });
    } else {
      // Wrong: dock, block this team, free the buzzer so the host can offer the other team.
      const blocked = Array.from(new Set([...(S.blockedTeams || []), team]));
      await D.patchState({
        mcqSelection: null, spokenAnswer: null, revealAnswer: false, resolved: false,
        blockedTeams: blocked, lockedBuzzer: null, lockedAt: null, buzzOpen: false,
      });
    }
    return;
  }

  // ---- Admin board ----
  if (a === "pick-question") {
    await D.patchState({
      currentQuestionId: t.dataset.id, phase: "question", buzzOpen: false,
      buzzRound: (S.buzzRound || 0) + 1, lockedBuzzer: null, lockedAt: null,
      blockedTeams: [], revealAnswer: false, mcqSelection: null, spokenAnswer: null,
      resolved: false, dailyDouble: null,
    });
    await D.clearBuzzes();
    return;
  }
  if (a === "open-buzzers") {
    await D.patchState({
      buzzOpen: true, buzzRound: (S.buzzRound || 0) + 1, lockedBuzzer: null,
      lockedAt: null, mcqSelection: null, spokenAnswer: null,
    });
    await D.clearBuzzes();
    return;
  }
  if (a === "close-buzzers") { await D.patchState({ buzzOpen: false }); return; }

  if (a === "dd-confirm") {
    const team = document.getElementById("dd-team").value;
    const wager = Number(document.getElementById("dd-wager").value) || 0;
    await D.patchState({ dailyDouble: { team, wager } });
    return;
  }
  if (a === "dd-begin") {
    const dd = S.dailyDouble;
    await D.patchState({
      lockedBuzzer: { name: teamName(dd.team), team: dd.team, deviceId: "dd" },
      lockedAt: Date.now(), phase: "answering", buzzOpen: false,
    });
    return;
  }

  if (a === "score") {
    const res = t.dataset.res;
    const q = qById(S.currentQuestionId);
    const dd = S.dailyDouble;
    const value = dd ? dd.wager : q.points;
    const team = S.lockedBuzzer.team;
    const delta = res === "correct" ? value : res === "wrong" ? -value : 0;
    if (delta) await D.addScore(team, delta);
    if (res === "correct") await D.playSfx("correct");
    else if (res === "wrong") await D.playSfx("wrong");
    if (dd || res === "correct") {
      // Daily Double always ends the clue; a correct spoken answer ends it too.
      await D.patchState({ resolved: true, revealAnswer: true });
    } else {
      // Wrong / skip on a normal clue: block this team, free the buzzer for the next team.
      const blocked = Array.from(new Set([...(S.blockedTeams || []), team]));
      await D.patchState({
        blockedTeams: blocked, lockedBuzzer: null, lockedAt: null,
        buzzOpen: false, resolved: false, mcqSelection: null, spokenAnswer: null,
      });
    }
    return;
  }
  if (a === "reveal-answer") { await D.patchState({ revealAnswer: true }); return; }
  if (a === "close-question") {
    const q = qById(S.currentQuestionId);
    if (q) await D.setQuestionUsed(q.id, true);
    await D.patchState({
      phase: "lobby", currentQuestionId: null, buzzOpen: false, lockedBuzzer: null,
      lockedAt: null, blockedTeams: [], revealAnswer: false, mcqSelection: null,
      spokenAnswer: null, resolved: false, dailyDouble: null,
    });
    return;
  }

  // ---- Scores / teams / settings ----
  if (a === "adj") { await D.addScore(t.dataset.t, Number(t.dataset.d)); return; }
  if (a === "reset-scores") { await D.patchState({ scores: { team1: 0, team2: 0 } }); return; }
  if (a === "reset-board") {
    for (const q of QUESTIONS) if (q.used) await D.setQuestionUsed(q.id, false);
    return;
  }
  if (a === "full-reset") {
    if (!confirm("Full reset: scores, board, and current clue (players kept). Continue?")) return;
    await D.patchState({ ...D.DEFAULT_STATE, teamNames: S.teamNames, settings: S.settings });
    for (const q of QUESTIONS) if (q.used) await D.setQuestionUsed(q.id, false);
    await D.clearBuzzes();
    return;
  }

  // ---- Players ----
  if (a === "remove-player") { await D.adminRemovePlayer(t.dataset.id); return; }

  // ---- Questions ----
  if (a === "download-template") { downloadTemplate(); return; }

  // ---- Final Jeopardy ----
  if (a === "final-start") {
    const fq = finalQuestion();
    await D.patchState({
      phase: "final",
      final: { active: true, stage: "wager", category: fq ? fq.category : "Final Jeopardy", questionId: fq ? fq.id : null, deadline: null, wagers: {}, results: {} },
    });
    return;
  }
  if (a === "final-reveal") {
    const w1 = Number(document.getElementById("fw-team1").value) || 0;
    const w2 = Number(document.getElementById("fw-team2").value) || 0;
    const secs = (S.settings && S.settings.finalSeconds) || 60;
    await D.patchState({ final: { ...S.final, stage: "question", wagers: { team1: w1, team2: w2 }, deadline: Date.now() + secs * 1000 } });
    return;
  }
  if (a === "final-judge-stage") { await D.patchState({ final: { ...S.final, stage: "reveal" } }); return; }
  if (a === "final-mark") {
    const team = t.dataset.t, res = t.dataset.res;
    await D.patchState({ final: { ...S.final, results: { ...S.final.results, [team]: res } } });
    return;
  }
  if (a === "final-finish") {
    const f = S.final;
    const scores = { ...(S.scores || { team1: 0, team2: 0 }) };
    for (const tm of ["team1", "team2"]) {
      const w = f.wagers[tm] || 0;
      if (f.results[tm] === "correct") scores[tm] += w;
      else if (f.results[tm] === "wrong") scores[tm] -= w;
    }
    await D.patchState({ scores, final: { ...f, stage: "done" } });
    return;
  }
  if (a === "final-cancel") {
    await D.patchState({ phase: "lobby", final: { ...D.DEFAULT_STATE.final } });
    return;
  }
});

// change / input handlers
document.addEventListener("change", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  if (a === "import") {
    const file = t.files[0]; if (!file) return;
    const msg = document.getElementById("import-msg");
    msg.textContent = "Reading…";
    try {
      const buf = await file.arrayBuffer();
      const { rows, error, finalCount, categories } = parseWorkbook(buf);
      if (error) { msg.textContent = "⚠️ " + error; return; }
      await D.replaceAllQuestions(rows);
      const nCat = (categories || []).filter((c) => !/^final(\s*jeopardy)?$/i.test(c)).length;
      msg.textContent = `✅ Imported ${rows.length} clues across ${nCat} categor${nCat === 1 ? "y" : "ies"}${finalCount ? " (incl. Final Jeopardy)" : ' — ⚠️ no "Final Jeopardy" tab found'}.`;
    } catch (err) { msg.textContent = "⚠️ " + err.message; }
    t.value = "";
    return;
  }
  if (a === "reteam-player") { await D.adminUpdatePlayer(t.dataset.id, { team: t.value }); return; }
  if (a === "set-answer") { await D.patchState({ settings: { ...S.settings, answerSeconds: Math.max(3, Number(t.value) || 30) } }); return; }
  if (a === "set-final") { await D.patchState({ settings: { ...S.settings, finalSeconds: Math.max(5, Number(t.value) || 60) } }); return; }
});

// blur-save for name/rename fields
document.addEventListener("blur", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  if (a === "rename-team") { await D.patchState({ teamNames: { ...S.teamNames, [t.dataset.t]: t.value.trim() || teamName(t.dataset.t) } }); }
  if (a === "rename-player") { await D.adminUpdatePlayer(t.dataset.id, { name: t.value.trim() }); }
}, true);

// enable join button when typing a name
document.addEventListener("input", (e) => {
  if (e.target.id === "jn-name") {
    const gb = document.getElementById("jn-go");
    if (gb) gb.disabled = !(e.target.value.trim() && selectedTeam);
  }
});

// enter key on code field
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "code-in") {
    document.querySelector('[data-action="code-login"]')?.click();
  }
});

// =================================================================
// ADMIN AUTO-RESOLVE (single writer) + boot
// =================================================================
let autoGuard = "";
function adminAutoEffects() {
  if (route() !== "admin" || !isAdminOk() || !S) return;
  const q = qById(S.currentQuestionId);
  if (!q || S.resolved || !S.lockedBuzzer) return;
  if (q.type !== "mcq" || S.dailyDouble) return; // spoken + Daily Doubles are judged manually
  const rem = remainingAnswer();
  // Timed out with no selection → auto-dock and free the buzzer for the next team, once.
  if (rem !== null && rem <= 0 && !S.mcqSelection) {
    const key = "timeout:" + S.buzzRound + ":" + q.id;
    if (autoGuard === key) return;
    autoGuard = key;
    const team = S.lockedBuzzer.team;
    const blocked = Array.from(new Set([...(S.blockedTeams || []), team]));
    D.addScore(team, -q.points);
    D.patchState({
      mcqSelection: null, spokenAnswer: null, resolved: false, blockedTeams: blocked,
      lockedBuzzer: null, lockedAt: null, buzzOpen: false,
    });
  }
}

// ---- Times-up sound cue (admin is the single writer) ----
let timesUpGuard = "";
function maybeTimesUp() {
  if (route() !== "admin" || !isAdminOk() || !S) return;
  if (!S.lockedBuzzer || S.resolved) return;
  const rem = remainingAnswer();
  if (rem === null || rem > 0) return;
  const key = S.buzzRound + ":" + S.currentQuestionId;
  if (timesUpGuard === key) return;
  timesUpGuard = key;
  D.playSfx("timesup");
}

// ---- Sound playback (host + projector devices only) ----
let lastSfxAt = 0;
let finalPlaying = false;
function soundEffects() {
  const r = route();
  const canPlay = (r === "admin" && isAdminOk()) || r === "board";
  if (!canPlay || !S || !Sounds.soundEnabled()) {
    if (finalPlaying) { Sounds.stopFinal(); finalPlaying = false; }
    return;
  }
  // One-shot cues (correct / wrong / times-up).
  if (S.sfx && S.sfx.at && S.sfx.at > lastSfxAt) {
    lastSfxAt = S.sfx.at;
    Sounds.playOneShot(S.sfx.sound);
  }
  // Final Jeopardy music loops while the final clue is live.
  const inFinalQ = S.final && S.final.active && S.final.stage === "question";
  if (inFinalQ && !finalPlaying) { Sounds.startFinal(); finalPlaying = true; }
  else if (!inFinalQ && finalPlaying) { Sounds.stopFinal(); finalPlaying = false; }
}

// ---- Player speech capture (only on the answering player's device) ----
let listenKey = null;
let lastTranscriptWrite = 0;
let lastListenAttempt = 0;

function playerSpeechEffect() {
  const id = D.getLocalIdentity();
  if (route() !== "play" || !id || !S) { if (listenKey) { Speech.stopListening(); listenKey = null; } return; }
  const q = qById(S.currentQuestionId);
  const mine = S.lockedBuzzer && S.lockedBuzzer.deviceId === D.deviceId();
  const shouldListen =
    mine && q && q.type !== "mcq" && !S.resolved &&
    remainingAnswer() > 0 && Speech.micSupported() && Speech.micEnabled() && !Speech.speechDenied();

  if (!shouldListen) {
    if (listenKey) { Speech.stopListening(); listenKey = null; }
    return;
  }

  const key = S.buzzRound + ":" + S.currentQuestionId;
  if (listenKey !== key) { listenKey = key; lastTranscriptWrite = 0; }

  if (!Speech.isListening() && Date.now() - lastListenAttempt > 900) {
    lastListenAttempt = Date.now();
    Speech.startListening({
      onTranscript: (text) => {
        const now = Date.now();
        if (now - lastTranscriptWrite < 400) return;
        lastTranscriptWrite = now;
        const at = S.lockedAt ? (now - S.lockedAt) / 1000 : 0;
        D.patchState({ spokenAnswer: { deviceId: D.deviceId(), name: id.name, team: id.team, text, at, final: false } })
          .catch(() => {});
      },
      onEnd: (finalText) => {
        if (!finalText) return;
        const at = S.lockedAt ? (Date.now() - S.lockedAt) / 1000 : 0;
        D.patchState({ spokenAnswer: { deviceId: D.deviceId(), name: id.name, team: id.team, text: finalText, at, final: true } })
          .catch(() => {});
      },
      onError: () => {},
    });
  }
}

// Re-render on a light tick so timers animate.
setInterval(() => {
  const r = route();
  if (["board", "play", "admin", "cheat"].includes(r)) {
    maybeTimesUp();
    adminAutoEffects();
    soundEffects();
    if (r === "play") playerSpeechEffect();
    // Only re-render the timer-bearing views to avoid clobbering inputs on admin.
    if (r === "board" || r === "play" || r === "cheat") render();
    else updateAdminTimers();
  } else {
    if (listenKey) { Speech.stopListening(); listenKey = null; }
    if (finalPlaying) { Sounds.stopFinal(); finalPlaying = false; }
  }
}, 300);

function updateAdminTimers() {
  // Update just the countdown numbers in admin without wiping inputs.
  const bt = document.querySelector(".admin .bigtimer");
  if (!bt) return;
  if (S && S.final && S.final.active && S.final.stage === "question") {
    const rem = remainingFinal(); if (rem == null) return;
    bt.textContent = Math.ceil(rem) + "s";
    bt.classList.toggle("danger", rem <= 10);
  } else if (S && S.lockedBuzzer && !S.resolved) {
    const rem = remainingAnswer(); if (rem == null) return;
    bt.textContent = Math.ceil(rem) + "s" + (rem <= 0 ? " — TIME!" : "");
    bt.classList.toggle("danger", rem <= 5);
    adminAutoEffects();
    if (rem <= 0) {
      // Spoken / Daily Double: show the timeout note once (mcq auto-resolves via state change).
      const q = qById(S.currentQuestionId);
      const manual = q && (q.type !== "mcq" || S.dailyDouble);
      if (manual && !document.querySelector(".admin .timeoutnote")) render();
    }
  }
}

window.addEventListener("hashchange", render);

let firestoreError = false;
function onSnapErr(e) {
  console.warn("Firestore not ready:", e && e.message);
  if (/permission/i.test(e && e.message || "")) {
    firestoreError = true;
    renderLive();
  }
}

async function boot() {
  Sounds.initFromPref();
  // Unlock audio on the first user gesture (browser autoplay policy).
  const unlock = () => { Sounds.resume(); };
  window.addEventListener("pointerdown", unlock, { once: false });
  render(); // show the UI immediately, before any network call
  D.subscribeState((s) => {
    S = s;
    // (Re)subscribe to buzzes for the live round.
    if (S && S.buzzRound !== watchedRound) {
      watchedRound = S.buzzRound;
      if (buzzUnsub) buzzUnsub();
      buzzUnsub = D.subscribeBuzzes(watchedRound, (b) => { BUZZES = b; renderLive(); }, onSnapErr);
    }
    renderLive();
  }, onSnapErr);
  D.subscribeQuestions((q) => { QUESTIONS = q; renderLive(); }, onSnapErr);
  D.subscribePlayers((p) => { PLAYERS = p; renderLive(); }, onSnapErr);
  // Create the state doc if missing — non-fatal if rules aren't set yet.
  D.ensureState().catch(onSnapErr);
}

// Re-render data-driven views without stomping admin text inputs mid-edit.
function renderLive() {
  const r = route();
  if (r === "admin") {
    if (!document.activeElement || !["INPUT", "SELECT"].includes(document.activeElement.tagName)) render();
  } else {
    render();
  }
}

boot();
