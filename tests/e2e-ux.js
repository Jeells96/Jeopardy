// End-to-end test for the little things that make the night smoother:
// a warning for a name that's already taken, the board on the phones while a team picks,
// "Ho ho ho — you got it!" / "Brrr — not quite" on the answering phone (and who missed, for everyone else),
// scores that float up when they change, a banner when a phone loses its connection, and
// the North Pole Awards (board and phones) — including the ugly sweater crown.
//
//   node tests/server.js &
//   node tests/e2e-ux.js [shotsDir]
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
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
    page.on("console", (m) => { const url = (m.location() && m.location().url) || ""; if (m.type() === "error" && !/favicon|409|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && !url.endsWith(".mp3")) errors.push(`[${name}] ${m.text()}`); });
    page.name = name;
    page.ctx = ctx;
    return page;
  }
  const act = (page, name, p = {}) => page.evaluate(async ([n, x]) => { const D = await import("/js/data.js"); await D.act(n, x); }, [name, p]);
  const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__G.S)));

  console.log("Setup");
  const host = await device("host", { width: 430, height: 900 });
  await host.goto(URL + "#/admin");
  await host.fill("#gate-code", "2325");
  await host.press("#gate-code", "Enter");
  await host.waitForSelector(".remote");
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.loadTestGame(); });
  await until(host, () => window.__G.Q.length === 6);
  const board = await device("board", { width: 1600, height: 900 });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");

  const P = {};
  const join = async (name, team, viewport = { width: 390, height: 844 }) => {
    const p = await device(name, viewport);
    await p.goto(URL);
    await p.fill("#jn-name", name);
    await p.click(`.teambtn.${team}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    p.team = team;
    P[name] = p;
    return p;
  };
  await join("Ann", "team1");
  await join("Cy", "team1");
  await join("Bob", "team2");
  await until(host, () => window.__G.P.length === 3);

  // ---- a name that's already taken ----
  const dup = await device("Ann2", { width: 390, height: 844 });
  await dup.goto(URL);
  await dup.fill("#jn-name", "ann");
  await until(dup, () => !!document.querySelector(".dupnote"));
  ok((await dup.textContent(".dupnote")).includes("Santa already has someone called Ann"), "typing a name someone already has warns you (names aren't case-sensitive)");
  ok((await dup.textContent(".dupnote")).includes("last initial"), "…and suggests adding a last initial");
  await shot(dup, "u01-join-duplicate-name");
  await dup.fill("#jn-name", "Ann K");
  await until(dup, () => !document.querySelector(".dupnote"));
  ok(true, "a different name clears the warning");
  await dup.click(".teambtn.team2");
  await dup.click('[data-action="join"]');
  await dup.waitForSelector(".phone");
  dup.team = "team2";
  P["Ann K"] = dup;
  await until(host, () => window.__G.P.length === 4);

  // ---- the board on the phones ----
  console.log("Jeopardy");
  await act(host, "setSettings", { patch: { answerSeconds: 20 } });
  await act(host, "startGame", { control: "team1" });
  await until(P.Ann, () => !!document.querySelector(".ph-board .r-grid"));
  ok((await P.Ann.textContent(".ph-board")).includes("5 questions"), "phones show what's left on the board while a team picks");
  ok((await P.Ann.$$(".ph-board .r-cell:not(.used)")).length === 5 && !(await P.Ann.textContent(".ph-board")).includes("DD"), "…every value still up, and no Daily Double marks (those are secret)");
  ok((await P.Bob.$(".ph-board")) !== null, "the other team sees it too");
  await shot(P.Ann, "u02-phone-board");
  await shot(host, "u03-host-status-holly");

  const qid = async (pts) => host.evaluate((p) => window.__G.Q.find((q) => q.points === p && !q.isFinal).id, pts);
  const buzzIn = async (page) => {
    await until(page, () => !!document.querySelector(".buzz.live"));
    await page.dispatchEvent('[data-action="buzz"]', "pointerdown");
    await until(host, (n) => window.__G.S.clue && window.__G.S.clue.stage === "answering" && window.__G.S.clue.locked.name === n, page.name);
  };

  // wrong → everyone knows who missed
  await act(host, "pickClue", { qid: await qid(100) });
  await act(host, "openBuzzers");
  await buzzIn(P.Ann);
  await act(host, "judge", { result: "wrong" });
  await until(P.Ann, () => !!document.querySelector(".ph-missed"));
  ok(/not quite/i.test(await P.Ann.textContent(".ph-missed")) && (await P.Ann.textContent(".ph-missed")).includes("$100"), "the answering phone says “Brrr — not quite! (−$100)”");
  await until(P.Cy, () => !!document.querySelector(".ph-missed"));
  ok((await P.Cy.textContent(".ph-missed")).includes("Ann missed"), "teammates see who missed");
  await until(P.Bob, () => !!document.querySelector(".ph-missed.theirs"));
  ok((await P.Bob.textContent(".ph-missed")).includes("steal"), "the other team is told it's their turn to steal");
  await until(board, () => !!document.querySelector(".spop.down"), null, 3000);
  ok((await board.textContent(".spop.down")).includes("$100"), "the board's score floats “−$100” up when it changes");
  await shot(P.Bob, "u04-phone-steal");
  await shot(P.Ann, "u05-phone-not-quite");
  await sleep(150);
  await shot(board, "u06-board-score-pop");

  // steal → "You got it!" on that phone, the right words everywhere else
  await buzzIn(P.Bob);
  await act(host, "judge", { result: "correct" });
  await until(P.Bob, () => !!document.querySelector(".ph-result"));
  ok((await P.Bob.textContent(".ph-result")).includes("Ho ho ho — you got it!"), "the phone that answered says “Ho ho ho — you got it!”");
  await until(P["Ann K"], () => !!document.querySelector(".ph-result"));
  ok((await P["Ann K"].textContent(".ph-result")).includes("Bob got it for your team"), "teammates: “Bob got it for your team!”");
  await until(P.Cy, () => !!document.querySelector(".ph-result"));
  ok((await P.Cy.textContent(".ph-result")).includes("Bob got it — Wives"), "the other team: “Bob got it — Wives +$100”");
  await until(P.Ann, () => !!document.querySelector(".spop.up"), null, 3000);
  ok(true, "phones' score chips float “+$100” up too");
  await shot(P.Bob, "u07-phone-you-got-it");
  await act(host, "closeClue");

  // more questions, for the awards
  const playMcq = async (pts, page, right) => {
    await act(host, "pickClue", { qid: await qid(pts) });
    await act(host, "openBuzzers");
    await buzzIn(page);
    const q = await host.evaluate((p) => window.__G.Q.find((x) => x.points === p && !x.isFinal), pts);
    await until(page, () => document.querySelectorAll(".mcqbtn:not([disabled])").length >= 2);
    const pick = right ? q.correctIndex : await page.evaluate((ci) => [...document.querySelectorAll(".mcqbtn")].map((b) => ({ i: +b.dataset.i, off: b.disabled })).find((b) => b.i !== ci && !b.off).i, q.correctIndex);
    await page.click(`.mcqbtn[data-i="${pick}"]`);
    await until(host, () => window.__G.S.clue && window.__G.S.clue.stage !== "answering");
  };
  await playMcq(200, P.Ann, true);                         // Ann right (+200)
  await act(host, "closeClue");
  await playMcq(400, P.Cy, false);                         // Cy wrong
  await playMcq(400, P.Bob, false);                        // Bob wrong → nobody
  ok((await S(host)).clue.result === "nobody", "both teams missed: nobody got it");
  await until(P.Bob, () => document.querySelector(".ph-result") && /not quite/i.test(document.querySelector(".ph-result").textContent));
  ok(true, "the last one to miss sees “Brrr — not quite … Nobody got it!”");
  await act(host, "closeClue");
  await act(host, "pickClue", { qid: await qid(500) });
  await act(host, "openBuzzers");
  await buzzIn(P.Bob);
  await act(host, "judge", { result: "wrong" });          // Bob wrong again
  await act(host, "nobody");
  await act(host, "closeClue");

  // ---- losing the connection ----
  console.log("Connection");
  await P.Bob.ctx.setOffline(true);
  await until(P.Bob, () => document.querySelector("#netbar.show"), null, 6000);
  ok(/North Pole — reconnecting/.test(await P.Bob.textContent("#netbar")) && (await P.Bob.textContent("#netbar")).includes("won't count"), "a phone that loses its connection says so (and that buzzes won't count)");
  await shot(P.Bob, "u08-phone-offline");
  await P.Bob.ctx.setOffline(false);
  await until(P.Bob, () => document.querySelector("#netbar") && document.querySelector("#netbar").textContent.includes("Back online"), null, 15000);
  ok(true, "…and “Back online” when it's back");

  // ---- the night's awards ----
  console.log("Awards");
  await act(host, "endGame");
  await until(board, () => document.querySelectorAll(".awards .award").length >= 3);
  const awardsTxt = await board.textContent(".awards");
  ok(/Head Elf[\s\S]*Ann/.test(awardsTxt), "🧝 Head Elf: Ann (most right answers; ties go to whoever won more)");
  ok(awardsTxt.includes("Fastest Reindeer") && awardsTxt.includes("s buzz"), "🦌 Fastest Reindeer with the reaction time");
  ok(/🪨\s*Naughty List[\s\S]*Bob[\s\S]*2 wrong/.test(awardsTxt), "🪨 Naughty List: a lump of coal for Bob (most wrong or unanswered)");
  ok((await board.textContent(".awards-wrap")).includes("The North Pole Awards"), "under a “🌟 The North Pole Awards 🌟” heading");
  await sleep(3500); // let the awards finish appearing
  await shot(board, "u09-board-awards");
  const fits = await board.evaluate(() => { const m = document.querySelector(".stage-main").getBoundingClientRect(); return [...document.querySelectorAll(".award, .aw-head, .over-title, .os")].every((el) => { const r = el.getBoundingClientRect(); return r.top >= m.top - 1 && r.bottom <= m.bottom + 1; }); });
  ok(fits, "winner, scores and awards all fit on the board");
  await until(P.Ann, () => !!document.querySelector(".night .night-stats"));
  const night = await P.Ann.textContent(".night");
  ok(night.includes("Nice List report") && night.includes("right answer") && night.includes("+$200") && night.includes("fastest buzz"), "each phone gets a “Nice List report”: right answers, money won, fastest buzz");
  ok(night.includes("You made the North Pole Awards") && (await P.Ann.textContent(".night-won .nw-tag")).includes("Head Elf"), "…with a gold tag for each award that player won (one per line)");
  ok((await P.Ann.$$(".ph-awards .pa-row")).length >= 3, "phones list all of the night's awards");
  await shot(P.Ann, "u10-phone-your-night");
  await P.Ann.evaluate(() => window.scrollTo(0, 9999));
  await shot(P.Ann, "u11-phone-awards");

  // the ugly sweater winner keeps the crown on the final scores
  await act(host, "voteSetup");
  await act(host, "voteOpen");
  const ids = await host.evaluate(() => Object.fromEntries(window.__G.P.map((p) => [p.name, p.id])));
  for (const [voter, pick] of [["Ann", "Cy"], ["Bob", "Cy"], ["Ann K", "Cy"], ["Cy", "Ann"]]) await P[voter].evaluate(async ([v, p]) => { const D = await import("/js/data.js"); await D.act("castVote", { voter: v, pick: p }); }, [ids[voter], ids[pick]]);
  await until(host, () => window.__G.S.vote.stage === "reveal");
  await act(host, "voteBack");
  await until(board, () => document.querySelector(".awards") && document.querySelector(".awards").textContent.includes("Ugliest Sweater"));
  ok(/Ugliest Sweater[\s\S]*Cy/.test(await board.textContent(".awards")), "after the sweater vote, the winner's crown joins the awards");
  await until(P.Cy, () => document.querySelector(".night-won") && document.querySelector(".night-won").textContent.includes("Ugliest Sweater"));
  ok(true, "…and their phone says they won it");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
