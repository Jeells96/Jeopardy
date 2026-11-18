// Unit tests for the question bank — run with:  node tests/bank.test.mjs
import * as B from "../js/bank.js";

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.log("  ✗ " + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const brief = (c) => [c.slot, c.category, c.points, c.question, c.answer, c.wrong, c.dd];

console.log("question bank tests");

// ---------- the recommended paste format (what the AI prompt asks for) ----------
{
  const text = `
## Christmas Movies
100 | Who lives on Mount Crumpit? | The Grinch
200 | In "Elf", what is Buddy's adoptive father called? | Papa Elf
500 | Which store introduced Rudolph in 1939? | Montgomery Ward | Macy's; Sears; Woolworth's

## Santa Facts
100 | What do kids leave out for Santa? | Cookies and milk | | DD
300 | What is Santa's ZIP code per the USPS? | 88888 | 12345; 99705; 00001 | | accept "five eights"
`;
  const r = B.parsePaste(text);
  eq(r.stats, { total: 5, ready: 5, needCategory: 0, unfinished: 0, categories: ["Christmas Movies", "Santa Facts"], mc: 2 }, "stats for a clean paste");
  eq(brief(r.clues[0]), ["r1", "Christmas Movies", 100, "Who lives on Mount Crumpit?", "The Grinch", [], false], "simple clue");
  eq(brief(r.clues[2]), ["r1", "Christmas Movies", 500, "Which store introduced Rudolph in 1939?", "Montgomery Ward", ["Macy's", "Sears", "Woolworth's"], false], "wrong options make it multiple choice");
  ok(B.isMC(r.clues[2]) && !B.isMC(r.clues[0]), "type follows from wrong options");
  eq([r.clues[3].dd, r.clues[3].wrong], [true, []], "Daily Double column with an empty wrong column");
  eq(r.clues[4].note, 'accept "five eights"', "host note column");
}

// ---------- rounds, final, and a title ----------
{
  const text = `# Christmas 2026

== Jeopardy ==
## Carols
100 | Q one | A one
== Double Jeopardy ==
## History
200 | Q two | A two
400 | Q three | A three | W1; W2; W3 | DD
== Final Jeopardy ==
## Famous Poems
This poem begins 'Twas the night before Christmas | A Visit from St. Nicholas
`;
  const r = B.parsePaste(text);
  eq(r.title, "Christmas 2026", "title line becomes the suggested set name");
  eq(r.clues.map((c) => [c.slot, c.category]), [["r1", "Carols"], ["r1", "History"], ["r1", "History"], ["final", "Famous Poems"]], "round markers and categories (an old Double Jeopardy marker just means more categories)");
  eq([r.clues[2].points, r.clues[2].dd, r.clues[2].wrong.length], [400, true, 3], "double jeopardy clue with options + DD");
  eq([r.clues[3].question.startsWith("This poem"), r.clues[3].answer, r.clues[3].wrong], [true, "A Visit from St. Nicholas", []], "final clue is never multiple choice");
}

// ---------- typical ChatGPT answers ----------
{
  const numbered = `
**Category: Holiday Movies**

1. What is the name of the Grinch's dog?
Answer: Max

2. Who plays Buddy in "Elf"? Answer: Will Ferrell

3. Q: What year was "Home Alone" released?
A: 1990
`;
  const r = B.parsePaste(numbered);
  eq(r.clues.map((c) => [c.category, c.question, c.answer]), [
    ["Holiday Movies", "What is the name of the Grinch's dog?", "Max"],
    ["Holiday Movies", 'Who plays Buddy in "Elf"?', "Will Ferrell"],
    ["Holiday Movies", 'What year was "Home Alone" released?', "1990"],
  ], "numbered questions with Answer: on the same or next line, and Q:/A: pairs");

  const lettered = `
### Christmas History
1. Which president made Christmas a federal holiday?
A) Abraham Lincoln
B) Ulysses S. Grant
C) Theodore Roosevelt
D) Andrew Jackson
Answer: B

2. In what year was the first commercial Christmas card sent?
A. 1798
B. 1865
*C. 1843
D. 1901

3. Who wrote "A Christmas Carol"?
Answer: Charles Dickens
`;
  const l = B.parsePaste(lettered, { slot: "r1" });
  eq([l.clues[0].answer, l.clues[0].wrong, l.clues[0].slot], ["Ulysses S. Grant", ["Abraham Lincoln", "Theodore Roosevelt", "Andrew Jackson"], "r1"], "lettered options + 'Answer: B' → the right option becomes the answer");
  eq([l.clues[1].answer, l.clues[1].wrong.length], ["1843", 3], "an option marked with * is the answer");
  eq([l.clues[2].answer, l.clues[2].wrong], ["Charles Dickens", []], "a plain question after a lettered one is not confused");
  eq(l.clues.map((c) => c.category), ["Christmas History", "Christmas History", "Christmas History"], "### heading sets the category");

  const table = `
| Category | Points | Question | Answer | Other choices |
|---|---|---|---|---|
| Carols | 100 | Which carol mentions figgy pudding? | We Wish You a Merry Christmas | |
| Carols | 200 | How many reindeer pull the sleigh in the 1823 poem? | Eight | Six; Nine; Twelve |
`;
  const t = B.parsePaste(table);
  eq(t.clues.map((c) => [c.category, c.points, c.answer, c.wrong.length]), [["Carols", 100, "We Wish You a Merry Christmas", 0], ["Carols", 200, "Eight", 3]], "markdown table with a header row");
}

// ---------- copied straight out of a spreadsheet (tabs) ----------
{
  const tabs = "Points\tQuestion\tAnswer\tOther choices\tDaily Double\n100\tWhat colour is Rudolph's nose?\tRed\t\t\n200\tWhat is Frosty's nose made of?\tA button\tA carrot; Coal; A cork\tYes\n";
  const r = B.parsePaste(tabs, { category: "Characters" });
  eq(r.clues.map((c) => [c.category, c.points, c.answer, c.wrong.length, c.dd]), [["Characters", 100, "Red", 0, false], ["Characters", 200, "A button", 3, true]], "tab-separated rows with the template's header");
  const noHeader = B.parsePaste("Carols\t100\tQ1\tA1\nCarols\t200\tQ2\tA2\tX; Y; Z", {});
  eq(noHeader.clues.map((c) => [c.category, c.points, c.wrong.length]), [["Carols", 100, 0], ["Carols", 200, 3]], "category | points | question | answer without a header");
}

// ---------- JSON ----------
{
  const r = B.parsePaste(JSON.stringify([
    { category: "Songs", points: 100, question: "Q1", answer: "A1" },
    { Category: "Songs", Value: "$200", Clue: "Q2", Answer: "A2", options: ["W1", "W2", "A2"], dailyDouble: true, round: "Double Jeopardy" },
  ]));
  eq(r.clues.map(brief), [["r1", "Songs", 100, "Q1", "A1", [], false], ["r1", "Songs", 200, "Q2", "A2", ["W1", "W2"], true]], "JSON with flexible key names; the answer is removed from the options");
}

// ---------- loose input still lands somewhere sensible ----------
{
  const r = B.parsePaste(`What is Frosty's pipe made of? A corncob
$300: Where is the Rockefeller Center tree? - New York City
Clarice = Rudolph's girlfriend
An unfinished thought about reindeer
- [ ]
`);
  eq(r.clues.map((c) => [c.question, c.answer, c.points]), [
    ["What is Frosty's pipe made of?", "A corncob", null],
    ["Where is the Rockefeller Center tree?", "New York City", 300],
    ["Clarice", "Rudolph's girlfriend", null],
    ["An unfinished thought about reindeer", "", null],
  ], "question-mark split, $points prefix, '=' split, and a bare line kept as unfinished");
  eq([r.stats.total, r.stats.ready, r.stats.needCategory, r.stats.unfinished], [4, 0, 3, 1], "without a category they're complete-but-unsorted; the bare line is unfinished");
  eq(B.parsePaste("").stats.total, 0, "empty paste");
  eq(B.parsePaste("   \n\n---\n").stats.total, 0, "only separators");
}

// ---------- cleaning ----------
{
  const c = B.cleanClue({ slot: "nope", points: "$1,000", question: "  Q   with   spaces ", answer: "Right", wrong: "Right; A) Wrong one; wrong one; Other", dd: 1 });
  eq(brief(c), ["r1", "", 1000, "Q with spaces", "Right", ["Wrong one", "Other"], true], "clean clue: slot fallback, $ points, whitespace, wrong options de-duplicated and never equal to the answer");
  eq(B.cleanClue({ points: "abc" }).points, null, "junk points → auto");
  eq(Number(B.cleanClue({ slot: "final", dd: true }).dd), 0, "final questions can't be Daily Doubles");
  eq(B.isMC(B.cleanClue({ slot: "final", question: "q", answer: "a", wrong: "b;c" })), true, "final questions can be multiple choice");
  eq(B.isMC(B.cleanClue({ question: "q", answer: "a", wrong: "b;c", mcOff: true })), false, "multiple choice can be switched off");
  eq(B.cleanClue({ question: "q", answer: "a", wrong: "b;c", mcOff: true }).wrong.length, 2, "switching multiple choice off keeps the options");
  {
    const { rows } = B.toGameRows({ clues: [B.cleanClue({ slot: "r1", category: "A", question: "q", answer: "a" }), B.cleanClue({ slot: "final", category: "F", question: "fq", answer: "fa", wrong: "x;y" })] });
    const f = rows.find((r) => r.isFinal);
    eq(f && f.type, "mcq", "final multiple choice goes to the game");
    eq(f && f.choices[f.correctIndex], "fa", "final correct choice is the answer");
  }
  eq(B.cleanWrong("a;b;c;d;e;f;g").length, 5, "at most 5 wrong options");
}

// ---------- grouping, auto points, checks ----------
const mk = (clues, extra = {}) => ({ ...B.newSet({ name: "Test", year: 2026, clues }), ...extra });
{
  const set = mk([
    { category: "A", question: "q1", answer: "a1" },
    { category: "A", question: "q2", answer: "a2", points: 100 },
    { category: "a", question: "q3", answer: "a3" },
    { category: "B", question: "q4", answer: "a4" },
    { category: "", question: "idea", answer: "" },
    { slot: "final", category: "Poems", question: "fq", answer: "fa" },
  ]);
  const g = B.groupSet(set);
  eq(g.rounds.r1.map((c) => [c.name, c.clues.map((x) => [x.question, x.pts, x.auto])]), [["A", [["q2", 100, false], ["q1", 200, true], ["q3", 300, true]]], ["B", [["q4", 100, true]]]], "categories merge case-insensitively; blank points fill the lowest unused value");
  eq([g.loose.length, g.final.length], [1, 1], "unsorted and final are separate");
  eq(B.setStats(set), { total: 6, ready: 5, ideas: 1, r1: 4, r2: 0, final: 1, mc: 0, dd: 0 }, "stats");
  const notes = B.checkSet(set).map((n) => n.text);
  ok(notes.some((t) => t.includes("Jeopardy › A: 3 of 5 questions written")), "check: short category");
  ok(notes.some((t) => t.includes("2 categories (the show uses 6")), "check: category count");
  ok(notes.some((t) => t.includes("0 Daily Doubles (the show has 1)")), "check: daily double count");
  ok(notes.some((t) => t.includes("1 unsorted idea — give it a category")), "check: unsorted ideas (singular)");
  ok(!notes.some((t) => t.includes("No Final")), "check: final present");
  const empty = B.checkSet(mk([])).map((n) => n.text);
  ok(empty.includes("The Jeopardy round has no categories yet.") && empty.includes("No Final Jeopardy question yet."), "check: empty set");
  const dup = B.checkSet(mk([{ category: "A", points: 100, question: "x", answer: "y" }, { category: "A", points: 100, question: "x2", answer: "y2" }, { category: "A", question: "half", answer: "" }]));
  ok(dup.some((n) => n.level === "warn" && n.text.includes("same point value")), "check: duplicate values");
  ok(dup.some((n) => n.level === "warn" && n.text.includes("1 question still unfinished")), "check: unfinished clue in a category");
}

// ---------- into the game and back ----------
{
  const set = mk([
    { category: "Movies", question: "q1", answer: "a1" },
    { category: "Movies", question: "q2", answer: "Right", wrong: ["W1", "W2", "W3"], dd: true, note: "accept X" },
    { category: "Movies", question: "unfinished", answer: "" },
    { category: "Extra Cat", question: "q3", answer: "a3" },
    { slot: "final", category: "Poems", question: "fq", answer: "fa" },
    { question: "loose", answer: "loose answer" },
  ]);
  const { rows, skipped, counts } = B.toGameRows(set);
  eq([rows.length, skipped, counts], [4, 2, { r1: 3, r2: 0, final: 1 }], "unfinished + unsorted clues are skipped");
  const mc = rows.find((r) => r.type === "mcq");
  ok(mc.choices.length === 4 && mc.choices[mc.correctIndex] === "Right" && mc.dailyDouble && mc.note === "accept X" && mc.points === 200, "multiple-choice row: shuffled options with the right index, DD, host note, auto value");
  eq(rows.map((r) => [r.round, r.isFinal, r.category, r.points]), [[1, false, "Movies", 100], [1, false, "Movies", 200], [1, false, "Extra Cat", 100], [0, true, "Poems", 0]], "rounds, final and values");
  ok(rows.every((r) => r.used === false && typeof r.order === "number"), "rows are ready for the game");
  const back = B.fromGameRows(rows);
  eq(back.map((c) => [c.slot, c.category, c.points, c.answer, c.wrong.length, c.dd]), [["r1", "Movies", 100, "a1", 0, false], ["r1", "Movies", 200, "Right", 3, true], ["r1", "Extra Cat", 100, "a3", 0, false], ["final", "Poems", null, "fa", 0, false]], "game rows convert back into clues");
  let seen = new Set();
  for (let i = 0; i < 40; i++) { const r = B.toGameRows(set).rows.find((x) => x.type === "mcq"); seen.add(r.correctIndex); }
  ok(seen.size > 1, "the right answer isn't always in the same position");
}

// ---------- text export round trip ----------
{
  const set = mk([
    { category: "Movies", points: 100, question: "Who | what?", answer: "a1" },
    { category: "Movies", question: "q2", answer: "Right", wrong: ["W1", "W2"], dd: true, note: "host note" },
    { category: "History", question: "q3", answer: "a3", dd: true },
    { slot: "final", category: "Poems", question: "fq", answer: "fa" },
    { question: "an idea" },
    { question: "loose q", answer: "loose a" },
  ]);
  const text = B.toText(set);
  ok(text.startsWith("# Test\n") && !text.includes("Double Jeopardy") && text.includes("== Ideas =="), "export has a title and round markers");
  const again = B.parsePaste(text);
  const strip = (c) => [c.slot, c.category, c.question, c.answer, c.wrong, c.dd, c.note];
  eq(again.clues.map(strip), B.groupSet(set) && [
    ["r1", "Movies", "Who / what?", "a1", [], false, ""],
    ["r1", "Movies", "q2", "Right", ["W1", "W2"], true, "host note"],
    ["r1", "History", "q3", "a3", [], true, ""],
    ["final", "Poems", "fq", "fa", [], false, ""],
    ["r1", "", "an idea", "", [], false, ""],
    ["r1", "", "loose q", "loose a", [], false, ""],
  ], "export → paste gives the same set back");
  eq(again.title, "Test", "title survives");
}

// ---------- editing ----------
{
  let set = mk([
    { category: "A", question: "q1", answer: "a1" },
    { category: "A", question: "q2", answer: "a2" },
    { category: "B", question: "q3", answer: "a3" },
    { category: "C", question: "q4", answer: "a4" },
  ]);
  const ids = set.clues.map((c) => c.id);
  set = B.applyOp(set, "updateClue", { id: ids[0], patch: { answer: "new", wrong: "x; y", points: "300" } });
  eq([set.clues[0].answer, set.clues[0].wrong, set.clues[0].points, set.clues[0].id], ["new", ["x", "y"], 300, ids[0]], "update a clue (id kept)");
  eq(B.applyOp(set, "updateClue", { id: "nope", patch: {} }), null, "unknown clue → no-op");
  set = B.applyOp(set, "moveClue", { id: ids[1], dir: -1 });
  eq(set.clues.slice(0, 2).map((c) => c.id), [ids[1], ids[0]], "move a clue earlier in its category");
  eq(B.applyOp(set, "moveClue", { id: ids[1], dir: -1 }), null, "can't move past the start");
  set = B.applyOp(set, "renameCategory", { slot: "r1", from: "a", to: "  Alpha " });
  eq(set.clues.filter((c) => c.category === "Alpha").length, 2, "rename a category (case-insensitive match)");
  set = B.applyOp(set, "moveCategory", { slot: "r1", name: "C", dir: -1 });
  eq(B.groupSet(set).rounds.r1.map((c) => c.name), ["Alpha", "C", "B"], "reorder categories");
  eq(B.applyOp(set, "moveCategory", { slot: "r1", name: "Alpha", dir: -1 }), null, "can't move the first category up");
  set = B.applyOp(set, "addClues", { clues: [{ category: "B", question: "new q", answer: "new a" }] });
  eq(set.clues.length, 5, "add clues");
  ok(new Set(set.clues.map((c) => c.id)).size === 5, "every clue has a unique id");
  set = B.applyOp(set, "removeClue", { id: ids[2] });
  eq(set.clues.length, 4, "remove a clue");
  set = B.applyOp(set, "meta", { patch: { name: "  Christmas 2026 ", year: "2026", notes: "n", locked: true } });
  eq([set.name, set.year, set.locked], ["Christmas 2026", 2026, true], "rename / year / lock");
  ok(!!B.applyOp(set, "removeClue", { id: ids[0] }).error, "a locked set refuses edits");
  set = B.applyOp(set, "meta", { patch: { locked: false } });
  eq(set.locked, false, "…but can be unlocked");
  eq(B.applyOp(set, "meta", { patch: { year: "banana", name: "" } }).year + "|" + B.applyOp(set, "meta", { patch: { name: "" } }).name, "2026|Christmas 2026", "bad year / blank name are ignored");
  const full = mk(Array.from({ length: B.MAX_CLUES }, (_, i) => ({ category: "A", question: "q" + i, answer: "a" })));
  ok(!!B.applyOp(full, "addClues", { clues: [{ question: "x" }] }).error, "a set has a size limit");
}

// ---------- past years: search + repeats ----------
{
  const y24 = { ...mk([{ category: "Movies", question: "What is the name of the Grinch's dog?", answer: "Max" }, { category: "Songs", question: "Which reindeer has a red nose?", answer: "Rudolph" }]), id: "s24", name: "Christmas 2024", year: 2024 };
  const y25 = { ...mk([{ category: "TV", question: "Who is Rudolph's girlfriend?", answer: "Clarice", note: "1964 special" }]), id: "s25", name: "Christmas 2025", year: 2025 };
  const y26 = { ...mk([
    { category: "Film", question: "What's the name of the Grinch's dog?", answer: "max" },
    { category: "Film", question: "Which actor is named Max in a totally different film?", answer: "Max" },
    { category: "Film", question: "Something new", answer: "Brand new" },
  ]), id: "s26", name: "Christmas 2026", year: 2026 };
  const sets = [y26, y25, y24];
  eq(B.searchSets(sets, "grinch dog").map((h) => h.set.name), ["Christmas 2026", "Christmas 2024"], "search finds the question in every year");
  eq(B.searchSets(sets, "1964").length, 1, "search covers host notes");
  eq(B.searchSets(sets, "  ").length, 0, "blank search");
  eq(B.searchSets(sets, "RUDOLPH").length, 2, "search is case-insensitive and covers answers");
  const idx = B.repeatIndex(sets);
  eq(B.repeatsFor(y26.clues[0], "s26", idx).map((h) => h.setName), ["Christmas 2024"], "flags a question already asked in a past year (wording slightly different)");
  eq(B.repeatsFor(y26.clues[1], "s26", idx), [], "same answer but a different question is NOT a repeat");
  eq(B.repeatsFor(y26.clues[2], "s26", idx), [], "new question has no repeats");
}

// ---------- AI prompt ----------
{
  const p = B.aiPrompt({ categories: 4, perCategory: 5, topics: "The Grinch, Elf", avoid: ["Max", "Clarice"] });
  ok(p.includes("4 categories with 5 questions each") && p.includes("100, 200, 300, 400, 500"), "prompt states the size and values");
  ok(p.includes("The Grinch, Elf") && p.includes("Max; Clarice"), "prompt carries the topics and the answers to avoid");
  const sample = p.split("\n").filter((l) => /^(##|\d+ \|)/.test(l)).join("\n");
  const parsed = B.parsePaste(sample);
  eq([parsed.stats.total, parsed.stats.ready, parsed.stats.mc], [3, 3, 1], "the format the prompt asks for is exactly what the paste box reads");
  ok(B.aiPrompt({ categories: 1 }).includes("1 category with"), "singular grammar");
}

// ---------- database safety ----------
{
  const bad = [];
  const walk = (v, path, inArray) => {
    if (v === undefined) bad.push("undefined at " + path);
    else if (Array.isArray(v)) { if (inArray) bad.push("nested array at " + path); v.forEach((x, i) => walk(x, `${path}[${i}]`, true)); }
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, path + "." + k, false));
  };
  const set = mk(B.parsePaste("## A\n100 | q | a | w1; w2 | DD | note\nloose idea").clues);
  walk(set, "set", false);
  walk(B.toGameRows(set).rows, "rows", false);
  eq(bad, [], "sets and game rows never contain undefined or nested arrays");
}

// ---------- move questions, delete a category ----------
{
  let set = mk([
    { category: "A", question: "a1", answer: "x", points: 100 },
    { category: "A", question: "a2", answer: "x", points: 200, dd: true },
    { category: "B", question: "b1", answer: "x" },
  ]);
  const [a1, a2] = set.clues;
  set = B.applyOp(set, "moveClues", { ids: [a1.id, a2.id], slot: "r1", category: "B" });
  eq(set.clues.map((c) => [c.question, c.category, c.points]), [["b1", "B", null], ["a1", "B", null], ["a2", "B", null]], "moved questions join the end of the new category with auto values");
  set = B.applyOp(set, "moveClues", { ids: [a2.id], slot: "final", category: "F" });
  eq([set.clues[2].slot, set.clues[2].dd], ["final", false], "moving to Final drops the Daily Double");
  eq(B.applyOp(set, "moveClues", { ids: ["nope"], slot: "r1", category: "B" }), null, "moving nothing changes nothing");
  const before = set.clues.length;
  set = B.applyOp(set, "removeCategory", { slot: "r1", name: "b" });
  eq([set.clues.length, before], [1, 3], "deleting a category removes all its questions");
  eq(B.applyOp(set, "removeCategory", { slot: "r1", name: "Gone" }), null, "deleting a missing category is a no-op");
  ok(!!B.applyOp({ ...set, locked: true }, "removeCategory", { slot: "final", name: "F" }).error, "locked sets can't lose a category");
}

// ---------- old Double Jeopardy questions are moved out, not lost ----------
{
  const raw = { ...mk([{ category: "A", question: "q1", answer: "a1" }]), locked: true };
  raw.clues = [...raw.clues, { id: "x1", slot: "r2", category: "DJ Stuff", points: 400, question: "dq", answer: "da", wrong: [], dd: false, note: "" }];
  const out = B.applyOp(raw, "dropRound2", {});
  eq(out.clues.map((c) => c.question), ["q1"], "round-2 questions are taken out (even from a locked set)");
  eq(B.applyOp(out, "dropRound2", {}), null, "nothing left to move → no change");
  ok(!B.SLOTS.includes("r2"), "Double Jeopardy isn't a round you can pick any more");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
