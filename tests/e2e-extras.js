// End-to-end test for: mini-game tables + Christmas summons, the quick test game,
// a multiple-choice Final Jeopardy, and the Double Jeopardy switch.
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
  const board = await device("board", { width: 1600, height: 900 });
  await board.addInitScript(() => {
    window.__said = [];
    const fake = { speak: (u) => window.__said.push({ text: u.text, pitch: u.pitch }), cancel() { window.__hushed = (window.__hushed || 0) + 1; }, getVoices: () => [] };
    try { Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true }); } catch (e) { window.speechSynthesis = fake; }
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  await board.click('.board-tools [data-action="toggle-sound"]');
  const P = {};
  for (const [n, t] of [["Jen", "team1"], ["Kim", "team2"]]) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.fill("#jn-name", n);
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    P[n] = p;
  }
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Mini games")');
  await host.fill('input[data-change="mini-tables"]', "Kitchen, Living room");
  await host.locator('input[data-change="mini-tables"]').dispatchEvent("change");
  await until(host, () => (window.__G.S.minis.tables || []).length === 2);
  ok(true, "host names the tables");
  await host.fill("#mini-new-name", "Snowball Toss");
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  await until(host, () => window.__G.S.minis.list.length === 1);
  await until(host, () => !!document.querySelector('select[data-f="table"]'));
  ok((await host.$$eval('select[data-f="table"] option', (o) => o.map((x) => x.textContent))).join("|").includes("Living room"), "each game can be set to a table (or any)");
  await shot(host, "x01-host-tables");
  await host.keyboard.press("Escape");
  await act(host, "miniPlay", { id: (await host.evaluate(() => window.__G.S.minis.list[0].id)) });
  await act(host, "miniNext", { id: (await host.evaluate(() => window.__G.S.minis.list[0].id)) });
  await until(board, () => !!document.querySelector(".summon"), null, 5000);
  const summon = await board.textContent(".summon");
  ok(/Kitchen|Living room/.test(summon) && summon.includes("Jen") && summon.includes("Kim"), `board shows the summon: “${summon}”`);
  await until(P.Jen, () => !!document.querySelector(".tabletag"));
  ok(/Kitchen|Living room/.test(await P.Jen.textContent(".tabletag")), "the drawn player's phone says which table");
  ok((await P.Jen.textContent(".ph-summon")) === summon, "…with the same Christmas summons");
  ok((await host.textContent(".r-status")).match(/at (Kitchen|Living room)/), "host sees the table too");
  await sleep(400);
  await shot(board, "x02-board-summon");
  await shot(P.Jen, "x03-phone-summon");
  const id = await host.evaluate(() => window.__G.S.minis.list[0].id);
  await act(host, "miniMatch", { id, winner: "team1" });
  await act(host, "miniNext", { id });
  await until(board, () => !!document.querySelector(".summon"), null, 5000);
  ok((await board.textContent(".summon")) !== summon, "the next draw gets a different summons");
  await act(host, "miniFinish", { id, winner: "team1" });
  await act(host, "miniClose");

  // ---------------- Double Jeopardy switch + multiple-choice Final ----------------
  console.log("Final Jeopardy multiple choice");
  ok(!!(await host.evaluate(() => window.__G.S.settings.doubleJeopardy !== false)), "Double Jeopardy is on by default");
  await act(host, "startGame", { control: "team1" });
  // ---- Santa reads the question ----
  const elephant = await host.evaluate(() => window.__G.Q.find((q) => q.points === 100 && !q.isFinal).id);
  const santaSaid = () => board.evaluate(() => window.__said.filter((x) => x.pitch < 0.6).map((x) => x.text));
  await act(host, "pickClue", { qid: elephant });
  await until(board, () => window.__said.some((x) => x.pitch < 0.6 && x.text.includes("largest land animal")), null, 5000);
  ok(true, "Santa reads the picked question out loud (deep voice)");
  await act(host, "openBuzzers");
  await P.Jen.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(board, () => window.__G.S.clue && window.__G.S.clue.stage === "answering");
  await until(board, () => (window.__hushed || 0) > 0);
  ok(true, "Santa stops talking when someone buzzes in");
  await act(host, "judge", { result: "correct" });
  await act(host, "closeClue");
  const crows = await host.evaluate(() => window.__G.Q.find((q) => q.points === 200 && !q.isFinal && q.type === "mcq").id);
  await act(host, "pickClue", { qid: crows });
  await until(board, () => window.__said.some((x) => x.text.includes("Is it: A,")), null, 5000);
  ok(true, "multiple-choice options are read out too");
  await act(host, "unpickClue");
  await act(host, "setSettings", { patch: { readAloud: false } });
  const n = (await santaSaid()).length;
  await act(host, "pickClue", { qid: crows });
  await sleep(1500);
  ok((await santaSaid()).length === n, "switched off in Settings, Santa stays quiet");
  await act(host, "unpickClue");
  await act(host, "setSettings", { patch: { readAloud: true } });

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
  await until(board, () => window.__said.some((x) => x.pitch < 0.6 && x.text.includes("Final") && x.text.includes("Red Planet")), null, 5000);
  ok(true, "Santa reads the Final Jeopardy question");
  await P.Jen.click('[data-action="final-choice"][data-v="Mars"]');
  await P.Kim.click('[data-action="final-choice"][data-v="Venus"]');
  await until(host, () => window.__G.S.final.answers.team1 && window.__G.S.final.answers.team2);
  ok((await host.evaluate(() => window.__G.S.final.answers.team1.text)) === "Mars", "a tapped choice is saved as the team's answer");
  await sleep(300);
  await shot(board, "x04-board-final-mc");
  await shot(P.Jen, "x05-phone-final-mc");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
