// End-to-end test: a full game across host, board, remote and four phones.
//
//   node tests/server.js &          (local site + in-memory database)
//   node tests/e2e.js [shotsDir]    (optional: save screenshots there)
//
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
const TEMPLATE = require("path").resolve(__dirname, "..", "christmas-jeopardy-template.xlsx");

let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__G.S)));
async function until(page, fn, arg, timeout = 8000) {
  try { return await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
  catch (e) {
    const S = await page.evaluate(() => window.__G && window.__G.S).catch(() => null);
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 600)).catch(() => "");
    throw new Error(`[${page.name}] waited for: ${fn.toString().slice(0, 140)}\n  phase=${S && S.phase} clue=${S && S.clue ? JSON.stringify({ stage: S.clue.stage, locked: S.clue.locked && S.clue.locked.name, blocked: S.clue.blocked, dd: S.clue.dd }) : null}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
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
    // 409 = a losing transaction attempt (e.g. the 49 phones that didn't win a buzz) — expected.
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|409/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
    page.name = name;
    return page;
  }
  async function hostLogin(page, path) {
    await page.goto(URL + path);
    await page.fill("#gate-code", "2325");
    await page.press("#gate-code", "Enter");
  }
  const key = async (page, k) => { await page.keyboard.press(k); await sleep(120); };
  const clickText = (page, sel, text) => page.locator(sel, { hasText: text }).first().click();

  // ---------------- setup ----------------
  console.log("Setup");
  const host = await device("host", { width: 1440, height: 900 });
  await hostLogin(host, "#/admin");
  await host.waitForSelector(".host");
  ok(true, "host console opens with code 2325");
  await host.click('[data-action="drawer"][data-p*="game"]');
  await host.click('.tab:has-text("Questions")');
  await host.setInputFiles('input[data-change="import"]', TEMPLATE);
  await until(host, () => (document.querySelector(".import-msg") || {}).textContent?.includes("Imported"));
  ok((await host.textContent(".import-msg")).includes("30 Double Jeopardy"), "template imports both rounds + Final");
  await key(host, "Escape");

  const board = await device("board", { width: 1920, height: 1080 });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");

  const remote = await device("remote", { width: 390, height: 844 });
  await hostLogin(remote, "#/remote");
  await remote.waitForSelector(".remote");
  ok(true, "host remote opens");

  const people = [["Jo", "team1"], ["Amy", "team1"], ["Rick", "team2"], ["Bea", "team2"]];
  const P = {};
  for (const [n, t] of people) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.fill("#jn-name", n);
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    p.team = t;
    P[n] = p;
  }
  await until(board, () => document.querySelectorAll(".roster-list .chip").length === 4);
  ok(true, "4 players appear on the projector lobby");
  await host.click('[data-action="drawer"][data-p*="game"]');
  await host.locator('input[data-change="setting"][data-key="answerSeconds"]').fill("6");
  await host.locator('input[data-change="setting"][data-key="answerSeconds"]').dispatchEvent("change");
  await key(host, "Escape");
  await until(host, () => window.__G.S.settings.answerSeconds === 6);
  ok(true, "settings change from the drawer");
  await shot(board, "01-board-lobby");

  // ---------------- start ----------------
  console.log("Round 1");
  await host.click('[data-action="first-pick"][data-v="team1"]');
  await key(host, "Space");
  await until(board, () => document.querySelectorAll(".jcell .val").length === 30);
  ok((await board.textContent(".ctrl")).includes("Team 1 picks next"), "game starts, Team 1 has control");
  ok((await P.Jo.textContent(".ph-card h2")).includes("Your team picks next"), "Team 1 phones say they pick next");
  await sleep(1200);
  await shot(board, "02-board-grid");
  await shot(host, "03-host-board");

  // ---------------- buzz race / puns / rebound ----------------
  const q = async (cat, pts, round = 1) => host.evaluate(([c, p, r]) => window.__G.Q.find((x) => x.category === c && x.points === p && (x.round || 1) === r), [cat, pts, round]);
  const pick = async (cat, pts, round) => {
    const x = await q(cat, pts, round);
    await host.click(`.jcell[data-id="${x.id}"]`);
    await until(host, (id) => window.__G.S.clue && window.__G.S.clue.id === id, x.id);
    return x;
  };

  const q1 = await pick("Christmas Movies", 100);
  await until(board, () => !!document.querySelector(".clue .clue-text"));
  ok((await board.textContent(".clue-text")).includes("Kevin McCallister"), "clue shows on the board");
  ok(await P.Rick.isVisible(".buzz.wait"), "phones show a WAIT buzzer while the clue is read");
  ok((await remote.textContent(".s-ans")).includes("Home Alone"), "remote shows the secret answer");
  ok(!(await host.textContent(".stage")).includes("Home Alone"), "answer is NOT on the mirrored host screen");
  await key(host, "Space"); // open buzzers
  await until(P.Jo, () => !!document.querySelector(".buzz.live"));
  await Promise.all(Object.values(P).map((p) => p.dispatchEvent('[data-action="buzz"]', "pointerdown")));
  await until(board, () => window.__G.S.clue && window.__G.S.clue.stage === "answering");
  let S = await state(board);
  const winner = S.clue.locked;
  ok(!!winner, `exactly one winner of a 4-way simultaneous buzz (${winner.name})`);
  await until(board, () => document.querySelectorAll(".bo-row").length === 4);
  ok(true, "buzz order lists all 4 presses");
  const wp = P[winner.name];
  ok(await wp.isVisible(".youup"), "the winner's phone says You're up");
  const mates = Object.values(P).filter((p) => p.team === winner.team && p !== wp);
  const opps = Object.values(P).filter((p) => p.team !== winner.team);
  await until(opps[0], () => !!document.querySelector(".punbox"));
  const oppLines = await Promise.all(opps.map((p) => p.textContent(".pun-line")));
  ok(oppLines[0] === oppLines[1] && oppLines[0].includes(winner.name), "both opponents see the same pun with the name");
  ok(await opps[0].isVisible(".punbox.theirs"), "opponents get the 'hope they miss' pun");
  if (mates.length) ok(await mates[0].isVisible(".punbox.ours"), "teammate gets the 'rooting for you' pun");
  await shot(board, "04-board-answering");
  await shot(opps[0], "05-phone-pun-theirs");
  if (mates.length) await shot(mates[0], "06-phone-pun-ours");
  await shot(remote, "07-remote-answering");

  await key(host, "w");
  await until(board, () => window.__G.S.clue.stage === "open");
  S = await state(board);
  ok(S.scores[winner.team] === -100, "wrong answer subtracts $100");
  ok(S.clue.blocked.includes(winner.team), "auto-rebound blocks the team that missed");
  await until(wp, () => !!document.querySelector(".ph-note"));
  ok((await wp.textContent(".ph-note")).includes("already had a go"), "blocked team's phones explain why");
  const stealer = opps[0];
  await stealer.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(board, () => window.__G.S.clue.stage === "answering");
  await key(host, "c");
  await until(board, () => window.__G.S.clue.stage === "done");
  S = await state(board);
  ok(S.scores[stealer.team] === 100 && S.control === stealer.team, "steal is correct: +$100 and takes control");
  ok((await board.textContent(".answer-reveal")).includes("Home Alone"), "answer revealed on the board");
  await shot(board, "08-board-correct");
  await key(host, "Space");
  await until(board, () => window.__G.S.phase === "board");
  ok(await board.$eval(`.jgrid .jcell:nth-child(7)`, (el) => el.classList.contains("used")), "the played clue is gone from the board");

  // ---------------- multiple choice ----------------
  let base = (await state(board)).scores;
  const q2 = await pick("Christmas Movies", 200);
  await key(host, "Space");
  await until(P.Jo, () => !!document.querySelector(".buzz.live"));
  await P.Jo.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(P.Jo, () => document.querySelectorAll(".mcqbtn").length >= 2);
  await shot(P.Jo, "09-phone-mcq");
  const correctIdx = q2.correctIndex;
  const wrongIdx = correctIdx === 0 ? 1 : 0;
  await P.Jo.click(`.mcqbtn[data-i="${wrongIdx}"]`);
  await until(board, () => window.__G.S.clue.stage === "open");
  S = await state(board);
  ok(S.scores.team1 === base.team1 - 200, "wrong multiple-choice auto-scores −$200");
  ok(S.clue.eliminated.includes(wrongIdx), "wrong option is crossed off for the rebound");
  await P.Rick.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(P.Rick, () => document.querySelectorAll(".mcqbtn").length >= 2);
  ok(await P.Rick.isDisabled(`.mcqbtn[data-i="${wrongIdx}"]`), "eliminated choice is disabled on the rebound");
  await P.Rick.click(`.mcqbtn[data-i="${correctIdx}"]`);
  await until(board, () => window.__G.S.clue.stage === "done");
  S = await state(board);
  ok(S.scores.team2 === base.team2 + 200, "correct multiple-choice auto-scores +$200");
  await key(host, "Space");
  await until(board, () => window.__G.S.phase === "board");

  // ---------------- Daily Double ----------------
  const dd = await pick("Christmas Movies", 400); // DD + multiple choice in the template
  await until(board, () => !!document.querySelector(".dd .dd-title"));
  ok(true, "Daily Double splash on the board");
  await sleep(700);
  await shot(board, "10-board-dd");
  ok((await host.textContent(".hint")).includes("Allowed $5 – $500"), "DD limits shown (score below round max)");
  await host.fill("#dd-wager", "9999");
  await key(host, "Tab");
  await host.click('[data-action="dd-lock"]');
  await until(host, () => document.getElementById("toast").classList.contains("show"));
  ok((await host.textContent("#toast")).includes("between $5 and $500"), "over-limit DD wager is rejected");
  await host.locator('.chipbtn', { hasText: "Max" }).click();
  await shot(host, "11-host-dd-wager");
  await key(host, "Space");
  await until(board, () => window.__G.S.clue.stage === "answering");
  ok((await board.textContent(".clue-val")).includes("$500"), "DD wager shown on the clue");
  const ddTeam = (await state(board)).clue.dd.team;
  const ddPlayer = Object.values(P).find((p) => p.team === ddTeam);
  const ddOther = Object.values(P).find((p) => p.team !== ddTeam);
  await until(ddPlayer, () => document.querySelectorAll(".mcqbtn").length >= 2);
  ok((await ddOther.$$(".mcqbtn")).length === 0, "the other team can't answer the Daily Double");
  const before = (await state(board)).scores[ddTeam];
  await ddPlayer.click(`.mcqbtn[data-i="${dd.correctIndex}"]`);
  await until(board, () => window.__G.S.clue.stage === "done");
  ok((await state(board)).scores[ddTeam] === before + 500, "correct Daily Double adds the wager");
  await key(host, "Space");
  await until(board, () => window.__G.S.phase === "board");

  // ---------------- spoken timeout + nobody ----------------
  base = (await state(board)).scores;
  await pick("Holiday Songs", 100);
  await key(host, "Space");
  await until(P.Amy, () => !!document.querySelector(".buzz.live"));
  await P.Amy.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(board, () => window.__G.S.clue.stage === "answering");
  await until(board, () => !!window.__G.S.clue.timeUp, null, 9000);
  ok(true, "spoken answer timer runs out (time's up flagged)");
  ok((await host.textContent(".dock-status")).includes("Time's up"), "host sees 'Time's up — your call'");
  await key(host, "s"); // skip (no penalty) → rebound to team 2
  await until(board, () => window.__G.S.clue.stage === "open");
  ok((await state(board)).scores.team1 === base.team1, "skip has no penalty");
  await key(host, "n");
  await until(board, () => window.__G.S.clue.stage === "done");
  ok((await state(board)).clue.result === "nobody", "Nobody → answer revealed");
  await key(host, "Space");

  // ---------------- buzz window ----------------
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("setSettings", { patch: { buzzWindowSeconds: 3 } }); });
  await until(board, () => window.__G.S.phase === "board");
  await pick("Holiday Songs", 300);
  await key(host, "Space");
  await until(board, () => window.__G.S.clue.stage === "done", null, 7000);
  ok((await state(board)).clue.result === "nobody", "buzz-in window closes the clue when nobody buzzes");
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("setSettings", { patch: { buzzWindowSeconds: 0 } }); });
  await key(host, "Space");

  // ---------------- undo + manual score ----------------
  const s0 = await state(board);
  await key(host, "u");
  await until(board, (n) => window.__G.S.history.length === n - 1, s0.history.length);
  ok(true, "U undoes the last score change");
  await host.click('.podium.team1 .pscore');
  await host.click('.modal .btn.good:has-text("$500")');
  await until(board, (v) => window.__G.S.scores.team1 === v + 500, (await state(board)).scores.team1);
  ok(true, "host adjusts a score from the podium");
  await key(host, "Escape");

  // ---------------- player management ----------------
  await host.click('[data-action="drawer"][data-p*="game"]');
  await host.click('.tab:has-text("Players")');
  const amyId = await P.Amy.evaluate(() => window.__G.deviceId);
  await host.fill(`input[data-change="player-name"][data-id="${amyId}"]`, "Aunt Amy");
  await host.locator(`input[data-change="player-name"][data-id="${amyId}"]`).dispatchEvent("change");
  await until(P.Amy, () => document.querySelector(".me b")?.textContent === "Aunt Amy");
  ok(true, "host renames a player and their phone updates");
  await host.click(`[data-action="player-remove"][data-id="${amyId}"]`);
  await until(P.Amy, () => !!document.querySelector("#jn-name"));
  ok((await P.Amy.textContent(".note")).includes("reset your player"), "removed player goes back to the join screen");
  await P.Amy.fill("#jn-name", "Amy");
  await P.Amy.click(".teambtn.team1");
  await P.Amy.click('[data-action="join"]');
  await P.Amy.waitForSelector(".phone");
  await key(host, "Escape");

  // ---------------- Double Jeopardy ----------------
  console.log("Double Jeopardy");
  await host.click('[data-action="drawer"][data-p*="game"]');
  await host.click('[data-action="confirm"][data-p*="startRound2"]');
  await host.click('[data-action="confirm-yes"]');
  await until(board, () => window.__G.S.round === 2);
  S = await state(board);
  const trailing = S.scores.team1 < S.scores.team2 ? "team1" : "team2";
  ok(S.control === trailing, "trailing team picks first in Double Jeopardy");
  await until(board, () => document.querySelector(".jcell .val")?.textContent === "$200");
  ok((await board.textContent(".roundtag")).includes("Double Jeopardy"), "board shows Double Jeopardy values");
  await sleep(1000);
  await shot(board, "12-board-dj");
  await shot(remote, "13-remote-board");
  // pick a DJ clue from the REMOTE
  const djq = await q("Silver Screen Santas", 200, 2);
  await remote.click(`.r-cell[data-id="${djq.id}"]`);
  await until(board, () => window.__G.S.phase === "clue");
  ok(true, "host can pick clues from the phone remote");
  await remote.locator('.r-buttons .btn', { hasText: "Open buzzers" }).click();
  await until(P.Bea, () => !!document.querySelector(".buzz.live"));
  await P.Bea.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(remote, () => document.querySelector(".r-buttons .btn.good"));
  await remote.locator('.r-buttons .btn.good').click();
  await until(board, () => window.__G.S.clue.stage === "done");
  ok((await state(board)).clue.result === "correct", "host judges from the remote");
  await remote.locator('.r-buttons .btn.primary').click();
  await until(board, () => window.__G.S.phase === "board");

  // ---------------- Final Jeopardy ----------------
  console.log("Final Jeopardy");
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("setScore", { team: "team1", value: 800 }); await D.act("setScore", { team: "team2", value: 1200 }); await D.act("setSettings", { patch: { finalSeconds: 10 } }); });
  await host.click('[data-action="drawer"][data-p*="game"]');
  await host.click('[data-action="confirm"][data-p*="finalStart"]');
  await host.click('[data-action="confirm-yes"]');
  await until(board, () => window.__G.S.phase === "final");
  await until(P.Jo, () => !!document.getElementById("fw-input"));
  await sleep(500);
  await shot(board, "14-board-final-category");
  await P.Jo.fill("#fw-input", "900");
  await P.Jo.click('[data-action="final-wager"]');
  await until(P.Jo, () => document.getElementById("toast").classList.contains("show"));
  ok((await P.Jo.textContent("#toast")).includes("between $0 and $800"), "can't wager more than your score");
  await P.Jo.click('.chipbtn:has-text("All in")');
  await P.Jo.click('[data-action="final-wager"]');
  await until(P.Amy, () => document.querySelector(".locked-note")?.textContent.includes("$800"));
  ok(true, "teammate's phone shows the locked team wager");
  ok(!(await P.Rick.$(".locked-note")) && !/Wager \$/.test(await board.textContent(".final")), "other team and the board can't see the wager");
  await shot(P.Amy, "15-phone-final-wager");
  await P.Rick.fill("#fw-input", "300");
  await P.Rick.click('[data-action="final-wager"]');
  await until(board, () => !!window.__G.S.final.wagers.team2);
  ok(!(await host.textContent(".dock")).includes("$300"), "wager amounts stay hidden on the host screen");
  await until(remote, () => document.querySelector(".secret")?.textContent.includes("$300"));
  ok(true, "remote shows the wagers privately");
  await key(host, "Space");
  await until(board, () => window.__G.S.final.stage === "clue");
  await until(P.Jo, () => !!document.getElementById("fa-input"));
  await P.Jo.fill("#fa-input", "A Visit from St. Nicholas");
  await P.Rick.fill("#fa-input", "The Night Before Christmas");
  await P.Rick.click('[data-action="final-answer"]');
  await until(board, () => window.__G.S.final.answers.team1 && window.__G.S.final.answers.team2);
  ok(true, "answers save from phones (typing auto-saves)");
  await sleep(300);
  await shot(board, "16-board-final-clue");
  await shot(P.Jo, "17-phone-final-answer");
  await until(board, () => window.__G.S.final.stage === "reveal", null, 14000);
  ok(true, "answers lock automatically when the Final timer ends");
  S = await state(board);
  ok(S.final.order[0] === "team1", "reveal order starts with the lowest score");
  await key(host, "Space"); // reveal team1 answer
  await until(board, () => document.querySelector(".rpanel.team1 .rp-ans")?.textContent.includes("Visit"));
  await key(host, "c");
  await until(board, () => window.__G.S.final.results.team1 === "correct");
  await key(host, "Space"); // reveal team2
  await key(host, "w");
  await until(board, () => window.__G.S.final.results.team2 === "wrong");
  S = await state(board);
  ok(S.scores.team1 === 1600 && S.scores.team2 === 900, "Final wagers applied (+$800 / −$300)");
  await shot(board, "18-board-final-reveal");
  await key(host, "Space");
  await until(board, () => window.__G.S.phase === "over");
  ok((await board.textContent(".over-title")).includes("Team 1 wins"), "winner announced");
  await sleep(800);
  await shot(board, "19-board-winner");
  await shot(P.Jo, "20-phone-winner");

  // ---------------- new game ----------------
  await host.click('[data-action="confirm"]');
  await host.click('[data-action="confirm-yes"]');
  await until(board, () => window.__G.S.phase === "lobby" && window.__G.S.scores.team1 === 0);
  await until(board, () => window.__G.Q.every((x) => !x.used));
  ok(true, "New game resets scores and the board, keeps players");
  ok((await state(board)).settings.answerSeconds === 6, "settings survive a new game");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
