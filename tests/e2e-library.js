// End-to-end test of the question library.
//   node tests/server.js &
//   node tests/e2e-library.js [shotsDir]
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n); } };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? n : `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
async function until(page, fn, arg, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    await page.evaluate(() => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d))));
  } catch (e) {
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 500)).catch(() => "");
    throw new Error(`waited for: ${fn.toString().slice(0, 160)}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
  }
}
const PASTE = `## Christmas Movies
100 | Who lives on Mount Crumpit? | The Grinch
200 | What is the name of the Grinch's dog? | Max
300 | Which store introduced Rudolph in 1939? | Montgomery Ward | Macy's; Sears; Woolworth's | DD
## Carols
100 | Which carol mentions figgy pudding? | We Wish You a Merry Christmas
## History
200 | Which president made Christmas a federal holiday? | Ulysses S. Grant | Abraham Lincoln; Andrew Jackson; Theodore Roosevelt
== Final Jeopardy ==
## Famous Poems
This 1823 poem begins 'Twas the night before Christmas | A Visit from St. Nicholas
`;

(async () => {
  await fetch(URL + "__fs/reset", { method: "POST" });
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // (404 on an .mp3 = an optional sound file that isn't there — its built-in sound is used)
  page.on("console", (m) => { const url = (m.location() && m.location().url) || ""; if (m.type() === "error" && !/favicon|409/.test(m.text()) && !url.endsWith(".mp3")) errors.push(m.text()); });
  const sets = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__G.sets)));
  const toast = async (t) => { await until(page, (x) => { const e = document.getElementById("toast"); return e.classList.contains("show") && e.textContent.includes(x); }, t); return true; };

  console.log("Question library");
  await page.goto(URL + "#/questions");
  await page.fill("#gate-code", "2325");
  await page.press("#gate-code", "Enter");
  await page.waitForSelector(".lib-empty h2");
  ok(true, "library opens behind the host code and starts empty");

  // a past year from the sample
  await page.click('[data-action="lib-new"]');
  await page.fill("#ns-name", "Christmas 2025");
  await page.fill("#ns-year", "2025");
  await page.check('input[name="ns-from"][value="sample"]');
  await page.click('[data-action="lib-new-create"]');
  await until(page, () => window.__G.sets.length === 1 && window.__G.sets[0].clues.length === 31);
  ok(true, "a set can start from the sample game (31 questions)");
  ok((await page.textContent(".checkbar")).includes("ready to play") || (await page.textContent(".checkbar")).includes("suggestion"), "the set shows a readiness check");

  // this year's set, by pasting
  await page.click('[data-action="lib-new"]');
  await page.fill("#ns-name", "Christmas 2026");
  await page.press("#ns-name", "Enter");
  await until(page, () => window.__G.sets.length === 2);
  eq((await sets()).map((s) => [s.name, s.year, s.clues.length]), [["Christmas 2026", new Date().getFullYear(), 0], ["Christmas 2025", 2025, 31]], "sets are listed newest year first");
  await page.click('[data-action="lib-paste-open"]');
  await page.waitForSelector("#lib-paste");
  ok((await page.textContent(".formats")).includes("multiple choice"), "the paste box explains the format");
  await shot(page, "l01-paste-help");
  await page.fill("#lib-paste", PASTE);
  await until(page, () => document.querySelectorAll(".pp").length === 6);
  ok((await page.textContent(".paste-sum")).includes("6 found") && (await page.textContent(".paste-sum")).includes("2 multiple choice"), "live preview counts what was found before anything is saved");
  await shot(page, "l02-paste-preview");
  await page.click('[data-action="lib-paste-add"]');
  await until(page, () => window.__G.sets[0].clues.length === 6);
  let s = (await sets())[0];
  eq(s.clues.map((c) => [c.slot, c.category, c.points, c.wrong.length, c.dd]), [["r1", "Christmas Movies", 100, 0, false], ["r1", "Christmas Movies", 200, 0, false], ["r1", "Christmas Movies", 300, 3, true], ["r1", "Carols", 100, 0, false], ["r1", "History", 200, 3, false], ["final", "Famous Poems", null, 0, false]], "pasted questions land in the right round, category, value and type");
  ok((await page.textContent(".lib-main")).includes("Also asked in Christmas 2025"), "a question already asked in a past year is flagged");
  await shot(page, "l03-set");

  // edit inline: answer, make it multiple choice, add a note
  const max = s.clues[1].id;
  await page.fill(`[data-id="${max}"][data-f="answer"]`, "Max the dog");
  await page.locator(`[data-id="${max}"][data-f="answer"]`).dispatchEvent("change");
  await page.click(`[data-action="lib-toggle"][data-id="${max}"]`);
  await page.fill(`[data-id="${max}"][data-f="wrong"]`, "Rex; Buddy; Comet");
  await page.locator(`[data-id="${max}"][data-f="wrong"]`).dispatchEvent("change");
  await page.fill(`[data-id="${max}"][data-f="note"]`, "accept just Max");
  await page.locator(`[data-id="${max}"][data-f="note"]`).dispatchEvent("change");
  await until(page, (id) => { const c = window.__G.sets[0].clues.find((x) => x.id === id); return c.answer === "Max the dog" && c.wrong.length === 3 && c.note === "accept just Max"; }, max);
  ok((await page.textContent(`[data-key="qc-${max}"] .qc-flags`)).includes("Multiple choice"), "typing wrong options turns a question into multiple choice");
  await shot(page, "l04-clue-open");

  // add a clue + a category; unfinished filter
  await page.click('.lib-cat:has(input[value="Carols"]) .addclue');
  await until(page, () => window.__G.sets[0].clues.length === 7);
  await until(page, () => document.activeElement && document.activeElement.dataset.f === "question");
  await page.keyboard.type("Half-written question");
  await page.keyboard.press("Tab");
  await until(page, () => window.__G.sets[0].clues.some((c) => c.question === "Half-written question"));
  ok(true, "‘+ Add a clue’ puts the cursor straight in the new question");
  await page.fill("#new-cat-r1", "Santa Facts");
  await page.press("#new-cat-r1", "Enter");
  await until(page, () => window.__G.sets[0].clues.some((c) => c.category === "Santa Facts"));
  await page.click('[data-action="lib-filter"][data-v="todo"]');
  await until(page, () => document.querySelectorAll(".qc").length === 2);
  ok(true, "the Unfinished filter shows only what still needs work (2)");
  await page.click('[data-action="lib-filter"][data-v="all"]');
  await page.click('[data-action="lib-checks"]');
  ok((await page.textContent(".checks")).includes("still unfinished"), "the checklist names what to fix");

  // delete with undo
  const half = (await sets())[0].clues.find((c) => c.question === "Half-written question").id;
  await page.click(`[data-action="lib-toggle"][data-id="${half}"]`);
  await page.click(`[data-action="lib-clue-del"][data-id="${half}"]`);
  await until(page, () => !window.__G.sets[0].clues.some((c) => c.question === "Half-written question"));
  await page.click('[data-action="lib-undo-del"]');
  await until(page, () => window.__G.sets[0].clues.some((c) => c.question === "Half-written question"));
  ok(true, "a deleted question can be brought back with Undo");

  // rename + reorder a category
  await page.fill('.cat-name[value="Carols"]', "Christmas Carols");
  await page.locator('.cat-name[value="Carols"]').dispatchEvent("change");
  await until(page, () => window.__G.sets[0].clues.filter((c) => c.category === "Christmas Carols").length === 2);
  await page.click('.lib-cat:has(input[value="Christmas Carols"]) button[title="Move category earlier"]');
  await until(page, () => window.__G.sets[0].clues[0].category === "Christmas Carols");
  ok(true, "categories can be renamed and reordered");

  // search every year, copy a past question into this year
  await page.fill("#lib-search", "eggnog");
  await until(page, () => document.querySelectorAll(".hit").length >= 1);
  ok((await page.textContent(".lib-main")).includes("Christmas 2025") && (await page.textContent(".hit-a")).includes("Eggnog"), "search finds past years' questions and answers");
  await shot(page, "l05-search");
  await page.click('[data-action="lib-copy-hit"]');
  await toast("Copied into");
  await until(page, () => window.__G.sets[0].clues.some((c) => c.answer === "Eggnog"));
  ok(true, "a past question can be copied into this year's set");
  await page.click('[data-action="lib-search-clear"]');

  // AI prompt
  await page.click('[data-action="lib-prompt-open"]');
  await page.fill('[data-input="lib-prompt"][data-f="topics"]', "The Grinch, Elf");
  await until(page, () => document.getElementById("lib-prompt-text").value.includes("The Grinch, Elf"));
  const prompt = await page.inputValue("#lib-prompt-text");
  ok(prompt.includes("6 categories with 5 questions each") && prompt.includes("Don't reuse") && prompt.includes("Eggnog"), "the AI request includes size, topics and past answers to avoid");
  await page.click('[data-action="lib-prompt-copy"]');
  await toast("Copied");
  eq(await page.evaluate(() => navigator.clipboard.readText()), prompt, "…and copies to the clipboard");
  await shot(page, "l06-ai-prompt");
  await page.keyboard.press("Escape");

  // shuffle into random categories (same values), random Christmas names, undo
  await page.click('[data-action="lib-select"]:has-text("Christmas 2025")');
  await page.waitForSelector('[data-action="lib-shuffle"]');
  const snap = () => page.evaluate(() => { const s = window.__G.sets.find((x) => x.year === 2025); return s.clues.filter((c) => c.slot === "r1").map((c) => ({ id: c.id, q: c.question, cat: c.category, pts: c.points, ans: c.answer, wrong: c.wrong.join(";"), dd: c.dd })); });
  const before = await snap();
  const oldCats = [...new Set(before.map((c) => c.cat))];
  await page.click('[data-action="lib-shuffle"]');
  await until(page, (old) => { const s = window.__G.sets.find((x) => x.year === 2025); return s.clues.filter((c) => c.slot === "r1").every((c) => !old.includes(c.category)); }, oldCats);
  const after = await snap();
  const was = Object.fromEntries(before.map((c) => [c.id, c]));
  const autoPts = (c) => c.pts; // the sample game has every value written in
  ok(after.every((c) => was[c.id].pts === autoPts(c) && was[c.id].ans === c.ans && was[c.id].wrong === c.wrong && was[c.id].dd === c.dd), "🎲 Shuffle: every question keeps its value, answer, options and Daily Double");
  ok(after.every((c) => oldCats.indexOf(was[c.id].cat) !== -1 && c.cat !== was[c.id].cat), "…and lands in a different category");
  const newCats = [...new Set(after.map((c) => c.cat))];
  const pool = await page.evaluate(async () => (await import("/js/bank.js")).XMAS_CATEGORIES);
  ok(newCats.length === oldCats.length && newCats.every((n) => pool.includes(n)), `…and the categories get random Christmas names (${newCats.join(", ")})`);
  ok(await page.evaluate((cats) => cats.every((n) => [...document.querySelectorAll(".cat-name")].some((i) => i.value === n)), newCats), "the library shows the new categories");
  await until(page, () => !!document.querySelector(".undobar.mixed"));
  await shot(page, "l04b-shuffled");
  await page.click('[data-action="lib-rename-random"]');
  await until(page, (cats) => { const s = window.__G.sets.find((x) => x.year === 2025); return s.clues.filter((c) => c.slot === "r1").every((c) => !cats.includes(c.category)); }, newCats);
  const renamed = await snap();
  ok(renamed.every((c, i) => c.id === after[i].id && c.pts === after[i].pts), "🎄 New names: renames the categories and leaves the questions where they are");
  await page.click('[data-action="lib-mix-undo"]');
  await until(page, (b) => JSON.stringify(window.__G.sets.find((x) => x.year === 2025).clues.filter((c) => c.slot === "r1").map((c) => [c.id, c.category, c.points])) === JSON.stringify(b.map((c) => [c.id, c.cat, c.pts])), before);
  ok(true, "↩ Undo puts the whole round back the way it was");

  // lock a past year
  await page.click('[data-action="lib-more"]');
  await page.click('.morelist [data-action="lib-lock"]');
  await until(page, () => window.__G.sets.find((x) => x.year === 2025).locked);
  ok(await page.isDisabled(".qc-q"), "a locked past year can be read but not edited");
  ok(!(await page.$('[data-action="lib-paste-open"]:not([disabled])')), "…and can't be pasted into");

  // use this year's set in the game
  await page.click('[data-action="lib-select"]:has-text("Christmas 2026")');
  await page.click('[data-action="lib-use"]');
  ok((await page.textContent(".uselist")).includes("left out"), "loading explains that unfinished questions are left out");
  await shot(page, "l07-use");
  await page.click('[data-action="lib-use-go"]');
  await toast("is on the board");
  await until(page, () => window.__G.Q.length === 7);
  const Q = await page.evaluate(() => window.__G.Q.map((q) => [q.round, q.category, q.points, q.type, q.isFinal]));
  eq(Q.filter((q) => q[4]).length + "/" + Q.filter((q) => q[3] === "mcq").length + "/" + Q.filter((q) => q[0] === 2).length, "1/3/0", "the game now has the set's finished questions: Final and multiple choice (no Double Jeopardy)");
  ok((await page.textContent(".set-stats")).includes("In the game now"), "the library shows which set is on the board");
  await page.click('.lib-top a[href="#/admin"]');
  await page.waitForSelector(".remote");
  ok((await page.textContent(".r-status")).includes("questions"), "back on the host screen the lobby sees the questions");
  await page.keyboard.press("Space");
  await until(page, () => window.__G.S.phase === "board");
  eq(await page.$$eval(".r-cat", (e) => e.map((x) => x.textContent)), ["Christmas Carols", "Christmas Movies", "History", "Festive Food & Drink"], "the board shows the library's categories in order");
  await shot(page, "l08-board");

  // host note reaches the remote
  const maxQ = await page.evaluate(() => window.__G.Q.find((q) => q.answer === "Max the dog").id);
  await page.click(`.r-cell[data-id="${maxQ}"]`);
  await until(page, () => window.__G.S.phase === "clue");
  const remote = await ctx.newPage();
  await remote.goto(URL + "#/remote");
  await remote.waitForSelector(".secret");
  ok((await remote.textContent(".s-note")).includes("accept just Max"), "the host note shows on the private remote");
  await remote.close();

  // phone-sized library
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  phone.on("pageerror", (e) => errors.push("[phone] " + e.message));
  await phone.goto(URL + "#/questions");
  await phone.fill("#gate-code", "2325");
  await phone.press("#gate-code", "Enter");
  await phone.waitForSelector(".qc");
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `the library fits a phone with no sideways scrolling (overflow ${overflow}px)`);
  await shot(phone, "l09-phone");
  await phone.click('[data-action="lib-paste-open"]');
  await phone.fill("#lib-paste", "What is Santa's ZIP code? Answer: 88888");
  await until(phone, () => document.querySelectorAll(".pp").length === 1);
  await shot(phone, "l10-phone-paste");
  await phone.click('[data-action="lib-paste-add"]');
  await until(phone, () => window.__G.sets[0].clues.some((c) => c.answer === "88888"));
  ok(true, "questions can be pasted from a phone");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
