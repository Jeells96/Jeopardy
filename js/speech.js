// Microphone + speech-to-text for spoken answers (Web Speech API).
// Best-effort: works in Chrome / Edge / Android Chrome; degrades gracefully elsewhere.

export function micSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function mediaSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Ask for microphone permission up front (from a user gesture) so later listening
// starts instantly without a prompt. Returns true if granted.
export async function requestMicPermission() {
  if (!mediaSupported()) {
    // Can't pre-grant, but SpeechRecognition may still prompt on first use.
    if (micSupported()) { localStorage.setItem("jeop_mic_ok", "1"); return true; }
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    localStorage.setItem("jeop_mic_ok", "1");
    return true;
  } catch (e) {
    localStorage.removeItem("jeop_mic_ok");
    return false;
  }
}
export function micEnabled() {
  return localStorage.getItem("jeop_mic_ok") === "1";
}

let recog = null;
let active = false;
let denied = false;
let lastStartAt = 0;

export function speechDenied() { return denied; }
export function isListening() { return active; }
export function msSinceStart() { return Date.now() - lastStartAt; }

export function startListening({ onTranscript, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || denied) { onError && onError(denied ? "not-allowed" : "unsupported"); return false; }
  if (active) return true;

  recog = new SR();
  recog.lang = "en-US";
  recog.continuous = true;
  recog.interimResults = true;
  recog.maxAlternatives = 1;

  let finalText = "";
  recog.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript + " ";
      else interim += res[0].transcript;
    }
    const text = (finalText + " " + interim).replace(/\s+/g, " ").trim();
    if (text) onTranscript && onTranscript(text);
  };
  recog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") denied = true;
    onError && onError(e.error);
  };
  recog.onend = () => { active = false; onEnd && onEnd(finalText.trim()); };

  try {
    recog.start();
    active = true;
    lastStartAt = Date.now();
    return true;
  } catch (e) {
    active = false;
    onError && onError(e.message);
    return false;
  }
}

export function stopListening() {
  if (recog && active) { try { recog.stop(); } catch (e) { /* ignore */ } }
  active = false;
}

// Fuzzy "does the spoken text contain the intended answer?" — host hint only.
function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\b(the|a|an|and|of|to|is|it|its)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
export function answerMatches(transcript, answer) {
  const t = norm(transcript), a = norm(answer);
  if (!t || !a) return false;
  if (t.includes(a)) return true;
  const at = a.split(" ").filter(Boolean);
  const ts = new Set(t.split(" "));
  const hit = at.filter((w) => ts.has(w)).length;
  return at.length > 0 && hit / at.length >= 0.6;
}
