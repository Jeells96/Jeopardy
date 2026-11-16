// Question bank — pure logic, no browser or database code.
//
// A "set" is one game's worth of questions (usually one per year). Sets are kept forever
// so past years can be browsed, searched and reused.
//   set  = { kind:"set", id, name, year, notes, locked, starter, createdAt, updatedAt, clues:[...] }
//   clue = { id, slot:"r1"|"r2"|"final", category, points|null, question, answer, wrong:[], dd, note }
// A clue with wrong options is multiple choice. A clue missing its question, answer or
// category is an unfinished idea: it stays in the set but is not put on the board.

export const SLOTS = ["r1", "r2", "final"];
export const SLOT_LABEL = { r1: "Jeopardy", r2: "Double Jeopardy", final: "Final Jeopardy" };
const STEP = { r1: 100, r2: 200 };
export const MAX_CLUES = 400;

const rid = () => Math.random().toString(36).slice(2, 10);
const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const lc = (s) => String(s || "").trim().toLowerCase();
const truthy = (v) => ["yes", "y", "true", "1", "x", "✓", "dd", "daily double", "⭐"].includes(lc(v));

export function cleanWrong(v, answer = "") {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[;\n|]+/);
  const seen = new Set([lc(answer)]);
  const out = [];
  for (const p of parts) {
    const w = str(p, 120).replace(/^\(?[A-Fa-f][).:]\s+/, ""); // tolerate "A) option"
    if (w && !seen.has(lc(w))) { seen.add(lc(w)); out.push(w); }
  }
  return out.slice(0, 5);
}

export function cleanClue(raw = {}) {
  const slot = SLOTS.includes(raw.slot) ? raw.slot : "r1";
  const n = raw.points === "" || raw.points == null ? NaN : Math.round(Number(String(raw.points).replace(/[$,\s]/g, "")));
  const answer = str(raw.answer, 200);
  return {
    id: raw.id || rid(),
    slot,
    category: str(raw.category, 60),
    points: Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : null,
    question: str(raw.question, 400),
    answer,
    wrong: cleanWrong(raw.wrong, answer),
    mcOff: !!raw.mcOff, // wrong options kept but multiple choice switched off
    dd: slot === "final" ? false : !!raw.dd,
    note: str(raw.note, 300),
  };
}

export function newSet({ name, year, clues = [], starter = null, notes = "" } = {}) {
  const now = Date.now();
  return {
    kind: "set", id: rid(),
    name: str(name, 60) || "New question set",
    year: Number(year) || new Date().getFullYear(),
    notes: str(notes, 500), locked: false, starter: starter || null,
    createdAt: now, updatedAt: now,
    clues: clues.slice(0, MAX_CLUES).map((c) => cleanClue({ ...c, id: undefined })),
  };
}

// ---------- status ----------
export function clueIssues(c) {
  const out = [];
  if (!c.question) out.push("question");
  if (!c.answer) out.push("answer");
  if (c.slot !== "final" && !c.category) out.push("category");
  return out;
}
export const isReady = (c) => clueIssues(c).length === 0;
export const isMC = (c) => (c.wrong || []).length > 0 && !c.mcOff;

// Group a set the way the board will show it. Blank point values are auto-filled with the
// lowest unused value in that category ($100 steps, $200 in Double Jeopardy).
export function groupSet(set) {
  const rounds = { r1: [], r2: [] };
  const loose = []; // no category yet
  const final = [];
  for (const c of (set && set.clues) || []) {
    if (c.slot === "final") { final.push(c); continue; }
    if (!c.category) { loose.push(c); continue; }
    const list = rounds[c.slot] || rounds.r1;
    let cat = list.find((x) => lc(x.name) === lc(c.category));
    if (!cat) { cat = { name: c.category, slot: c.slot, clues: [] }; list.push(cat); }
    cat.clues.push(c);
  }
  for (const slot of ["r1", "r2"]) {
    for (const cat of rounds[slot]) {
      const used = new Set(cat.clues.filter((c) => c.points).map((c) => c.points));
      let k = 0;
      cat.clues = cat.clues.map((c, i) => {
        if (c.points) return { ...c, pts: c.points, auto: false, i };
        do { k++; } while (used.has(k * STEP[slot]));
        used.add(k * STEP[slot]);
        return { ...c, pts: k * STEP[slot], auto: true, i };
      }).sort((a, b) => a.pts - b.pts || a.i - b.i);
    }
  }
  return { rounds, loose, final };
}

export function setStats(set) {
  const clues = (set && set.clues) || [];
  const ready = clues.filter(isReady);
  return {
    total: clues.length, ready: ready.length, ideas: clues.length - ready.length,
    r1: ready.filter((c) => c.slot === "r1").length, r2: ready.filter((c) => c.slot === "r2").length,
    final: ready.filter((c) => c.slot === "final").length,
    mc: ready.filter(isMC).length, dd: ready.filter((c) => c.dd).length,
  };
}

// Friendly checklist of what a set still needs. level: "warn" (fix before playing) | "info".
export function checkSet(set) {
  const g = groupSet(set);
  const out = [];
  const s = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  for (const slot of ["r1", "r2"]) {
    const cats = g.rounds[slot];
    const label = SLOT_LABEL[slot];
    if (!cats.length) {
      if (slot === "r1") out.push({ level: "warn", text: "The Jeopardy round has no categories yet." });
      continue;
    }
    const target = Math.max(5, ...cats.map((c) => c.clues.length));
    for (const cat of cats) {
      const ready = cat.clues.filter(isReady).length;
      if (ready < cat.clues.length) out.push({ level: "warn", text: `${label} › ${cat.name}: ${s(cat.clues.length - ready, "question")} still unfinished.` });
      if (cat.clues.length < target) out.push({ level: "info", text: `${label} › ${cat.name}: ${cat.clues.length} of ${target} questions written.` });
      const pts = cat.clues.map((c) => c.pts);
      if (new Set(pts).size !== pts.length) out.push({ level: "warn", text: `${label} › ${cat.name}: two questions have the same point value.` });
    }
    if (cats.length !== 6) out.push({ level: "info", text: `${label}: ${s(cats.length, "categor").replace(/categors?$/, cats.length === 1 ? "category" : "categories")} (the show uses 6 — any number works).` });
    const dd = cats.reduce((n, cat) => n + cat.clues.filter((c) => c.dd && isReady(c)).length, 0);
    const want = slot === "r1" ? 1 : 2;
    if (dd !== want) out.push({ level: "info", text: `${label}: ${s(dd, "Daily Double")} (the show has ${want}).` });
  }
  const finals = g.final.filter(isReady).length;
  if (!finals) out.push({ level: "warn", text: "No Final Jeopardy question yet." });
  else if (finals > 1) out.push({ level: "info", text: `${finals} Final Jeopardy questions — only the first is used.` });
  if (g.loose.length) out.push({ level: "info", text: `${s(g.loose.length, "unsorted idea")} — give ${g.loose.length === 1 ? "it" : "them"} a category to put ${g.loose.length === 1 ? "it" : "them"} on the board.` });
  return out;
}

// ---------- to / from the live game ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Rows for the game's `questions` collection. Unfinished questions are skipped.
export function toGameRows(set) {
  const g = groupSet(set);
  const rows = [];
  let order = 0;
  let skipped = g.loose.length;
  const counts = { r1: 0, r2: 0, final: 0 };
  for (const slot of ["r1", "r2"]) {
    for (const cat of g.rounds[slot]) {
      for (const c of cat.clues) {
        if (!isReady(c)) { skipped++; continue; }
        const mc = isMC(c);
        const choices = mc ? shuffle([c.answer, ...c.wrong]) : [];
        rows.push({
          category: cat.name, points: c.pts, question: c.question, answer: c.answer,
          type: mc ? "mcq" : "spoken", choices, correctIndex: mc ? choices.indexOf(c.answer) : -1,
          dailyDouble: !!c.dd, isFinal: false, round: slot === "r2" ? 2 : 1, order: order++, used: false, note: c.note || "",
        });
        counts[slot]++;
      }
    }
  }
  const f = g.final.find(isReady);
  skipped += g.final.filter((c) => !isReady(c)).length;
  if (f) {
    const fmc = isMC(f);
    const fchoices = fmc ? shuffle([f.answer, ...f.wrong]) : [];
    rows.push({
      category: f.category || "Final Jeopardy", points: 0, question: f.question, answer: f.answer, type: fmc ? "mcq" : "spoken", choices: fchoices,
      correctIndex: fmc ? fchoices.indexOf(f.answer) : -1, dailyDouble: false, isFinal: true, round: 0, order: order++, used: false, note: f.note || "",
    });
    counts.final = 1;
  }
  return { rows, skipped, counts };
}
// Clues from the game's question rows (or a parsed spreadsheet).
export function fromGameRows(rows) {
  return [...(rows || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((r) => cleanClue({
    slot: r.isFinal ? "final" : r.round === 2 ? "r2" : "r1",
    category: r.isFinal && /^final(\s*jeopardy!?)?$/i.test(r.category || "") ? "" : r.category,
    points: r.isFinal ? null : r.points,
    question: r.question, answer: r.answer,
    wrong: r.type === "mcq" ? (r.choices || []).filter((_, i) => i !== r.correctIndex) : [],
    dd: r.dailyDouble, note: r.note,
  }));
}

// ---------- editing (pure: set in → set out, or { error }) ----------
const fail = (error) => ({ error });
const touch = (set, clues) => ({ ...set, clues, updatedAt: Date.now() });
function normalized(set) {
  // Canonical order: rounds → categories (as shown) → clues, then Final, then unsorted ideas.
  const g = groupSet(set);
  const strip = ({ pts, auto, i, ...c }) => c;
  const byArray = (cat) => cat.clues.slice().sort((a, b) => a.i - b.i).map(strip);
  return [...g.rounds.r1.flatMap(byArray), ...g.rounds.r2.flatMap(byArray), ...g.final, ...g.loose];
}
export const OPS = {
  meta(set, { patch = {} }) {
    const next = { ...set, updatedAt: Date.now() };
    if ("name" in patch) next.name = str(patch.name, 60) || set.name;
    if ("year" in patch) { const y = Math.round(Number(patch.year)); if (y >= 1900 && y <= 2200) next.year = y; }
    if ("notes" in patch) next.notes = str(patch.notes, 500);
    if ("locked" in patch) next.locked = !!patch.locked;
    return next;
  },
  addClues(set, { clues = [] }) {
    const room = MAX_CLUES - set.clues.length;
    if (room <= 0) return fail(`A set can hold up to ${MAX_CLUES} questions.`);
    return touch(set, [...set.clues, ...clues.slice(0, room).map((c) => cleanClue({ ...c, id: undefined }))]);
  },
  updateClue(set, { id, patch = {} }) {
    if (!set.clues.some((c) => c.id === id)) return null;
    return touch(set, set.clues.map((c) => (c.id === id ? cleanClue({ ...c, ...patch, id }) : c)));
  },
  removeClue(set, { id }) {
    if (!set.clues.some((c) => c.id === id)) return null;
    return touch(set, set.clues.filter((c) => c.id !== id));
  },
  // Nudge a clue earlier/later among its category's clues (changes the auto point order).
  moveClue(set, { id, dir }) {
    const c = set.clues.find((x) => x.id === id);
    if (!c) return null;
    const mates = set.clues.filter((x) => x.slot === c.slot && lc(x.category) === lc(c.category));
    const j = mates.indexOf(c) + (Number(dir) < 0 ? -1 : 1);
    if (j < 0 || j >= mates.length) return null;
    const a = set.clues.indexOf(c), b = set.clues.indexOf(mates[j]);
    const clues = set.clues.slice();
    [clues[a], clues[b]] = [clues[b], clues[a]];
    return touch(set, clues);
  },
  // Move questions to another category/round (they go to the end of it, values re-numbered).
  moveClues(set, { ids = [], slot, category = "" }) {
    if (!SLOTS.includes(slot)) return null;
    const want = new Set(ids);
    const moving = set.clues.filter((c) => want.has(c.id));
    if (!moving.length) return null;
    const cat = str(category, 60);
    const moved = moving.map((c) => {
      const same = c.slot === slot && lc(c.category) === lc(cat);
      return cleanClue({ ...c, slot, category: cat, points: same ? c.points : null });
    });
    return touch(set, [...set.clues.filter((c) => !want.has(c.id)), ...moved]);
  },
  removeCategory(set, { slot, name }) {
    const keep = set.clues.filter((c) => !(c.slot === slot && c.category && lc(c.category) === lc(name)));
    if (keep.length === set.clues.length) return null;
    return touch(set, keep);
  },
  renameCategory(set, { slot, from, to }) {
    const name = str(to, 60);
    if (!name || name === from) return null;
    return touch(set, set.clues.map((c) => (c.slot === slot && lc(c.category) === lc(from) ? { ...c, category: name } : c)));
  },
  moveCategory(set, { slot, name, dir }) {
    const g = groupSet(set);
    const cats = g.rounds[slot] || [];
    const i = cats.findIndex((x) => lc(x.name) === lc(name));
    const j = i + (Number(dir) < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= cats.length) return null;
    const order = cats.map((x) => lc(x.name));
    [order[i], order[j]] = [order[j], order[i]];
    const clues = normalized(set);
    const rank = (c) => (c.slot === slot && c.category ? order.indexOf(lc(c.category)) : -1);
    const inSlot = clues.filter((c) => rank(c) >= 0).sort((a, b) => rank(a) - rank(b));
    let k = 0;
    return touch(set, clues.map((c) => (rank(c) >= 0 ? inSlot[k++] : c)));
  },
};
export function applyOp(set, op, params) {
  const fn = OPS[op];
  if (!fn) return fail("Unknown edit: " + op);
  if (set.locked && !(op === "meta" && params && params.patch && "locked" in params.patch)) return fail("This set is locked — unlock it to make changes.");
  return fn(set, params || {});
}

// ---------- search + "have we asked this before?" ----------
const STOP = new Set("the a an of to is in on for and or what which who whom whose when where why how was were are did does do this that these those it its by with from at as be has have had name".split(" "));
const words = (s) => lc(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const normKey = (s) => words(s).join(" ");

export function searchSets(sets, query, limit = 150) {
  const terms = lc(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const set of sets || []) {
    for (const c of set.clues || []) {
      const hay = lc(`${c.question} ${c.answer} ${c.category} ${c.note} ${(c.wrong || []).join(" ")}`);
      if (terms.every((t) => hay.includes(t))) { out.push({ set, clue: c }); if (out.length >= limit) return out; }
    }
  }
  return out;
}
// Index every finished clue so repeats across years are quick to spot.
export function repeatIndex(sets) {
  const byAnswer = new Map();
  for (const set of sets || []) {
    for (const c of set.clues || []) {
      if (!c.answer || !c.question) continue;
      const k = normKey(c.answer);
      if (!k) continue;
      if (!byAnswer.has(k)) byAnswer.set(k, []);
      byAnswer.get(k).push({ setId: set.id, setName: set.name, year: set.year, q: new Set(words(c.question)), clueId: c.id });
    }
  }
  return byAnswer;
}
// Other sets that already contain (roughly) this question.
export function repeatsFor(clue, setId, index) {
  if (!clue.answer || !clue.question || !index) return [];
  const mine = new Set(words(clue.question));
  const hits = [];
  for (const e of index.get(normKey(clue.answer)) || []) {
    if (e.setId === setId) continue;
    const both = [...mine].filter((w) => e.q.has(w)).length;
    const union = new Set([...mine, ...e.q]).size || 1;
    if (both / union >= 0.5 && !hits.some((h) => h.setId === e.setId)) hits.push({ setId: e.setId, setName: e.setName, year: e.year });
  }
  return hits;
}

// ---------- mass input: turn pasted text into clues ----------
const ROUND_RE = /^(?:[=#*\-\s]*)(double\s+jeopardy|final\s+jeopardy|jeopardy(?:\s+round)?|round\s+(?:1|one|2|two)|ideas?|unsorted|notes?)!?(?:\s+round)?\s*:?(?:[=#*\-\s]*)$/i;
function roundSlot(name) {
  const n = lc(name);
  if (/double|round\s+(2|two)/.test(n)) return "r2";
  if (/final/.test(n)) return "final";
  if (/idea|unsorted|note/.test(n)) return "ideas";
  return "r1";
}
const isNum = (s) => /^\$?\d{2,5}$/.test(String(s).replace(/,/g, "").trim());
const isPoints = (n) => n >= 50 && n <= 5000 && n % 50 === 0;

export function parsePaste(text, defaults = {}) {
  const src = String(text || "").replace(/\r/g, "");
  const trimmed = src.trim();
  if (/^[[{]/.test(trimmed)) {
    try { return finish(fromJson(JSON.parse(trimmed), defaults), ""); } catch { /* not JSON — read it as text */ }
  }
  const lines = src.split("\n");
  const clues = [];
  let title = "";
  let cur = { slot: SLOTS.includes(defaults.slot) ? defaults.slot : "r1", category: defaults.category || "" };
  let last = null;      // most recent clue (for "Answer:" / options on following lines)
  let options = null;   // lettered options collected for `last`
  let header = null;    // column names from a header row
  const hasStructure = lines.some((l) => /^\s*(##|==)/.test(l));

  const settle = () => {
    if (last && options && options.length) {
      const right = options.find((o) => o.right);
      if (right && !last.answer) last.answer = right.text;
      if (last.answer) {
        const letter = /^[A-Fa-f]$/.test(last.answer.trim()) ? options.find((o) => o.letter === last.answer.trim().toUpperCase()) : null;
        if (letter) last.answer = letter.text;
      }
      last.wrong = options.map((o) => o.text).filter((t) => lc(t) !== lc(last.answer));
    }
    options = null;
  };
  const push = (c) => {
    settle();
    last = { slot: cur.slot === "ideas" ? "r1" : cur.slot, category: cur.slot === "ideas" ? "" : cur.category, ...c };
    clues.push(last);
    return last;
  };
  const nextLine = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim(); return ""; };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    // markdown noise: bullets, checkboxes, bold
    line = line.replace(/^[-*•–]\s*\[[ xX]?\]\s*/, "").replace(/^[*•]\s+/, "").replace(/^-\s+(?=\S)/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").trim();
    if (!line || /^[-=_*|\s:]+$/.test(line)) continue; // rules, table separators, empty bullets

    // "# Title" on the first line of a structured paste
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && !clues.length && !title && hasStructure && !ROUND_RE.test(h1[1])) { title = h1[1].trim(); continue; }

    // round markers:  == Double Jeopardy ==   ## Final Jeopardy   Round 2:
    const rm = line.match(ROUND_RE);
    if (rm) { settle(); last = null; cur = { slot: roundSlot(rm[1]), category: "" }; header = null; continue; }
    const rl = line.match(/^round\s*[:\-]\s*(.+)$/i);
    if (rl && ROUND_RE.test(rl[1])) { settle(); last = null; cur = { slot: roundSlot(rl[1]), category: "" }; continue; }

    // category:  ## Name   Category: Name   Name:
    const cm = line.match(/^#{1,6}\s*(.+?)\s*#*$/) || line.match(/^category\s*\d*\s*[:\-–]\s*(.+)$/i);
    const colon = !cm && /^[^|?\t]{2,50}:$/.test(line) && line.split(/\s+/).length <= 7 && !/^(q|a|answer|question|note|wrong|choices|options)\b/i.test(line);
    if (cm || colon) {
      settle(); last = null;
      cur = { ...cur, category: (cm ? cm[1] : line.slice(0, -1)).replace(/^category\s*\d*\s*[:\-–]\s*/i, "").replace(/[:*]+$/, "").trim() };
      if (cur.slot === "ideas") cur.slot = "r1";
      continue;
    }

    // tags anywhere on the line
    let dd = false;
    line = line.replace(/\s*[[(]\s*(?:daily\s*double|dd)\s*[\])]\s*/gi, () => { dd = true; return " "; }).trim();

    // table / spreadsheet rows:  points | question | answer | wrong; wrong | DD | note
    if (line.includes("|") || line.includes("\t")) {
      const f = line.replace(/^\|/, "").replace(/\|$/, "").split(line.includes("\t") ? "\t" : "|").map((x) => x.trim());
      const low = f.map(lc);
      if (low.some((x) => x === "question" || x === "clue") && low.some((x) => /answer|response/.test(x))) { header = low; continue; }
      const c = header ? byHeader(f, header, cur) : byPosition(f, cur);
      if (c && (c.question || c.answer)) { if (dd) c.dd = true; push(c); }
      continue;
    }

    // lines that add to the previous clue
    const wr = line.match(/^(?:wrong(?:\s+(?:answers?|options?|choices?))?|other\s+(?:choices|options)|distractors?)\s*[:\-–]\s*(.+)$/i);
    if (wr && last) { last.wrong = [...(last.wrong || []), ...wr[1].split(/[;|]|,\s+(?=\S)/)]; continue; }
    const nt = line.match(/^(?:host\s+)?notes?\s*[:\-–]\s*(.+)$/i);
    if (nt && last) { last.note = nt[1]; continue; }
    const pt = line.match(/^(?:points?|value)\s*[:\-–]\s*\$?(\d{2,5})$/i);
    if (pt && last) { last.points = pt[1]; continue; }

    // lettered options:  A) text   (B) text   C. text      (a "*" or "✓"/"(correct)" marks the right one)
    const om = line.match(/^(\*?)\(?([A-Fa-f])[).:]\s+(.+?)(\s*(?:✓|✔|\(correct\)|\*))?$/);
    if (om && last) {
      const letter = om[2].toUpperCase();
      const collecting = options && options.length;
      const startsList = letter === "A" && /^\*?\(?b[).:]\s/i.test(nextLine(i));
      if (collecting || startsList) {
        options = options || [];
        options.push({ letter, text: om[3].trim(), right: !!(om[1] || om[4]) });
        continue;
      }
    }

    // "Answer: X" on its own line
    const ao = line.match(/^(?:correct\s+)?(?:answer|ans|a)\s*[:\-–]\s*(.+)$/i);
    if (ao && last && !last.answer) { last.answer = ao[1].trim(); settle(); continue; }
    if (ao && /^(?:correct\s+)?(?:answer|ans)\b/i.test(line)) continue; // stray answer with nothing to attach to

    // a new clue
    let q = line;
    let points = null;
    // "$200: clue", "200 - clue", "(400) clue", "300 points: clue".  A bare "12." or "50)" is list numbering.
    const takePoints = () => {
      const pm = q.match(/^\(?(\$?)(\d{2,4})(\)?)(\s*(?:points?|pts))?\s*([:\-–.)]?)\s*(.+)$/i);
      if (!pm || !isPoints(Number(pm[2]))) return false;
      const marked = pm[1] || pm[4] || /[:\-–]/.test(pm[5]) || (q.startsWith("(") && pm[3]);
      if (!marked) return false;
      points = Number(pm[2]);
      q = pm[6];
      return true;
    };
    if (!takePoints()) q = q.replace(/^\d{1,3}[.)]\s+/, "");
    q = q.replace(/^(?:q(?:uestion)?\s*\d*\s*[:.)\-–]\s*)/i, "");
    if (points == null) takePoints();
    let answer = "";
    const inline = q.match(/^(.+?)\s*[([]?\s*(?:correct\s+)?(?:answer|ans)\s*[:\-–]\s*(.+?)[)\]]?$/i) || q.match(/^(.+?\?)\s*\ba\s*[:\-–]\s*(.+)$/i);
    if (inline) { q = inline[1].trim(); answer = inline[2].trim(); }
    else if (q.includes("?")) {
      const cut = q.lastIndexOf("?");
      const rest = q.slice(cut + 1).replace(/^[\s\-–—:=>]+/, "").trim();
      if (rest && rest.length <= 90) { answer = rest; q = q.slice(0, cut + 1).trim(); }
    } else {
      const sep = q.match(/^(.+?)\s+(?:=>|->|→|=|—|–|-)\s+(.+)$/);
      if (sep) { q = sep[1].trim(); answer = sep[2].trim(); }
    }
    push({ question: q, answer, points, dd });
  }
  settle();
  return finish(clues, title);

  function finish(list, name) {
    const cleaned = list.map((c) => cleanClue(c)).filter((c) => c.question || c.answer);
    const ready = cleaned.filter(isReady).length;
    const noCat = cleaned.filter((c) => c.slot !== "final" && !c.category && c.question && c.answer).length;
    const cats = [...new Set(cleaned.filter((c) => c.category).map((c) => c.category))];
    return { clues: cleaned, title: name, stats: { total: cleaned.length, ready, needCategory: noCat, unfinished: cleaned.length - ready - noCat, categories: cats, mc: cleaned.filter(isMC).length } };
  }
}
function slotFrom(v, fallback) {
  const n = lc(v);
  if (!n) return fallback;
  if (/final/.test(n)) return "final";
  if (/double|dj|^2$|r2|two/.test(n)) return "r2";
  return /jeopardy|^1$|r1|one/.test(n) ? "r1" : fallback;
}
function byHeader(f, header, cur) {
  const get = (...names) => { for (const n of names) { const i = header.findIndex((h) => h === n || h.startsWith(n)); if (i >= 0 && f[i] !== undefined) return f[i]; } return ""; };
  const slot = slotFrom(get("round"), cur.slot === "ideas" ? "r1" : cur.slot);
  const final = get("final");
  return {
    slot: truthy(final) ? "final" : slot,
    category: get("category") || cur.category,
    points: get("points", "value", "$"),
    question: get("question", "clue"), answer: get("answer", "correct answer", "response"),
    wrong: get("other choices", "other options", "wrong", "choices", "options", "distractors"),
    dd: truthy(get("daily double", "dd")), note: get("note", "host note"),
  };
}
function byPosition(f, cur) {
  const c = { slot: cur.slot === "ideas" ? "r1" : cur.slot, category: cur.category };
  let i = 0;
  if (c.slot === "final") {
    // "Category | Question | Answer" only when no "## Category" heading came first and the
    // third field doesn't look like wrong options ("a; b; c").
    if (f.length >= 3 && !cur.category && !/;/.test(f[2])) { c.category = f[0]; i = 1; }
    return { ...c, question: f[i], answer: f[i + 1], wrong: f[i + 2] || "", note: f[i + 3] || "" };
  }
  if (f.length >= 3 && !isNum(f[0]) && (isNum(f[1]) || f[1] === "")) { c.category = f[0]; c.points = f[1]; i = 2; }
  else if (isNum(f[0]) || (f[0] === "" && f.length >= 3)) { c.points = f[0]; i = 1; }
  return { ...c, question: f[i] || "", answer: f[i + 1] || "", wrong: f[i + 2] || "", dd: truthy(f[i + 3]), note: f[i + 4] || "" };
}
function fromJson(data, defaults) {
  const list = Array.isArray(data) ? data : data.clues || data.questions || [];
  const pick = (o, ...keys) => { for (const k of Object.keys(o)) if (keys.includes(lc(k).replace(/[\s_]/g, ""))) return o[k]; return undefined; };
  return list.map((o) => ({
    slot: SLOTS.includes(o.slot) ? o.slot : slotFrom(pick(o, "round"), defaults.slot || "r1"),
    category: pick(o, "category") || defaults.category || "",
    points: pick(o, "points", "value"),
    question: pick(o, "question", "clue"), answer: pick(o, "answer", "correctanswer"),
    wrong: pick(o, "wrong", "otherchoices", "choices", "options", "distractors") || [],
    dd: !!pick(o, "dd", "dailydouble"), note: pick(o, "note", "notes") || "",
  }));
}

// A set as plain text in the same format the paste box reads (round trip / backup / sharing).
export function toText(set) {
  const g = groupSet(set);
  const safe = (s) => String(s || "").replace(/\|/g, "/");
  const out = [`# ${set.name}`, ""];
  for (const slot of ["r1", "r2"]) {
    if (!g.rounds[slot].length) continue;
    out.push(`== ${SLOT_LABEL[slot]} ==`);
    for (const cat of g.rounds[slot]) {
      out.push(`## ${cat.name}`);
      for (const c of cat.clues) {
        const f = [c.pts, safe(c.question), safe(c.answer)];
        if (c.wrong.length || c.dd || c.note) f.push(c.wrong.map(safe).join("; "));
        if (c.dd || c.note) f.push(c.dd ? "DD" : "");
        if (c.note) f.push(safe(c.note));
        out.push(f.join(" | "));
      }
      out.push("");
    }
  }
  if (g.final.length) {
    out.push(`== ${SLOT_LABEL.final} ==`);
    for (const c of g.final) {
      if (c.category) out.push(`## ${c.category}`);
      out.push([safe(c.question), safe(c.answer), ...(c.wrong.length || c.note ? [c.wrong.map(safe).join("; ")] : []), ...(c.note ? [safe(c.note)] : [])].join(" | "));
    }
    out.push("");
  }
  if (g.loose.length) {
    out.push("== Ideas ==");
    for (const c of g.loose) out.push(c.answer ? `${safe(c.question)} | ${safe(c.answer)}${c.wrong.length ? " | " + c.wrong.map(safe).join("; ") : ""}` : safe(c.question));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// A ready-to-paste request for ChatGPT / Claude that returns clues in the format above.
export function aiPrompt({ categories = 6, perCategory = 5, slot = "r1", topics = "", avoid = [], audience = "adults at a family Christmas party" } = {}) {
  const step = slot === "r2" ? 200 : 100;
  const values = Array.from({ length: perCategory }, (_, i) => step * (i + 1));
  const lines = [
    `I'm writing questions for a Christmas-themed Jeopardy game for ${audience}.`,
    "",
    `Please write ${categories} categor${categories === 1 ? "y" : "ies"} with ${perCategory} questions each, ordered easiest to hardest (values ${values.join(", ")}).`,
  ];
  if (topics.trim()) lines.push(`Categories / themes I'd like: ${topics.trim()}`);
  lines.push(
    "",
    "Rules:",
    "- Every question needs exactly one clearly correct, checkable answer. Nothing ambiguous or opinion-based.",
    "- Keep each question short enough to read aloud in one breath.",
    "- A wrong answer loses points, so easy questions should be fair and hard questions genuinely hard.",
    "- For the hardest question or two in each category, add 3 believable WRONG options so it can be multiple choice.",
    "- Double-check every fact, date and spelling.",
  );
  if (avoid.length) lines.push(`- Don't reuse any of these answers from past years: ${avoid.slice(0, 250).join("; ")}`);
  lines.push(
    "",
    "Reply with ONLY the questions in exactly this format (no intro, no numbering, no extra commentary):",
    "",
    "## Category Name",
    `${values[0]} | Question text | Correct answer`,
    `${values[Math.min(1, values.length - 1)]} | Question text | Correct answer`,
    `${values[values.length - 1]} | Question text | Correct answer | Wrong option 1; Wrong option 2; Wrong option 3`,
  );
  return lines.join("\n");
}
