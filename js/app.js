// Christmas Jeopardy — app bootstrap, routing, rendering, actions and automations.
import * as D from "./data.js";
import * as E from "./engine.js";
import { morph } from "./ui/util.js";
import { renderHost } from "./ui/host.js";
import { renderRemote } from "./ui/remote.js";
import { renderPlayer } from "./ui/player.js";
import { renderJoin, renderGate, renderLoading, renderBoardPage } from "./ui/join.js";
import { hostSteps } from "./ui/dock.js";
import { PRESETS, pickSummon } from "./ui/minis.js";
import * as Sounds from "./sounds.js";
import { renderLibrary } from "./ui/library.js";
import { findQ } from "./ui/stage.js";
import { initLibrary, libClick, libChange, libInput } from "./libctl.js";
import { OWN, OPP, pickPunIndex } from "./puns.js";
import { downloadTemplate, parseWorkbook } from "./xlsx.js";

const HOST_CODE = "2325";

const G = {
  S: null, spoken: null, Q: [], P: [], B: [],
  me: null, deviceId: D.deviceId(),
  ui: { firstPick: "random", ddWager: "", ddTeam: null, drawer: false, drawerTab: "game", modal: null, joinName: "", joinTeam: null, renaming: false },
  fsError: false, soundOn: false, myBuzzKey: null, lastPun: null, seenSelf: false,
  now: () => D.serverNow(),
};
initLibrary(G);
window.__G = G; // handy for debugging in the console

const appEl = document.getElementById("app");
const toastEl = document.getElementById("toast");

// ---------------- routing ----------------
const route = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "home");
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const isHost = () => store.get("jeop_host_ok") === "1";
const isPlayerRoute = () => !["admin", "remote", "cheat", "board"].includes(route());
const isHostClass = () => {
  const r = route();
  return r === "board" || ((r === "admin" || r === "remote" || r === "cheat") && isHost());
};

// ---------------- render ----------------
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; doRender(); });
}
function doRender() {
  const r = route();
  let html, view;
  if (r === "admin") {
    if (!isHost()) { html = renderGate(G, "admin"); view = "join"; }
    else { html = G.S ? renderRemote(G) : renderLoading(G); view = G.S ? "remote" : "join"; }
  } else if (r === "remote" || r === "cheat") {
    if (!isHost()) { html = renderGate(G, "remote"); view = "join"; }
    else { html = G.S ? renderRemote(G) : renderLoading(G); view = G.S ? "remote" : "join"; }
  } else if (r === "questions") {
    if (!isHost()) { html = renderGate(G, "questions"); view = "join"; }
    else { watchSets(); html = renderLibrary(G); view = "library"; }
  } else if (r === "board") {
    html = G.S ? renderBoardPage(G) : renderLoading(G); view = G.S ? "board" : "join";
  } else if (!G.me) {
    html = renderJoin(G); view = "join";
  } else {
    html = G.S ? renderPlayer(G) : renderLoading(G); view = G.S ? "player" : "join";
  }
  if (document.body.dataset.view !== view) document.body.dataset.view = view;
  morph(appEl, html);
  autosizeAll();
  mountQR();
  tick();
}

// Text boxes marked .auto grow to fit everything typed in them (question library).
function autosize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}
function autosizeAll() {
  for (const el of document.querySelectorAll("textarea.auto")) autosize(el);
}
window.addEventListener("resize", () => { if (route() === "questions") autosizeAll(); });

// ---------------- toasts ----------------
let toastTimer = 0;
function toast(msg, kind = "") {
  toastEl.className = "toast show " + kind;
  toastEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 3800);
}

// ---------------- live data ----------------
let buzzUnsub = null;
let buzzKey = "";
function onErr(e) {
  console.warn("Firestore:", e && e.message);
  if (/permission|insufficient/i.test((e && (e.code || e.message)) || "")) { G.fsError = true; render(); }
}
function onState(prev, S) {
  // Buzz-order subscription follows the current clue's buzz round.
  const c = S && S.clue;
  const key = c && !c.dd && ["open", "answering", "done"].includes(c.stage) ? E.lockKey(c) : "";
  if (key !== buzzKey) {
    buzzKey = key;
    if (buzzUnsub) { buzzUnsub(); buzzUnsub = null; }
    G.B = [];
    if (key) buzzUnsub = D.subscribeBuzzes(key, (rows) => { G.B = rows; render(); }, onErr);
  }
  const pc = prev && prev.clue;
  if (!c || !pc || c.id !== pc.id) { G.ui.ddWager = ""; G.ui.ddTeam = null; }
  if (c && c.pun) G.lastPun = c.pun;

  // Phone haptics: buzzers opening, and "you're up".
  if (isPlayerRoute() && G.me && c) {
    const opened = c.stage === "open" && !(pc && pc.stage === "open" && pc.buzzRound === c.buzzRound);
    if (opened && !c.blocked.includes(G.me.team)) vibrate(35);
    const mine = c.stage === "answering" && c.locked && c.locked.deviceId === G.deviceId;
    const wasMine = pc && pc.stage === "answering" && pc.locked && pc.locked.deviceId === G.deviceId && E.lockKey(pc) === E.lockKey(c);
    if (mine && !wasMine) { vibrate([60, 40, 120]); focusAnswerBox(); }
    const ddMine = c.stage === "answering" && c.dd && c.dd.team === G.me.team && !(pc && pc.stage === "answering");
    if (ddMine) focusAnswerBox();
  }
  miniPickEffect(S);
  if (prev && S && G.me && isPlayerRoute()) {
    const was = E.teamName(prev, G.me.team), now = E.teamName(S, G.me.team);
    if (was !== now) toast(`Your team is now “${now}” 🎉`, "good");
  }
  if (S && !["lobby", "minis"].includes(S.phase)) G.ui.renaming = false;
  soundEffects(S);
  santaReads(S);
}

// ---------------- Santa reads the question ----------------
const SANTA_INTROS = ["Ho ho ho! ", "Ho ho ho! Listen closely. ", "", "", "Ho ho! ", "", "Ho ho ho! Here we go. ", "", "Ah, a good one! ", ""];
const SANTA_FINAL = ["Ho ho ho! Here is your Final Jeopardy question. ", "Ho ho ho! The Final question. Good luck, my dears! "];
let santaKey;             // which question reveal was read last (undefined until the first state arrives)
let santaActive = false;  // Santa is (or may be) mid-sentence
function santaLine(q, intro) {
  if (!q) return "";
  let text = intro + q.question;
  if (q.type === "mcq" && q.choices && q.choices.length) {
    text += " Is it: " + q.choices.map((ch, i) => `${"ABCDEF"[i]}, ${ch}`).join(". ") + "?";
  }
  return text;
}
function santaReads(S) {
  if (!S) return;
  const c = S.clue;
  const f = S.final;
  let key = null, text = "";
  if (S.phase === "clue" && c && c.stage === "reading") key = "c" + c.id + c.pickedAt;
  else if (S.phase === "clue" && c && c.dd && c.dd.wager != null && c.stage === "answering") key = "d" + c.id + c.pickedAt;
  else if (S.phase === "final" && f && f.stage === "clue") key = "f" + f.deadline;
  const first = santaKey === undefined;
  if (key && key !== santaKey && !first) {
    const canPlay = isHostClass() && Sounds.soundEnabled() && (S.settings || {}).readAloud !== false;
    if (canPlay) {
      if (key[0] === "f") text = santaLine(E.finalClue(G.Q), SANTA_FINAL[Math.floor(Math.random() * SANTA_FINAL.length)]);
      else text = santaLine(findQ(G, c.id), key[0] === "d" ? "Ho ho ho! For the Daily Double: " : SANTA_INTROS[Math.floor(Math.random() * SANTA_INTROS.length)]);
      const want = key;
      // A short pause so the pick / Daily Double sound plays first.
      setTimeout(() => { if (santaKey === want && text) { santaActive = true; Sounds.santa(text); } }, key[0] === "d" ? 300 : 900);
    }
  }
  if (key || first) santaKey = key || santaKey || null;
  // Stop talking once someone is answering, the question is over, or the screen moved on.
  const live = (S.phase === "clue" && c && c.stage !== "done" && !(c.stage === "answering" && !c.dd)) || (S.phase === "final" && f && f.stage === "clue");
  if (!live && santaActive) { santaActive = false; Sounds.hush(); }
}

// Mini games: when a new name is drawn, wait for the shuffle to finish, then reveal it
// everywhere at the same moment (and buzz the phone of whoever is up).
let lastPickKey = null;
let pickPrimed = false; // don't re-announce a pick that was already on screen when this page loaded
function miniPickEffect(S) {
  if (!S) return;
  const fresh = pickPrimed;
  pickPrimed = true;
  const pick = E.currentPick(S);
  if (!pick) { lastPickKey = null; return; }
  if (pick.key === lastPickKey) return;
  lastPickKey = pick.key;
  const summon = pickSummon(S).replace(/[^\p{L}\p{N}\s.,!?'’:;—–-]/gu, "").replace(/\s+/g, " ").trim();
  const spoken = summon || (pick.type === "best"
    ? (pick.names[0] ? `Up next: ${pick.names[0]}!` : "")
    : (pick.names[0] || pick.names[1] ? `Up next: ${pick.names[0] || E.teamName(S, "team1")}, versus, ${pick.names[1] || E.teamName(S, "team2")}!` : ""));
  const reveal = () => {
    render();
    if (isPlayerRoute() && G.me && pick.pids.includes(G.deviceId)) vibrate([80, 60, 160]);
    // Say it out loud on the screen that has sound on (unless the pick was changed meanwhile).
    const cur = G.S ? E.currentPick(G.S) : null;
    if (fresh && cur && cur.key === pick.key && isHostClass() && Sounds.soundEnabled() && (G.S.settings || {}).announce !== false) Sounds.say(spoken);
    if (!isPlayerRoute() && isHost()) {
      // Put the cursor in the score box so the host can just type.
      setTimeout(() => {
        const box = document.getElementById("mini-score");
        const busy = ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement || {}).tagName);
        if (box && !busy) box.focus();
      }, 80);
    }
  };
  setTimeout(reveal, Math.max(0, pick.at + E.SPIN_MS - G.now()) + 40);
}
function onPlayers() {
  if (!G.me) return;
  const mine = G.P.find((p) => p.id === G.deviceId);
  if (mine) {
    G.seenSelf = true;
    if (mine.name !== G.me.name || mine.team !== G.me.team) {
      // The host fixed this player's name/team — adopt it.
      D.setLocalIdentity(mine.name, mine.team);
      G.me = { name: mine.name, team: mine.team };
    }
  } else if (G.seenSelf) {
    // The host removed this player: back to the join screen.
    D.clearLocalIdentity();
    G.me = null;
    G.seenSelf = false;
    G.ui.kicked = true;
  }
}
// The question library is only loaded on the screen that uses it.
let setsWatched = false;
function watchSets() {
  if (setsWatched) return;
  setsWatched = true;
  D.subscribeSets((sets) => { G.sets = sets; G.setsReady = true; render(); }, onErr);
}
const libCtx = { G, D, toast, render };

function startSubscriptions() {
  D.subscribeState((s) => { const prev = G.S; G.S = s; G.fsError = false; onState(prev, s); render(); }, onErr);
  D.subscribeSpoken((s) => { G.spoken = s; render(); }, onErr);
  D.subscribeQuestions((q) => { G.Q = q; render(); }, onErr);
  D.subscribePlayers((p) => { G.P = p; onPlayers(); render(); }, onErr);
}

// ---------------- ticker: countdowns + timer lights ----------------
function tick() {
  const now = G.now();
  for (const el of document.querySelectorAll(".cd[data-deadline]")) {
    const left = Math.max(0, Number(el.dataset.deadline) - now);
    const txt = Math.ceil(left / 1000) + (el.dataset.format === "s" ? "s" : "");
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle("low", left <= 5000);
  }
  for (const el of document.querySelectorAll(".lights[data-deadline]")) {
    const left = Math.max(0, Number(el.dataset.deadline) - now);
    const lit = Math.ceil((left / (Number(el.dataset.total) || 1)) * 5); // 5 levels, outside lights go first
    el.querySelectorAll("i").forEach((i, idx) => i.classList.toggle("on", 5 - Math.abs(idx - 4) > 5 - lit));
  }
  for (const el of document.querySelectorAll(".bar[data-deadline]")) {
    const left = Math.max(0, Number(el.dataset.deadline) - now);
    el.style.setProperty("--p", Math.min(1, left / (Number(el.dataset.total) || 1)).toFixed(3));
    el.classList.toggle("low", left <= 5000);
  }
  // "Who's up next?" — shuffle through names, then land on the pick.
  for (const el of document.querySelectorAll(".spin[data-until]")) {
    if (now < Number(el.dataset.until)) {
      if (!el._names) { try { el._names = JSON.parse(el.dataset.spin || "[]"); } catch { el._names = []; } }
      const others = el._names.filter((n) => n !== el.textContent);
      if (others.length) el.textContent = others[Math.floor(Math.random() * others.length)];
      el.classList.add("spinning");
    } else if (!el._landed) {
      el._landed = true;
      const wasSpinning = el.classList.contains("spinning");
      el.textContent = el.dataset.final;
      el.classList.remove("spinning");
      if (wasSpinning) el.classList.add("landed");
    }
  }
}

// ---------------- automations (host screens only, all idempotent) ----------------
const fired = new Map();
function fire(key, name, params) {
  const t = fired.get(key);
  if (t && Date.now() - t < 2500) return;
  fired.set(key, Date.now());
  D.act(name, params).catch(() => {});
}
function automations() {
  const S = G.S;
  if (!S || !isHostClass()) return;
  const now = G.now();
  const set = S.settings || {};
  const c = S.clue;
  if (S.phase === "clue" && c) {
    const key = E.lockKey(c);
    if (c.stage === "reading" && set.readSeconds > 0 && now >= c.pickedAt + set.readSeconds * 1000) fire("ao" + c.pickedAt, "autoOpen", { pickedAt: c.pickedAt });
    if (c.stage === "open" && set.buzzWindowSeconds > 0 && now >= c.openedAt + set.buzzWindowSeconds * 1000) fire("bw" + key + c.openedAt, "buzzWindowTimeout", { key });
    if (c.stage === "answering" && c.locked && c.timeUp !== key && c.submitted !== key && now >= c.locked.at + (set.answerSeconds || 15) * 1000) fire("at" + key + c.locked.at, "answerTimeout", { key });
  }
  if (S.phase === "final" && S.final.stage === "clue" && now >= S.final.deadline) fire("fl" + S.final.deadline, "finalLock", {});
  if (S.phase === "over" && S.vote && S.vote.stage === "open" && E.voteProgress(S, G.P).all) fire("vr" + S.vote.openedAt, "voteReveal", {});
}

// ---------------- sounds ----------------
let lastSfxId = undefined;
function soundEffects(S) {
  if (!S) return;
  if (lastSfxId === undefined) { lastSfxId = S.sfx ? S.sfx.id : null; } // don't replay old cues on load
  const canPlay = isHostClass() && Sounds.soundEnabled();
  if (S.sfx && S.sfx.id !== lastSfxId) {
    lastSfxId = S.sfx.id;
    if (canPlay && G.now() - S.sfx.at < 6000) Sounds.play(S.sfx.sound);
  }
  Sounds.setFinalMusic(canPlay && S.phase === "final" && S.final && S.final.stage === "clue");
}

// ---------------- typed answers ----------------
async function submitTyped() {
  const box = document.getElementById("typed-answer");
  const c = G.S && G.S.clue;
  const text = box ? box.value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!text) { if (box) box.focus(); return toast("Type your answer first.", "bad"); }
  if (!c || c.stage !== "answering" || !G.me) return toast("Too late — the answer is closed.", "bad");
  box.value = "";
  box.blur();
  await D.writeSpoken({ key: E.lockKey(c), deviceId: G.deviceId, name: G.me.name, team: G.me.team, text, at: G.now(), final: true });
  D.act("answerSubmitted", { key: E.lockKey(c) }).catch(() => {});
  toast("Answer sent ✓", "good");
}
function focusAnswerBox() {
  setTimeout(() => { const b = document.getElementById("typed-answer"); if (b) b.focus(); }, 120);
}

// When a panel closes, don't leave the keyboard focus stuck in one of its (now hidden)
// fields — that would silently swallow the host's keyboard shortcuts.
function releaseFocus() {
  const a = document.activeElement;
  if (a && a !== document.body && a.closest && a.closest(".drawer, .modal")) a.blur();
}

// ---------------- device niceties ----------------
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } }
let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible" && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* not supported / denied */ }
}
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } catch { /* ignore */ }
}
function mountQR() {
  for (const el of document.querySelectorAll("[data-qr]")) {
    const url = el.dataset.qr;
    if (el._qrFor === url || !window.QRCode) continue;
    el.innerHTML = "";
    new window.QRCode(el, { text: url, width: 240, height: 240, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    el._qrFor = url;
  }
}

// ---------------- player actions ----------------
async function buzz() {
  const c = G.S && G.S.clue;
  if (!G.me || !c || c.stage !== "open" || c.blocked.includes(G.me.team)) return;
  const key = E.lockKey(c);
  if (G.myBuzzKey === key) return;
  G.myBuzzKey = key;
  vibrate(40);
  render();
  const me = { deviceId: G.deviceId, name: G.me.name, team: G.me.team };
  const lp = G.lastPun || {};
  const pun = { own: pickPunIndex(OWN.length, lp.own), opp: pickPunIndex(OPP.length, lp.opp) };
  D.logBuzz(key, me);
  try { await D.act("claimBuzz", { me, buzzRound: c.buzzRound, pun }); } catch { /* lost the race */ }
}

let faTimer = 0;
function saveFinalAnswer(text, announce) {
  if (!G.me) return;
  D.act("finalAnswer", { team: G.me.team, text, by: G.me.name, done: announce ? true : undefined })
    .then(() => { if (announce) toast("Answer saved ✓", "good"); })
    .catch((e) => toast(e.message, "bad"));
}

// Clear a field right away (so the next thing typed is never wiped by a slow save),
// and put the text back if the save fails.
async function submitField(input, save) {
  const typed = input.value;
  input.value = "";
  try { return await save(typed); }
  catch (err) { if (input.isConnected && input.value === "") input.value = typed; throw err; }
}

// ---------------- action dispatcher ----------------
const params = (el) => { try { return el.dataset.p ? JSON.parse(el.dataset.p) : {}; } catch { return {}; } };

async function handle(a, p, el) {
  const S = G.S;
  switch (a) {
    case "act":
      await D.act(p.name, p.p || {});
      if (p.then === "modal") { releaseFocus(); G.ui.modal = null; }
      if (p.then === "drawer") { G.ui.drawer = false; releaseFocus(); }
      if (p.then || p.name === "adjustScore") render();
      return;
    case "close": await D.act("closeClue"); D.clearBuzzes().catch(() => {}); return;
    case "pick": await D.act("pickClue", { qid: el.dataset.id }); return;
    case "first-pick": G.ui.firstPick = el.dataset.v; return render();
    case "dd-team": G.ui.ddTeam = el.dataset.team; G.ui.ddWager = ""; render(); await D.act("setDDTeam", { team: el.dataset.team }); return;
    case "dd-quick": G.ui.ddWager = el.dataset.v; return render();
    case "dd-lock": {
      const team = G.ui.ddTeam || (S.clue && S.clue.dd && S.clue.dd.team);
      if (!team) return toast("Pick the team that found the Daily Double first.", "bad");
      if (G.ui.ddWager === "") return toast("Enter their wager first.", "bad");
      await D.act("lockDDWager", { team, wager: Number(G.ui.ddWager) });
      return;
    }
    case "drawer": G.ui.drawer = true; G.ui.drawerTab = p.tab || "game"; return render();
    case "drawer-close": G.ui.drawer = false; releaseFocus(); return render();
    case "toggle-sound":
      if (Sounds.soundEnabled()) Sounds.disableSound(); else Sounds.enableSound();
      G.soundOn = Sounds.soundEnabled();
      if (G.S) lastSfxId = G.S.sfx ? G.S.sfx.id : null;
      soundEffects(G.S);
      return render();
    case "fullscreen": return toggleFullscreen();
    case "reload": return location.reload();
    case "score-panel": G.ui.modal = { type: "score", team: el.dataset.team }; return render();
    case "set-exact": {
      const v = document.getElementById("exact-score");
      await D.act("setScore", { team: el.dataset.team, value: Number(v && v.value) });
      G.ui.modal = null; return render();
    }
    case "modal-close": G.ui.modal = null; releaseFocus(); return render();
    case "confirm": G.ui.modal = { type: "confirm", what: p.what }; return render();
    case "confirm-yes": {
      G.ui.modal = null; G.ui.drawer = false; render();
      if (p.what === "newGame") { await D.newGameFull(); toast("New game ready 🎄", "good"); }
      else if (p.what === "clearPlayers") { await D.clearPlayers(); toast("All players removed", "good"); }
      else if (p.what === "resetBoard") { await D.resetUsed(); toast("Every question is back on the board", "good"); }
      else if (p.what === "startGame") await D.act("startGame", { control: G.ui.firstPick || "random" });
      else if (p.what === "loadTest") { await D.loadTestGame(); toast("🧪 Test game is on the board — have fun!", "good"); }
      else await D.act(p.what);
      return;
    }
    case "final-host-wager": {
      const input = document.getElementById("fw-" + el.dataset.team);
      if (!input || input.value === "") return toast("Type a wager first.", "bad");
      await submitField(input, (typed) => D.act("finalWager", { team: el.dataset.team, amount: Number(typed), by: "Host" }));
      return toast("Wager set ✓", "good");
    }
    case "download-template": return downloadTemplate();

    // ---- mini games ----
    case "mini-add": {
      const input = document.getElementById("mini-new-name");
      const name = input ? input.value.trim() : "";
      if (!name) { if (input) input.focus(); return toast("Type a name for the game first.", "bad"); }
      await submitField(input, () => D.act("miniAdd", { game: { name, type: el.dataset.type } }));
      return toast(`Added “${name}” ✓`, "good");
    }
    case "mini-preset": {
      const pr = PRESETS[Number(el.dataset.i)];
      if (!pr) return;
      await D.act("miniAdd", { game: pr });
      return toast(`Added “${pr.name}” ✓`, "good");
    }
    case "mini-remove": {
      const g = E.miniById(S, el.dataset.id);
      if (!g) return;
      if (g.status === "pending" && !g.matches.length && !g.entries.length) await D.act("miniRemove", { id: g.id });
      else { G.ui.modal = { type: "miniRemove", id: g.id }; render(); }
      return;
    }
    case "mini-reset-ask": G.ui.modal = { type: "miniReset", id: el.dataset.id }; return render();
    case "mini-finish-ask": G.ui.modal = { type: "miniFinish", id: p.id }; return render();
    case "mini-score": {
      const input = document.getElementById("mini-score");
      if (!input || input.value.trim() === "") { if (input) input.focus(); return toast("Type their score first.", "bad"); }
      await submitField(input, (typed) => D.act("miniScore", { id: p.id, score: typed }));
      input.blur();
      return;
    }
    case "player-add": {
      const input = document.getElementById("add-player-" + el.dataset.team);
      const name = input ? input.value.trim().slice(0, 20) : "";
      if (!name) { if (input) input.focus(); return toast("Type their name first.", "bad"); }
      await submitField(input, () => D.addPlayer(name, el.dataset.team));
      return;
    }
    case "player-team": await D.updatePlayer(el.dataset.id, { team: el.dataset.team }); return;
    case "player-remove": await D.removePlayer(el.dataset.id); return;

    // ---- players ----
    case "team-rename":
      G.ui.renaming = true;
      render();
      setTimeout(() => { const i = document.getElementById("team-name-input"); if (i) { i.focus(); i.select(); } }, 80);
      return;
    case "team-rename-cancel": G.ui.renaming = false; return render();
    case "team-rename-save": {
      const i = document.getElementById("team-name-input");
      await D.act("setTeamName", { team: G.me.team, name: i ? i.value : "", byPlayer: true });
      G.ui.renaming = false;
      return render();
    }
    case "join-team": G.ui.joinTeam = el.dataset.team; return render();
    case "join": {
      const name = (document.getElementById("jn-name").value || "").trim().slice(0, 20);
      if (!name || !G.ui.joinTeam) return;
      G.me = { name, team: G.ui.joinTeam };
      G.ui.kicked = false;
      render();
      keepAwake();
      try { await D.joinGame(name, G.me.team); } catch (e) { console.warn(e); }
      return;
    }
    case "typed-submit": return submitTyped();
    case "final-choice": return saveFinalAnswer(el.dataset.v, true);
    case "vote-cast":
      if (!G.me) return;
      await D.act("castVote", { voter: G.deviceId, pick: el.dataset.pid });
      return;
    case "mcq": {
      // Instant feedback on this phone, before the database even answers.
      const c = G.S && G.S.clue, q = c && findQ(G, c.id), i = Number(el.dataset.i);
      if (q && c.stage === "answering") {
        const right = i === q.correctIndex;
        toast(right ? "✅ Correct!" : "❌ Wrong!", right ? "good" : "bad");
        vibrate(right ? [40, 40, 40] : [250]);
      }
      await D.act("mcqPick", { index: i, me: { deviceId: G.deviceId, name: G.me.name, team: G.me.team } });
      return;
    }
    case "fw-quick": { const i = document.getElementById("fw-input"); if (i) i.value = el.dataset.v; return; }
    case "final-wager": {
      const i = document.getElementById("fw-input");
      if (!i || i.value === "") return toast("Type your wager first.", "bad");
      await submitField(i, (typed) => D.act("finalWager", { team: G.me.team, amount: Number(typed), by: G.me.name }));
      return toast("Wager locked in ✓", "good");
    }
    case "final-answer": {
      clearTimeout(faTimer);
      const t = document.getElementById("fa-input");
      return saveFinalAnswer(t ? t.value : "", true);
    }
    case "gate": {
      const v = (document.getElementById("gate-code").value || "").trim();
      if (v === HOST_CODE) { store.set("jeop_host_ok", "1"); G.ui.gateErr = ""; Sounds.resume(); }
      else G.ui.gateErr = "That code isn't right.";
      return render();
    }
  }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled || el.dataset.action === "buzz") return;
  try {
    if (el.dataset.action.startsWith("lib-")) await libClick(el.dataset.action, el, libCtx);
    else await handle(el.dataset.action, params(el), el);
  }
  catch (err) { toast(err.message || String(err), "bad"); }
});
// Buzz on pointerdown — noticeably faster than waiting for a full click.
document.addEventListener("pointerdown", (e) => {
  Sounds.resume();
  keepAwake();
  const el = e.target.closest('[data-action="buzz"]');
  if (el && !el.disabled) { e.preventDefault(); buzz(); }
}, { passive: false });

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains("auto")) autosize(el);
  const k = el.dataset && el.dataset.input;
  if (k && k.startsWith("lib-")) return libInput(k, el, libCtx);
  if (k === "dd-wager") { G.ui.ddWager = el.value; render(); }
  else if (k === "join-name") { G.ui.joinName = el.value; render(); }
  else if (k === "final-answer") { clearTimeout(faTimer); const v = el.value; faTimer = setTimeout(() => saveFinalAnswer(v, false), 700); }
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  const k = el.dataset && el.dataset.change;
  if (!k) return;
  try {
    if (k.startsWith("lib-")) await libChange(k, el, libCtx);
    else if (k === "setting") await D.act("setSettings", { patch: { [el.dataset.key]: Number(el.value) } });
    else if (k === "setting-bool") await D.act("setSettings", { patch: { [el.dataset.key]: el.checked } });
    else if (k === "team-name") await D.act("setTeamName", { team: el.dataset.team, name: el.value });
    else if (k === "player-name") { const n = el.value.trim().slice(0, 20); if (n) await D.updatePlayer(el.dataset.id, { name: n }); }
    else if (k === "final-eligible") await D.act("finalSetEligible", { team: el.dataset.team, eligible: el.checked });
    else if (k === "import") await importFile(el);
    else if (k === "mini-field") await D.act("miniUpdate", { id: el.dataset.id, patch: { [el.dataset.f]: el.value } });
    else if (k === "mini-tables") await D.act("miniTables", { tables: el.value });
    else if (k === "mini-player") await D.act("miniSetPlayer", { id: el.dataset.id, team: el.dataset.team || null, pid: el.value });
  } catch (err) {
    toast(err.message || String(err), "bad");
    if (k === "mini-field" || k === "team-name" || k.startsWith("lib-")) { el.blur(); render(); } // snap the field back to the saved value
  }
});

async function importFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  G.ui.importMsg = "Reading spreadsheet…"; render();
  try {
    const { rows, error, summary } = parseWorkbook(await file.arrayBuffer());
    if (error) { G.ui.importMsg = "⚠️ " + error; toast(error, "bad"); return; }
    await D.replaceAllQuestions(rows);
    D.act("setLoaded", {}).catch(() => {}); // loaded from a spreadsheet, not a library set
    G.ui.importMsg = "✅ " + summary;
    toast("Questions imported ✓", "good");
  } catch (err) {
    G.ui.importMsg = "⚠️ " + err.message;
  } finally {
    input.value = "";
    render();
  }
}

// ---------------- keyboard shortcuts (host console / remote) ----------------
document.addEventListener("keydown", (e) => {
  const r = route();
  const tag = (e.target.tagName || "").toLowerCase();
  if (e.key === "Enter" && e.target.id === "gate-code") { document.querySelector('[data-action="gate"]').click(); return; }
  if (e.key === "Enter" && e.target.id === "jn-name") { document.querySelector('[data-action="join"]').click(); return; }
  if (e.key === "Enter" && e.target.id) {
    if (e.target.id === "typed-answer" && !e.shiftKey) { e.preventDefault(); submitTyped(); return; }
    // Library boxes: Enter saves (the text wraps on its own); Shift+Enter is ignored too.
    if (e.target.classList && e.target.classList.contains("auto") && e.target.dataset.change) { e.preventDefault(); e.target.blur(); return; }
    const go = { "ns-name": '[data-action="lib-new-create"]', "ns-year": '[data-action="lib-new-create"]',
      "new-cat-r1": '[data-action="lib-add-cat"][data-slot="r1"]', "new-cat-r2": '[data-action="lib-add-cat"][data-slot="r2"]',
      "mini-score": '[data-action="mini-score"]', "team-name-input": '[data-action="team-rename-save"]', "exact-score": '[data-action="set-exact"]',
      "add-player-team1": '[data-action="player-add"][data-team="team1"]', "add-player-team2": '[data-action="player-add"][data-team="team2"]',
      "mini-new-name": '[data-action="mini-add"]', "dd-wager": '[data-action="dd-lock"]', "fw-input": '[data-action="final-wager"]' }[e.target.id];
    const btn = go && document.querySelector(go);
    if (btn) { e.preventDefault(); btn.click(); return; }
  }
  if (e.key === "Escape") { G.ui.drawer = false; G.ui.modal = null; releaseFocus(); render(); return; }
  if (["input", "textarea", "select"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isPlayerRoute() && G.me && e.key === " ") { e.preventDefault(); buzz(); return; }
  if (!((r === "admin" || r === "remote" || r === "cheat") && isHost() && G.S) || G.ui.modal) return;
  const k = e.key === " " || e.key === "Enter" ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === "U") { e.preventDefault(); D.act("undo").catch(() => {}); return; }
  if (k === "M") { handle("toggle-sound", {}, null); return; }
  if (k === "F") { toggleFullscreen(); return; }
  if (k === "?") { handle("drawer", { tab: "help" }, null); return; }
  if (G.ui.drawer) return; // don't trigger game steps while the settings panel is open
  const b = hostSteps(G, { privateView: true }).buttons.find((x) => x.key === k);
  if (b) {
    e.preventDefault();
    if (e.target.closest && e.target.closest("button")) e.target.blur();
    handle(b.action, b.params || {}, document.querySelector(`[data-action="${b.action}"]`) || { dataset: {} }).catch((err) => toast(err.message, "bad"));
  }
});

// ---------------- boot ----------------
window.addEventListener("hashchange", () => { G.ui.drawer = false; G.ui.modal = null; render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { keepAwake(); D.syncClock(); } });
window.addEventListener("offline", () => toast("You're offline — reconnecting…", "bad"));
window.addEventListener("online", () => toast("Back online ✓", "good"));

function boot() {
  G.me = D.getLocalIdentity();
  G.soundOn = Sounds.initFromPref();
  render();
  startSubscriptions();
  D.ensureState().catch(onErr);
  D.syncClock().then(render);
  setInterval(() => D.syncClock(), 180000);
  if (G.me) D.registerSelf().then((ok) => { if (!ok) { G.me = null; G.seenSelf = false; G.ui.kicked = true; render(); } }).catch(() => {});
  setInterval(() => { tick(); automations(); }, 100);
  // Re-render once a second so time-based bits (e.g. the board fill animation) settle.
  setInterval(() => { if (route() !== "questions") render(); }, 1000);
}
boot();
