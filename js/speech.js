// Answer matching: does a typed answer contain the intended answer? (a hint for the host only)
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
