// End-to-end test for: mini-game tables + Christmas summons, the quick test game,
// a multiple-choice Final Jeopardy, and moving old Double Jeopardy questions into their own set.
//
//   node tests/server.js &
//   node tests/e2e-extras.js [shotsDir]
//
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  } catch (e) {
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 500)).catch(() => "");
    throw new Error(`[${page.name}] waited for: ${fn.toString().slice(0, 140)}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
  }
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }

(async () => {
  await fetch(URL + "__fs/reset", { method: "POST" });
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, viewport) {
    const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
    page.on("console", (m) => { const url = (m.location() && m.location().url) || ""; if (m.type() === "error" && !/favicon|409/.test(m.text()) && !url.endsWith(".mp3")) errors.push(`[${name}] ${m.text()}`); });
    page.name = name;
    return page;
  }
  const act = (page, name, p = {}) => page.evaluate(async ([n, x]) => { const D = await import("/js/data.js"); await D.act(n, x); }, [name, p]);

  // ---------------- test game from the library ----------------
  console.log("Test game");
  const host = await device("host", { width: 1280, height: 860 });
  await host.goto(URL + "#/questions");
  await host.fill("#gate-code", "2325");
  await host.press("#gate-code", "Enter");
  await host.waitForSelector('[data-action="lib-add-test"]');
  await host.click('[data-action="lib-add-test"]');
  await until(host, () => window.__G.sets.length === 1);
  const set = await host.evaluate(() => window.__G.sets[0]);
  const cats = [...new Set(set.clues.filter((c) => c.slot === "r1").map((c) => c.category))];
  ok(cats.length === 1 && set.clues.length === 6, "test game: one category of 5 + a Final");
  ok(!/christmas|santa|reindeer|elf/i.test(JSON.stringify(set.clues)), "test game has nothing Christmas in it");
  const fin = set.clues.find((c) => c.slot === "final");
  ok(fin.wrong.length === 3, "its Final is multiple choice");
  // ---- copy / move questions, delete a category ----
  const ids = set.clues.filter((c) => c.slot === "r1").map((c) => c.id);
  await host.click(`[data-action="lib-pick"][data-id="${ids[0]}"]`);
  await host.click(`[data-action="lib-pick"][data-id="${ids[1]}"]`);
  await until(host, () => !!document.querySelector(".clipbar"));
  ok((await host.textContent(".clipbar")).includes("2 questions"), "picking questions shows the clipboard bar");
  await host.fill("#new-cat-r1", "Moved Over");
  await host.click('[data-action="lib-paste-newcat"][data-slot="r1"]');
  await until(host, () => window.__G.sets[0].clues.filter((c) => c.category === "Moved Over").length === 2);
  ok((await host.evaluate(() => window.__G.sets[0].clues.length)) === 6 && !(await host.$(".clipbar")), "Move: the two questions moved into a new category (nothing duplicated)");
  await host.click('[data-action="lib-cat-pick"][data-name="Moved Over"]');
  await host.click('[data-action="lib-clip-mode"][data-v="copy"]');
  await host.click('[data-action="lib-paste-here"][data-cat="Animal Kingdom"]');
  await until(host, () => window.__G.sets[0].clues.length === 8);
  ok((await host.evaluate(() => window.__G.sets[0].clues.filter((c) => c.category === "Animal Kingdom").length)) === 5, "Copy: a whole category's questions copied into another");
  await shot(host, "x00-library-clipboard");
  await host.click('[data-action="lib-clip-clear"]');
  await host.click('[data-action="lib-cat-del-ask"][data-name="Moved Over"]');
  await host.click('[data-action="lib-cat-del-yes"]');
  await until(host, () => window.__G.sets[0].clues.length === 6);
  ok(!(await host.evaluate(() => window.__G.sets[0].clues.some((c) => c.category === "Moved Over"))), "a whole category can be deleted");
  await host.click('[data-action="lib-undo-del"]');
  await until(host, () => window.__G.sets[0].clues.length === 8);
  ok(true, "…and Undo brings it back");
  await host.click('[data-action="lib-cat-del-ask"][data-name="Moved Over"]');
  await host.click('[data-action="lib-cat-del-yes"]');
  await until(host, () => window.__G.sets[0].clues.length === 6);

  await host.click('[data-action="lib-use"]');
  await host.click('[data-action="lib-use-go"]');
  await until(host, () => window.__G.Q.length === 6);
  ok(true, "test game goes on the board");

  // ---------------- tables + summons ----------------
  console.log("Mini-game tables");
  await host.goto(URL + "#/admin");
  await host.waitForSelector(".remote");
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Questions")');
  await host.click('[data-action="confirm"][data-p*="loadTest"]');
  await host.click('[data-action="confirm-yes"]');
  await until(host, () => window.__G.S.loaded && window.__G.S.loaded.id === "test-game" && window.__G.Q.length === 6);
  ok(true, "Settings → Questions → 🧪 puts the test game on the board in one tap");
  await until(host, () => document.querySelector(".drawer")?.textContent.includes("The test game is on the board"));
  ok(true, "…and reminds you to load the real set afterwards");
  await host.keyboard.press("Escape");
  const board = await device("board", { width: 1600, height: 900 });
  await board.addInitScript(() => {
    window.__said = [];
    const fake = { speak: (u) => window.__said.push({ text: u.text, pitch: u.pitch }), cancel() { window.__hushed = (window.__hushed || 0) + 1; }, getVoices: () => [] };
    try { Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true }); } catch (e) { window.speechSynthesis = fake; }
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  ok(await board.evaluate(() => window.__G.soundOn === true), "sound is on by default");
  await board.click(".stage", { position: { x: 5, y: 5 } }); // any tap lets the browser play sound
  const P = {};
  for (const [n, t] of [["Jen", "team1"], ["Kim", "team2"]]) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.fill("#jn-name", n + " Berry");
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    P[n] = p;
  }
  await until(board, () => document.querySelector(".sound-btn")?.textContent.includes("Sound on"));
  ok(true, "the board has a clear sound on/off button");
  ok(await P.Jen.evaluate(async () => window.__G.soundOn === true && !(await import("/js/sounds.js")).blocked()), "tapping Join also turned the phone's sound on");
  await P.Jen.click(".ph-sound");
  await until(P.Jen, () => window.__G.soundOn === false);
  await P.Jen.reload();
  await P.Jen.waitForSelector(".phone");
  ok(await P.Jen.evaluate(() => window.__G.soundOn === true), "turning it off isn't remembered — a refresh turns sound back on");
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Mini games")');
  ok(!(await host.$('[data-change="mini-tables"]')) && !(await host.$('select[data-f="table"]')), "tables aren't in the mini game settings");
  await host.fill("#mini-new-name", "Snowball Toss");
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  await until(host, () => window.__G.S.minis.list.length === 1);
  // the description box grows to fit what's typed
  const desc = host.locator(".minicard textarea.desc");
  const h0 = await desc.evaluate((el) => el.offsetHeight);
  await desc.fill("Each player gets three snowballs. Stand behind the line and toss them into the bucket. Most snowballs in the bucket wins the round — ties go to a toss-off.");
  const h1 = await desc.evaluate((el) => el.offsetHeight);
  ok(h1 > h0 + 10 && (await desc.evaluate((el) => el.scrollHeight <= el.clientHeight + 4)), `the game description box grows to fit (${h0}px → ${h1}px)`);
  await desc.dispatchEvent("change");
  await until(host, () => window.__G.S.minis.list[0].desc.startsWith("Each player gets three snowballs"));
  await host.keyboard.press("Escape");
  await until(host, () => !document.querySelector(".drawer.open"));
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Mini games")');
  await until(host, () => !!document.querySelector(".minicard textarea.desc"));
  const h2 = await host.locator(".minicard textarea.desc").evaluate((el) => el.offsetHeight);
  ok(Math.abs(h2 - h1) < 6, "…and is still the right size when you come back to it");
  await host.keyboard.press("Escape");
  // two people per team, two tables: the same game at both tables at once
  for (const [n, t] of [["Ann", "team1"], ["Bo", "team2"]]) await host.evaluate(async ([n, t]) => { const D = await import("/js/data.js"); await D.addPlayer(n, t); }, [n, t]);
  await until(host, () => window.__G.P.length === 4);
  const id = await host.evaluate(() => window.__G.S.minis.list[0].id);
  await act(host, "miniPlay", { id });
  // tables are added/removed right next to the "who's up first" button
  await until(host, () => !!document.querySelector('.tablectl [data-key="tb-add"]'));
  ok((await host.textContent(".tablectl")).includes("one table"), "the mini game controls say you're playing at one table");
  await host.click('.tablectl [data-key="tb-add"]');
  await until(host, () => (window.__G.S.minis.tables || []).join() === "Table 1,Table 2");
  ok(true, "+ Add table: now Table 1 and Table 2");
  await host.click('.tablectl [data-key="tb-add"]');
  await until(host, () => (window.__G.S.minis.tables || []).length === 3);
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Draw for all 3 tables"));
  await host.click('.tablectl [aria-label="Remove Table 3"]');
  await until(host, () => (window.__G.S.minis.tables || []).length === 2);
  ok(true, "✕ removes a table");
  await shot(host, "x01-host-tables");
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Draw for all 2 tables"));
  ok(true, "host's button draws for every table at once");
  await host.keyboard.press("Space");
  await until(host, () => !!document.querySelector(".trow .spin.hspin.spinning"), null, 3000);
  ok(true, "the host's screen shuffles the names too");
  await until(board, () => document.querySelectorAll(".tcard .tc-sum").length === 2, null, 5000);
  const cards = await board.$$eval(".tcard", (els) => els.map((e) => e.textContent));
  ok(cards[0].includes("Table 1") && cards[1].includes("Table 2"), "the board shows a matchup at each table");
  ok(!(await host.$('.tablectl [aria-label="Remove Table 1"]')) && !(await host.$('.tablectl [aria-label="Remove Table 2"]')), "a table someone is playing at can't be removed");
  const drawn = await host.evaluate(() => window.__G.S.minis.list[0].matches.filter((m) => !m.winner).flatMap((m) => [m.p1.name, m.p2.name]));
  ok(new Set(drawn).size === 4, `four different players across the two tables (${drawn.join(", ")})`);
  await until(P.Jen, () => !!document.querySelector(".tabletag"));
  const jenTable = (await P.Jen.textContent(".tabletag")).replace(/[^A-Za-z0-9 ]/g, "").trim();
  const jenCard = cards.find((c) => c.includes(jenTable));
  ok(!!jenCard && jenCard.includes("Jen"), `Jen's phone sends her to the right table (${jenTable})`);
  const summon = await P.Jen.textContent(".ph-summon");
  ok(jenCard.includes(summon.trim()), "…with the same Christmas summons as the board");
  await sleep(400);
  await shot(board, "x02-board-summon");
  await shot(P.Jen, "x03-phone-summon");
  await shot(host, "x02b-host-tables");
  // swap tables from the host controls
  const jenMatch = await host.evaluate(() => window.__G.S.minis.list[0].matches.find((m) => !m.winner && (m.p1.name.startsWith("Jen") || m.p2.name.startsWith("Jen"))).id);
  await host.click(`[data-action="mini-row-edit"][data-id="${jenMatch}"]`);
  const otherTable = jenTable === "Table 1" ? "Table 2" : "Table 1";
  await host.selectOption(`select[data-change="mini-move"][data-ref="${jenMatch}"]`, otherTable);
  await until(P.Jen, (t) => document.querySelector(".tabletag")?.textContent.includes(t), otherTable);
  ok(true, "host can move a matchup to another table (the two tables swap)");
  // a result at one table frees just that table
  await host.locator(`.trow:has-text("Jen") .btn.t1`).click();
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Draw for"));
  ok((await host.evaluate(() => window.__G.S.minis.list[0].matches.filter((m) => !m.winner).length)) === 1, "the other table keeps playing");
  await host.keyboard.press("Space");
  await until(host, () => window.__G.S.minis.list[0].matches.filter((m) => !m.winner).length === 2);
  ok(true, "the next draw fills only the free table");
  await act(host, "miniFinish", { id, winner: "team1" });
  await act(host, "miniClose");

  // ---------------- Double Jeopardy switch + multiple-choice Final ----------------
  console.log("Final Jeopardy multiple choice");
  await act(host, "startGame", { control: "team1" });
  // ---- your MP3s are loaded; out of time = no more answering ----
  await until(board, async () => { const m = await import("/js/sounds.js"); return ["correct", "wrong", "timesup", "final", "intro", "dd"].every((k) => m.loadedSounds().includes(k)); }, null, 10000);
  ok(true, "all six MP3s are loaded and decoded on the board");
  await act(host, "startGame", { control: "team1" });
  await act(host, "setSettings", { patch: { answerSeconds: 3, reboundSeconds: 5 } });
  const slow = await host.evaluate(() => window.__G.Q.find((q) => q.points === 500 && !q.isFinal).id);
  await act(host, "pickClue", { qid: slow });
  await act(host, "openBuzzers");
  await until(P.Jen, () => !!document.querySelector(".buzz.live"));
  await P.Jen.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(P.Jen, () => !!document.getElementById("typed-answer"));
  const lateKey = await host.evaluate(async () => (await import("/js/engine.js")).lockKey(window.__G.S.clue));
  const t1Before = await host.evaluate(() => window.__G.S.scores.team1);
  const t2Before = await host.evaluate(() => window.__G.S.scores.team2);
  // Out of time: the bell rings, but nothing happens to the scores until Jaren says so.
  await until(host, () => window.__G.S.clue && window.__G.S.clue.timeUp, null, 8000);
  ok((await host.evaluate(() => window.__G.S.scores.team1)) === t1Before, "out of time: the bell rings but no points come off yet");
  await until(host, () => document.body.innerText.includes("Late answer"));
  ok(true, "the host is asked to make the call");
  await until(P.Jen, () => !document.getElementById("typed-answer"));
  ok(true, "the answer box closes on the phone");
  const refused = await P.Jen.evaluate(async (k) => { const D = await import("/js/data.js"); try { await D.act("answerSubmitted", { key: k }); return false; } catch { return true; } }, lateKey);
  ok(refused, "…and a late answer is refused by the database");
  await host.locator('.r-buttons .btn:has-text("Too late")').click();
  await until(host, () => window.__G.S.clue && window.__G.S.clue.stage === "open" && window.__G.S.clue.blocked.length === 1, null, 8000);
  ok((await host.evaluate(() => window.__G.S.scores.team1)) === t1Before - 500, "“Too late” takes the points off");
  await until(P.Kim, () => !!document.querySelector(".buzz.live") && !!document.querySelector(".timer, .ph-timer, .lights"));
  ok(true, "the other team gets the buzzer back, with a countdown to steal");
  await until(host, () => window.__G.S.clue.stage === "done", null, 9000);
  ok((await host.evaluate(() => [window.__G.S.clue.result, window.__G.S.clue.revealed, window.__G.S.scores.team2].join())) === "nobody,true," + t2Before, "nobody stole in time → answer shown, no points lost");
  await act(host, "closeClue");
  await act(host, "setSettings", { patch: { finalSeconds: 10 } });
  await act(host, "setScore", { team: "team1", value: 500 });
  await act(host, "setScore", { team: "team2", value: 400 });
  await act(host, "finalStart");
  await until(P.Jen, () => !!document.getElementById("fw-input"));
  for (const n of ["Jen", "Kim"]) { await P[n].fill("#fw-input", "100"); await P[n].click('[data-action="final-wager"]'); }
  await until(host, () => window.__G.S.final.wagers.team1 && window.__G.S.final.wagers.team2);
  await act(host, "finalRevealClue");
  await until(P.Jen, () => document.querySelectorAll('[data-action="final-choice"]').length === 4);
  ok(true, "phones get the Final as four choices");
  await until(board, () => document.querySelectorAll(".bchoice").length === 4);
  ok(true, "board shows the four choices");

  await P.Jen.click('[data-action="final-choice"][data-v="Mars"]');
  await P.Kim.click('[data-action="final-choice"][data-v="Venus"]');
  await until(host, () => window.__G.S.final.answers.team1 && window.__G.S.final.answers.team2);
  ok((await host.evaluate(() => window.__G.S.final.answers.team1.text)) === "Mars", "a tapped choice is saved as the team's answer");
  await sleep(1500);
  ok((await host.evaluate(() => window.__G.S.final.stage)) === "clue", "both teams answered, but the music and timer keep running");
  await until(host, () => window.__G.S.final.stage === "reveal", null, 14000);
  ok(true, "answers lock when the timer runs out");
  await act(host, "finalShowAnswer", { team: "team2" });
  await until(host, () => window.__G.S.final.results.team2 === "wrong");
  ok(true, "a wrong multiple-choice Final is marked wrong the moment it's revealed");
  await sleep(300);
  await shot(board, "x04-board-final-mc");
  await shot(P.Jen, "x05-phone-final-mc");

  // ---------------- old Double Jeopardy questions are moved, not lost ----------------
  console.log("Old Double Jeopardy questions");
  await host.goto(URL + "#/questions");
  await host.waitForSelector(".lib-sets");
  const before = await host.evaluate(() => window.__G.sets.length);
  await host.evaluate(async () => {
    const D = await import("/js/data.js");
    const c = (slot, category, question, points) => ({ id: Math.random().toString(36).slice(2, 10), slot, category, points, question, answer: "ans", wrong: [], dd: false, note: "" });
    await D.createSet({ id: "oldset", kind: "set", name: "Christmas 2024", year: 2024, notes: "", locked: false, createdAt: 1, updatedAt: 1,
      clues: [c("r1", "Movies", "keep me", 100), c("r2", "DJ History", "move me 1", 400), c("r2", "DJ History", "move me 2", 800), c("final", "Poems", "final q", null)] });
  });
  await until(host, (n) => window.__G.sets.length === n + 2, before, 10000);
  const old = await host.evaluate(() => window.__G.sets.find((x) => x.id === "oldset"));
  const extra = await host.evaluate(() => window.__G.sets.find((x) => x.name === "Christmas 2024 – extra categories"));
  ok(old.clues.map((x) => x.question).join(",") === "keep me,final q", "the old set keeps its Jeopardy round and Final");
  ok(!!extra && extra.clues.length === 2 && extra.clues.every((x) => x.slot === "r1" && x.category === "DJ History") && extra.clues.map((x) => x.points).join(",") === "200,400",
    "its Double Jeopardy questions moved into a new set as a regular category ($100–$500 values)");
  await sleep(1500);
  ok((await host.evaluate(() => window.__G.sets.length)) === before + 2, "moved only once");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
