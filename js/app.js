// Christmas Jeopardy — app bootstrap, routing, rendering, actions and automations.
import * as D from "./data.js";
import * as E from "./engine.js";
import { morph } from "./ui/util.js";
import { renderHost } from "./ui/host.js";
import { renderRemote } from "./ui/remote.js";
import { renderPlayer } from "./ui/player.js";
import { renderJoin, renderGate, renderLoading, renderBoardPage } from "./ui/join.js";
import { hostSteps } from "./ui/dock.js";
import * as Sounds from "./sounds.js";
import * as Speech from "./speech.js";
import { OWN, OPP, pickPunIndex } from "./puns.js";
import { downloadTemplate, parseWorkbook } from "./xlsx.js";

const HOST_CODE = "2325";

const G = {
  S: null, spoken: null, Q: [], P: [], B: [],
  me: null, deviceId: D.deviceId(),
  ui: { firstPick: "random", ddWager: "", ddTeam: null, drawer: false, drawerTab: "game", modal: null, joinName: "", joinTeam: null },
  fsError: false, soundOn: false, myBuzzKey: null, lastPun: null, seenSelf: false,
  now: () => D.serverNow(),
};
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
    else { html = G.S ? renderHost(G) : renderLoading(G); view = G.S ? "host" : "join"; }
  } else if (r === "remote" || r === "cheat") {
    if (!isHost()) { html = renderGate(G, "remote"); view = "join"; }
    else { html = G.S ? renderRemote(G) : renderLoading(G); view = G.S ? "remote" : "join"; }
  } else if (r === "board") {
    html = G.S ? renderBoardPage(G) : renderLoading(G); view = G.S ? "board" : "join";
  } else if (!G.me) {
    html = renderJoin(G); view = "join";
  } else {
    html = G.S ? renderPlayer(G) : renderLoading(G); view = G.S ? "player" : "join";
  }
  if (document.body.dataset.view !== view) document.body.dataset.view = view;
  morph(appEl, html);
  mountQR();
  tick();
}

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
    if (mine && !wasMine) vibrate([60, 40, 120]);
  }
  soundEffects(S);
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
    if (c.stage === "answering" && c.locked && c.timeUp !== key && now >= c.locked.at + (set.answerSeconds || 15) * 1000) fire("at" + key + c.locked.at, "answerTimeout", { key });
  }
  if (S.phase === "final" && S.final.stage === "clue" && now >= S.final.deadline) fire("fl" + S.final.deadline, "finalLock", {});
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

// ---------------- speech capture (answering player's phone) ----------------
let listenKey = null;
let lastSpokenWrite = 0;
let lastListenTry = 0;
function speechEffect() {
  const S = G.S;
  const c = S && S.clue;
  const q = c && G.Q.find((x) => x.id === c.id);
  const key = c ? E.lockKey(c) : "";
  const should = isPlayerRoute() && G.me && c && c.stage === "answering" && !c.dd && c.locked &&
    c.locked.deviceId === G.deviceId && q && q.type !== "mcq" && c.timeUp !== key &&
    Speech.micSupported() && Speech.micEnabled() && !Speech.speechDenied();
  if (!should) {
    if (listenKey) { Speech.stopListening(); listenKey = null; }
    return;
  }
  if (listenKey !== key) { listenKey = key; lastSpokenWrite = 0; }
  if (!Speech.isListening() && Date.now() - lastListenTry > 900) {
    lastListenTry = Date.now();
    const base = { key, deviceId: G.deviceId, name: G.me.name, team: G.me.team };
    Speech.startListening({
      onTranscript: (text) => {
        if (Date.now() - lastSpokenWrite < 350) return;
        lastSpokenWrite = Date.now();
        D.writeSpoken({ ...base, text, at: G.now(), final: false }).catch(() => {});
      },
      onEnd: (text) => { if (text) D.writeSpoken({ ...base, text, at: G.now(), final: true }).catch(() => {}); },
      onError: () => {},
    });
  }
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
  D.act("finalAnswer", { team: G.me.team, text, by: G.me.name })
    .then(() => { if (announce) toast("Answer saved ✓", "good"); })
    .catch((e) => toast(e.message, "bad"));
}

// ---------------- action dispatcher ----------------
const params = (el) => { try { return el.dataset.p ? JSON.parse(el.dataset.p) : {}; } catch { return {}; } };

async function handle(a, p, el) {
  const S = G.S;
  switch (a) {
    case "act": await D.act(p.name, p.p || {}); if (p.name === "adjustScore") render(); return;
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
    case "drawer-close": G.ui.drawer = false; return render();
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
    case "modal-close": G.ui.modal = null; return render();
    case "confirm": G.ui.modal = { type: "confirm", what: p.what }; return render();
    case "confirm-yes": {
      G.ui.modal = null; G.ui.drawer = false; render();
      if (p.what === "newGame") { await D.newGameFull(); toast("New game ready 🎄", "good"); }
      else if (p.what === "clearPlayers") { await D.clearPlayers(); toast("All players removed", "good"); }
      else if (p.what === "resetBoard") { await D.resetUsed(); toast("Every clue is back on the board", "good"); }
      else await D.act(p.what);
      return;
    }
    case "final-host-wager": {
      const input = document.getElementById("fw-" + el.dataset.team);
      if (!input || input.value === "") return toast("Type a wager first.", "bad");
      await D.act("finalWager", { team: el.dataset.team, amount: Number(input.value), by: "Host" });
      input.value = "";
      return toast("Wager set ✓", "good");
    }
    case "download-template": return downloadTemplate();
    case "player-team": await D.updatePlayer(el.dataset.id, { team: el.dataset.team }); return;
    case "player-remove": await D.removePlayer(el.dataset.id); return;

    // ---- players ----
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
    case "enable-mic": {
      el.textContent = "…";
      const ok = await Speech.requestMicPermission();
      render();
      if (!ok) toast("Microphone blocked — you can still answer out loud.", "bad");
      else toast("Mic ready 🎙️", "good");
      return;
    }
    case "mcq": await D.act("mcqPick", { index: Number(el.dataset.i), me: { deviceId: G.deviceId, name: G.me.name, team: G.me.team } }); return;
    case "fw-quick": { const i = document.getElementById("fw-input"); if (i) i.value = el.dataset.v; return; }
    case "final-wager": {
      const i = document.getElementById("fw-input");
      if (!i || i.value === "") return toast("Type your wager first.", "bad");
      await D.act("finalWager", { team: G.me.team, amount: Number(i.value), by: G.me.name });
      i.value = "";
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
  try { await handle(el.dataset.action, params(el), el); }
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
  const k = el.dataset && el.dataset.input;
  if (k === "dd-wager") { G.ui.ddWager = el.value; render(); }
  else if (k === "join-name") { G.ui.joinName = el.value; render(); }
  else if (k === "final-answer") { clearTimeout(faTimer); const v = el.value; faTimer = setTimeout(() => saveFinalAnswer(v, false), 700); }
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  const k = el.dataset && el.dataset.change;
  if (!k) return;
  try {
    if (k === "setting") await D.act("setSettings", { patch: { [el.dataset.key]: Number(el.value) } });
    else if (k === "setting-bool") await D.act("setSettings", { patch: { [el.dataset.key]: el.checked } });
    else if (k === "team-name") await D.act("setTeamName", { team: el.dataset.team, name: el.value });
    else if (k === "player-name") { const n = el.value.trim().slice(0, 20); if (n) await D.updatePlayer(el.dataset.id, { name: n }); }
    else if (k === "final-eligible") await D.act("finalSetEligible", { team: el.dataset.team, eligible: el.checked });
    else if (k === "import") await importFile(el);
  } catch (err) { toast(err.message || String(err), "bad"); }
});

async function importFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  G.ui.importMsg = "Reading spreadsheet…"; render();
  try {
    const { rows, error, summary } = parseWorkbook(await file.arrayBuffer());
    if (error) { G.ui.importMsg = "⚠️ " + error; toast(error, "bad"); return; }
    await D.replaceAllQuestions(rows);
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
  if (e.key === "Escape") { G.ui.drawer = false; G.ui.modal = null; render(); return; }
  if (["input", "textarea", "select"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isPlayerRoute() && G.me && e.key === " ") { e.preventDefault(); buzz(); return; }
  if (!((r === "admin" || r === "remote" || r === "cheat") && isHost() && G.S) || G.ui.modal) return;
  const k = e.key === " " || e.key === "Enter" ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === "U") { e.preventDefault(); D.act("undo").catch(() => {}); return; }
  if (k === "M") { handle("toggle-sound", {}, null); return; }
  if (k === "F") { toggleFullscreen(); return; }
  if (k === "?") { handle("drawer", { tab: "help" }, null); return; }
  const b = hostSteps(G, { privateView: r !== "admin" }).buttons.find((x) => x.key === k);
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
  if (G.me) D.registerSelf().catch(() => {});
  setInterval(() => { tick(); automations(); speechEffect(); }, 100);
  // Re-render once a second so time-based bits (e.g. the board fill animation) settle.
  setInterval(render, 1000);
}
boot();
