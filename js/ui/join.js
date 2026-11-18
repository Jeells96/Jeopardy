// Join screen, host code gate, loading screen and the projector page.
import { esc, cls } from "./util.js";
import * as Sounds from "../sounds.js";
import * as E from "../engine.js";
import { tn, stage } from "./stage.js";

const logo = `<div class="join-logo"><span class="brand-xmas">Christmas</span><span class="brand-j">JEOPARDY!</span></div>`;

export function renderJoin(G) {
  const name = (G.ui.joinName || "").trim();
  const team = G.ui.joinTeam;
  const ok = name.length > 0 && !!team;
  return `<div class="join">
    <div class="join-card">
      ${logo}
      ${G.ui.kicked ? `<div class="note">Your name was removed from the game — enter your name to join again.</div>` : ""}
      <label class="join-label" for="jn-name">Your name</label>
      <input id="jn-name" class="join-input" maxlength="20" autocomplete="nickname" placeholder="e.g. Grandma Jo" value="${esc(G.ui.joinName || "")}" data-input="join-name" data-sticky>
      <div class="join-label">Pick your team</div>
      <div class="teampick">${E.TEAMS.map((t) => {
        const n = G.P.filter((p) => p.team === t).length;
        return `<button class="${cls("teambtn", t, team === t && "on")}" data-action="join-team" data-team="${t}" aria-pressed="${team === t}">
          <span class="tb-name">${esc(tn(G, t))}</span><span class="tb-count">${n} player${n === 1 ? "" : "s"}</span></button>`;
      }).join("")}</div>
      <div class="warn">🔒 Choose carefully — once you join, your name and team are locked in.</div>
      <button class="btn primary big" data-action="join"${ok ? "" : " disabled"}>Join the game 🎁</button>
    </div>
    <div class="join-foot"><a href="#/admin">Host login</a><span>·</span><a href="#/board">Projector board</a></div>
  </div>`;
}

export function renderGate(G, target) {
  return `<div class="join">
    <div class="join-card">
      ${logo}
      <h2 class="gate-title">🔒 ${target === "remote" ? "Host remote" : target === "questions" ? "Question library" : "Jaren's View"}</h2>
      <p class="muted">Enter the host code.</p>
      <input id="gate-code" class="join-input code" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off" data-sticky>
      <div class="err" role="alert">${esc(G.ui.gateErr || "")}</div>
      <button class="btn primary big" data-action="gate" data-p='{"target":"${target}"}'>Enter</button>
      <a class="muted backlink" href="#/">← Back</a>
    </div>
  </div>`;
}

export function renderLoading(G) {
  if (G.fsError) {
    return `<div class="join"><div class="join-card">${logo}
      <h2 class="gate-title">Can't reach the game database</h2>
      <p>Publish the Firestore security rules from the README in the Firebase console (Firestore Database → Rules → Publish), then reload this page.</p>
      <button class="btn primary big" data-action="reload">Reload</button>
    </div></div>`;
  }
  return `<div class="join"><div class="join-card loading">${logo}<div class="spinner"></div><p class="muted">Connecting to the North Pole…</p></div></div>`;
}

export function renderBoardPage(G) {
  return `<div class="boardpage">
    ${stage(G, { pick: false })}
    <div class="board-tools">
      <button class="${cls("hbtn sound-btn", G.soundOn && !Sounds.blocked() && "on", G.soundOn && Sounds.blocked() && "wake")}" data-action="${G.soundOn && Sounds.blocked() ? "wake-sound" : "toggle-sound"}" title="Sound on this screen">${!G.soundOn ? "🔇 Sound off" : Sounds.blocked() ? "👆 Tap to start sound" : "🔊 Sound on"}</button>
      <button class="hbtn" data-action="fullscreen" title="Fullscreen">⛶</button>
    </div>
  </div>`;
}
