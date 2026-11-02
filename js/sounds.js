// Sound effects for the host / projector devices.
//
// Drop your own authentic MP3s into the /sounds folder with these exact names and they
// will be used automatically. Until then, original synthesized placeholder tones play.
//   sounds/correct.mp3         — correct answer
//   sounds/wrong.mp3           — wrong answer
//   sounds/times-up.mp3        — answer timer ran out
//   sounds/final-jeopardy.mp3  — Final Jeopardy music (looped during the final timer)

const FILES = {
  correct: "./sounds/correct.mp3",
  wrong: "./sounds/wrong.mp3",
  timesup: "./sounds/times-up.mp3",
  final: "./sounds/final-jeopardy.mp3",
};

let enabled = false;
let ctx = null;
const oneShot = {};      // cached HTMLAudioElements for one-shot files
let finalEl = null;      // looping Final Jeopardy audio
let tickTimer = null;    // metronome fallback when no final mp3

export function soundPref() { return localStorage.getItem("jeop_sound") === "1"; }
export function soundEnabled() { return enabled; }

export function initFromPref() { enabled = soundPref(); return enabled; }

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  return ctx;
}
// Resume the audio context after a user gesture (autoplay policies).
export function resume() {
  try { ensureCtx(); if (ctx && ctx.state === "suspended") ctx.resume(); } catch (e) { /* ignore */ }
}

export async function enableSound() {
  enabled = true;
  localStorage.setItem("jeop_sound", "1");
  resume();
}
export function disableSound() {
  enabled = false;
  localStorage.setItem("jeop_sound", "0");
  stopFinal();
}

// ---- Synthesized placeholder tones (original, non-copyrighted) ----
function beep(freq, dur, type = "sine", gain = 0.2, delay = 0) {
  try {
    ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch (e) { /* ignore */ }
}
function synth(key) {
  if (key === "correct") { beep(659, 0.12, "sine", 0.25, 0); beep(988, 0.22, "sine", 0.25, 0.12); }
  else if (key === "wrong") { beep(160, 0.5, "square", 0.18, 0); }
  else if (key === "timesup") { beep(466, 0.16, "square", 0.2, 0); beep(392, 0.16, "square", 0.2, 0.18); beep(311, 0.34, "square", 0.2, 0.36); }
}

// ---- One-shot cues ----
export function playOneShot(key) {
  if (!enabled || !FILES[key]) return;
  let a = oneShot[key];
  if (!a) { a = new Audio(FILES[key]); a.preload = "auto"; oneShot[key] = a; }
  try { a.currentTime = 0; } catch (e) { /* ignore */ }
  const p = a.play();
  if (p && p.catch) p.catch(() => synth(key)); // file missing/blocked → placeholder tone
}

// ---- Final Jeopardy music (looped) ----
export function startFinal() {
  if (!enabled) return;
  stopFinal();
  finalEl = new Audio(FILES.final);
  finalEl.loop = true;
  const p = finalEl.play();
  if (p && p.catch) p.catch(() => { finalEl = null; startTick(); });
}
export function stopFinal() {
  if (finalEl) { try { finalEl.pause(); } catch (e) { /* ignore */ } finalEl = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}
function startTick() {
  if (tickTimer) return;
  const t = () => beep(1000, 0.04, "square", 0.05, 0);
  t();
  tickTimer = setInterval(t, 1000); // neutral countdown tick placeholder
}
