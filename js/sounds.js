// Sound effects for the host / projector / remote screens.
//
// Drop your own MP3s into the /sounds folder with these exact names and they're used
// automatically. Anything missing falls back to an original synthesized placeholder.
export const SLOTS = {
  correct: "correct.mp3",          // right answer
  wrong: "wrong.mp3",              // wrong answer
  timesup: "times-up.mp3",         // a timer ran out
  final: "final-jeopardy.mp3",     // Final Jeopardy think music (loops)
  dd: "daily-double.mp3",          // Daily Double revealed
  buzz: "buzz-in.mp3",             // someone buzzed in
  fill: "board-fill.mp3",          // board appears at the start of a round
  win: "winner.mp3",               // winner announced
  pick: "up-next.mp3",             // mini games: drawing who's up next (about 2 seconds)
  miniwin: "mini-game-win.mp3",    // mini games: a team wins a mini game
};

const BASE = "./sounds/";
let enabled = false;
let ctx = null;
let master = null;
const available = {};   // slot -> true/false once probed
const cache = {};       // slot -> HTMLAudioElement
let probed = false;

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export const soundPref = () => store.get("jeop_sound") === "1";
export const soundEnabled = () => enabled;
export function initFromPref() { enabled = soundPref(); if (enabled) probe(); return enabled; }

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}
export function resume() {
  try { ensureCtx(); if (ctx && ctx.state === "suspended") ctx.resume(); } catch { /* ignore */ }
}
export function enableSound() { enabled = true; store.set("jeop_sound", "1"); resume(); probe(); play("buzz"); unlockSpeech(true); }
export function disableSound() { enabled = false; store.set("jeop_sound", "0"); setFinalMusic(false); }

// Check once which MP3s exist so a missing file never delays a cue.
async function probe() {
  if (probed) return;
  probed = true;
  await Promise.all(Object.entries(SLOTS).map(async ([k, f]) => {
    try {
      const r = await fetch(BASE + f, { method: "HEAD", cache: "no-store" });
      const type = r.headers.get("content-type") || "";
      available[k] = r.ok && !type.includes("text/html");
    } catch { available[k] = false; }
  }));
}

// ---------------- synth building blocks ----------------
function tone(freq, start, dur, { type = "sine", gain = 0.2, attack = 0.008, partials = null, detune = 0 } = {}) {
  const c = ensureCtx(); if (!c) return;
  const t0 = c.currentTime + start;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(master);
  const list = partials || [[1, 1]];
  for (const [mult, amp] of list) {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult, t0);
    o.detune.value = detune;
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}
const bell = (f, s, d = 0.9, g = 0.16) => tone(f, s, d, { partials: [[1, 1], [2, 0.35], [3.01, 0.18], [4.2, 0.08]], gain: g });
const pluck = (f, s, d = 0.35, g = 0.14) => tone(f, s, d, { type: "triangle", gain: g, attack: 0.004 });
function noise(start, dur, { gain = 0.08, hp = 6000 } = {}) {
  const c = ensureCtx(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(c.currentTime + start);
}
const sleighBells = (start, n = 6, gap = 0.07) => { for (let i = 0; i < n; i++) noise(start + i * gap, 0.09, { gain: 0.07, hp: 7000 }); };
const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // semitones from C4 (C4 = 0)

const SYNTH = {
  correct() { [12, 16, 19, 24].forEach((s, i) => bell(N(s + 12), i * 0.07, 0.8, 0.14)); sleighBells(0.05, 4); },
  wrong() { tone(N(-16), 0, 0.32, { type: "square", gain: 0.12 }); tone(N(-17), 0.28, 0.55, { type: "square", gain: 0.12 }); },
  timesup() { [0, 0.22, 0.44].forEach((t, i) => tone(N(7 - i * 2), t, 0.18, { type: "square", gain: 0.13 })); },
  buzz() { bell(N(19), 0, 0.5, 0.18); bell(N(24), 0.03, 0.6, 0.1); },
  dd() {
    for (let i = 0; i < 14; i++) pluck(N(i * 2 + 4), i * 0.035, 0.4, 0.09);
    sleighBells(0.1, 10, 0.06);
    [0, 4, 7, 12].forEach((s) => bell(N(s + 12), 0.55, 1.6, 0.11));
  },
  fill() {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    for (let i = 0; i < 22; i++) pluck(N(scale[(i * 7) % scale.length] + 12), i * 0.05, 0.3, 0.07);
    sleighBells(0.2, 8, 0.08);
  },
  win() {
    [[0, 0], [4, 0.14], [7, 0.28], [12, 0.42]].forEach(([s, t]) => tone(N(s + 12), t, 0.3, { type: "sawtooth", gain: 0.06 }));
    [0, 4, 7, 12, 16].forEach((s) => bell(N(s + 12), 0.6, 2.2, 0.1));
    sleighBells(0.6, 14, 0.07);
  },
  finalcat() { bell(N(12), 0, 1.2, 0.14); bell(N(16), 0.18, 1.2, 0.12); bell(N(19), 0.36, 1.6, 0.12); },
  // Drum-roll of quickening ticks while names shuffle, then a "ta-da" when it lands (~1.8s).
  pick() {
    let t = 0;
    for (let i = 0; i < 18; i++) { pluck(N(12 + (i % 5) * 2), t, 0.08, 0.07); noise(t, 0.03, { gain: 0.04, hp: 4000 }); t += 0.14 - i * 0.004; }
    [7, 12, 16].forEach((s2) => bell(N(s2 + 12), 1.8, 0.9, 0.13));
    sleighBells(1.8, 5, 0.06);
  },
  miniwin() {
    [[0, 0], [4, 0.1], [7, 0.2], [12, 0.3], [16, 0.42]].forEach(([s2, t]) => bell(N(s2 + 12), t, 0.9, 0.12));
    sleighBells(0.3, 8, 0.07);
  },
};

export function play(name) {
  if (!enabled) return;
  resume();
  if (available[name]) {
    let a = cache[name];
    if (!a) { a = new Audio(BASE + SLOTS[name]); a.preload = "auto"; cache[name] = a; }
    try { a.currentTime = 0; } catch { /* ignore */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => SYNTH[name] && SYNTH[name]());
    return;
  }
  if (SYNTH[name]) SYNTH[name]();
}

// Read a question out loud in a deep, slow, jolly "Santa" voice. Uses the best male
// English voice the device has; the pitch and pace do the rest.
const SANTA_NO = /female|woman|girl|samantha|victoria|karen|zira|susan|moira|tessa|fiona|veena|kathy|allison|ava|serena|kate|catherine|hazel|libby|sonia|jenny|aria/i;
const SANTA_YES = /male|man\b|daniel|fred|alex|david|mark|george|james|arthur|aaron|ralph|guy|thomas|ryan|rishi|oliver|gordon|lee|bruce|junior/i;
function santaVoice() {
  const all = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
  const en = all.filter((v) => /^en/i.test(v.lang || ""));
  const male = en.filter((v) => SANTA_YES.test(v.name) && !SANTA_NO.test(v.name));
  const pick = (list) => list.find((v) => /en[-_](GB|UK)/i.test(v.lang)) || list.find((v) => /en[-_]US/i.test(v.lang)) || list[0];
  return pick(male) || pick(en.filter((v) => !SANTA_NO.test(v.name))) || null;
}
if (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.getVoices) {
  try { window.speechSynthesis.getVoices(); } catch { /* voices load later on some browsers */ }
}
// Browsers are fussy about speech: Chrome can silently drop an utterance spoken right
// after cancel(), can get stuck "paused", and can garbage-collect an utterance mid-way;
// iPhones only allow speech after it has been started once from a tap. This handles all of it.
const talking = new Set(); // keep utterances alive until they finish
let speechUnlocked = false;
function speakNow(u, { delay = 0 } = {}) {
  const synth = window.speechSynthesis;
  talking.add(u);
  const done = () => talking.delete(u);
  u.onend = done;
  u.onerror = done;
  const go = () => { try { if (synth.resume) synth.resume(); synth.speak(u); } catch { done(); } };
  const busy = synth.speaking || synth.pending;
  if (busy) { try { synth.cancel(); } catch { /* ignore */ } }
  if (busy || delay) setTimeout(go, Math.max(delay, busy ? 120 : 0)); else go();
}
function canSpeak() { return typeof window !== "undefined" && "speechSynthesis" in window && !!window.SpeechSynthesisUtterance; }
function santaUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = santaVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
  u.pitch = 0.45;  // deep
  u.rate = 0.86;   // unhurried
  u.volume = 1;
  return u;
}
// Call from a tap: lets this device talk later (needed on iPhone/iPad and some Androids).
export function unlockSpeech(sayHello) {
  if (!canSpeak()) return;
  try {
    const synth = window.speechSynthesis;
    if (sayHello) { synth.cancel(); synth.speak(santaUtterance("Ho ho ho! Merry Christmas!")); }
    else if (!speechUnlocked) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); }
    speechUnlocked = true;
  } catch { /* ignore */ }
}
if (typeof document !== "undefined") {
  const first = () => { if (enabled) unlockSpeech(false); document.removeEventListener("pointerdown", first, true); document.removeEventListener("keydown", first, true); };
  document.addEventListener("pointerdown", first, true);
  document.addEventListener("keydown", first, true);
}
export function santa(text) {
  if (!enabled || !text || !canSpeak()) return;
  try { speakNow(santaUtterance(text)); } catch { /* no voice available — the question is on screen anyway */ }
}
export function hush() {
  try { if (canSpeak()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

// Read a short line out loud with the browser's built-in voice (mini games: "who's up next").
export function say(text) {
  if (!enabled || !text || !canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1.05;
    u.volume = 1;
    speakNow(u);
  } catch { /* no voice available — the names are on screen anyway */ }
}

// ---------------- Final Jeopardy music ----------------
// Your final-jeopardy.mp3 if present, otherwise an original music-box waltz placeholder.
let finalEl = null;
let loopTimer = null;
let loopNext = 0;
let loopStep = 0;
const PROG = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]]; // C – Am – F – G (generic)

function scheduleLoop() {
  const c = ensureCtx(); if (!c) return;
  const beat = 0.42;
  while (loopNext < c.currentTime + 0.6) {
    const bar = Math.floor(loopStep / 6) % PROG.length;
    const chord = PROG[bar];
    const pos = loopStep % 6; // two 3/4 bars per chord, eighth-note arpeggio
    const pattern = [0, 1, 2, 1, 2, 1];
    const s = chord[pattern[pos]] + 12 + (pos === 0 ? 0 : 12);
    const at = loopNext - c.currentTime;
    bell(N(s), at, 0.7, pos === 0 ? 0.11 : 0.07);
    if (pos === 0) tone(N(chord[0] - 12), at, 1.2, { type: "triangle", gain: 0.06 });
    if (pos % 2 === 0) noise(at, 0.03, { gain: 0.03, hp: 3000 }); // soft clock tick
    loopNext += beat / 2;
    loopStep++;
  }
}

export function setFinalMusic(on) {
  if (!on || !enabled) {
    if (finalEl) { try { finalEl.pause(); } catch { /* ignore */ } finalEl = null; }
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    return;
  }
  if (finalEl || loopTimer) return;
  resume();
  if (available.final) {
    finalEl = new Audio(BASE + SLOTS.final);
    finalEl.loop = true;
    const p = finalEl.play();
    if (p && p.catch) p.catch(() => { finalEl = null; startLoop(); });
  } else {
    startLoop();
  }
}
function startLoop() {
  const c = ensureCtx(); if (!c) return;
  loopNext = c.currentTime + 0.1;
  loopStep = 0;
  scheduleLoop();
  loopTimer = setInterval(scheduleLoop, 150);
}
