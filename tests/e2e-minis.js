// End-to-end test: Husbands vs Wives night with mini games, then Jeopardy.
//
//   node tests/server.js &
//   node tests/e2e-minis.js [shotsDir]
//
// Scenario A: phones + a phone-less player, 4 mini games of every kind, rename a team,
//             carry points into Jeopardy, a bonus mini game mid-Jeopardy, Final, new game.
// Scenario B: nobody has a phone — the host runs everything.
// Scenario C: an older saved game is upgraded in place (nothing lost).
const { chromium } = require("playwright");
const path = require("path");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
const TEMPLATE = path.resolve(__dirname, "..", "christmas-jeopardy-template.xlsx");

let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name}${JSON.stringify(a) === JSON.stringify(b) ? "" : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__G.S)));
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }
async function until(page, fn, arg, timeout = 8000) {
  try {
    const r = await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    // The app repaints on the next animation frame — wait for it so DOM reads are never stale.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    return r;
  }
  catch (e) {
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 500)).catch(() => "");
    const S = await page.evaluate(() => window.__G && window.__G.S && { phase: window.__G.S.phase, minis: window.__G.S.minis && { current: window.__G.S.minis.current, back: window.__G.S.minis.back } }).catch(() => null);
    throw new Error(`[${page.name}] waited for: ${fn.toString().slice(0, 160)}\n  state=${JSON.stringify(S)}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, viewport) {
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
    // Ignored: 409 = a losing transaction attempt; a missing .mp3 = optional sound file not uploaded.
    page.on("console", (m) => {
      const url = (m.location() || {}).url || "";
      if (m.type() === "error" && !/favicon|409/.test(m.text()) && !url.endsWith(".mp3")) errors.push(`[${name}] ${m.text()}`);
    });
    page.name = name;
    return page;
  }
  async function hostLogin(page, hash) {
    await page.goto(URL + hash);
    await page.fill("#gate-code", "2325");
    await page.press("#gate-code", "Enter");
  }
  const key = async (page, k) => { await page.keyboard.press(k); await sleep(140); };
  const setField = async (page, sel, value) => { await page.fill(sel, String(value)); await page.locator(sel).dispatchEvent("change"); };
  const openDrawer = async (page, tab) => {
    if (!(await page.$(".drawer.open"))) await page.click('.r-tools [data-action="drawer"]');
    await page.click(`.tab:has-text("${tab}")`);
  };
  const dockText = (page) => page.textContent(".r-status");
  const waitDock = (page, text) => until(page, (t) => (document.querySelector(".r-status") || {}).textContent?.includes(t), text);
  const minis = async (page) => (await state(page)).minis.list;
  const mini = async (page, name) => (await minis(page)).find((g) => g.name === name);
  const toastSays = async (page, text) => { await until(page, (t) => { const el = document.getElementById("toast"); return el.classList.contains("show") && el.textContent.includes(t); }, text); return true; };

  // =====================================================================
  console.log("Scenario A — phones, 4 mini games, then Jeopardy");
  // =====================================================================
  await fetch(URL + "__fs/reset", { method: "POST" });
  const host = await device("host", { width: 1440, height: 900 });
  await hostLogin(host, "#/admin");
  await host.waitForSelector(".remote");
  const board = await device("board", { width: 1920, height: 1080 });
  // Record what the big screen says out loud instead of actually speaking.
  await board.addInitScript(() => {
    window.__said = [];
    const fake = { speak: (u) => window.__said.push(u.text), cancel() {} };
    try { Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true }); } catch (e) { window.speechSynthesis = fake; }
    if (!window.SpeechSynthesisUtterance) window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  await board.click(".stage", { position: { x: 5, y: 5 } }); // any tap lets the browser make sound (sound is on by default)
  await new Promise((r) => setTimeout(r, 400));
  await board.evaluate(() => { window.__said.length = 0; }); // ignore the silent "unlock" utterance

  const remote = await device("remote", { width: 390, height: 844 });
  await hostLogin(remote, "#/remote");
  await remote.waitForSelector(".remote");

  eq(await board.$$eval(".roster-head span:first-child", (els) => els.map((e) => e.textContent)), ["Husbands", "Wives"], "default teams are Husbands and Wives on the big screen");

  const P = {};
  for (const [n, t] of [["Jake", "team1"], ["Tom", "team1"], ["Sarah", "team2"], ["Emma", "team2"]]) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.waitForSelector("#jn-name");
    if (n === "Jake") {
      eq(await p.$$eval(".teambtn .tb-name", (els) => els.map((e) => e.textContent)), ["Husbands", "Wives"], "join screen offers Husbands / Wives");
      await shot(p, "m01-join");
    }
    await p.fill("#jn-name", n + " Mistle");
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    p.team = t;
    P[n] = p;
  }
  P.Jake.pid = await P.Jake.evaluate(() => window.__G.deviceId);

  // ---- a team renames itself from a phone ----
  await P.Sarah.click('[data-action="team-rename"]');
  await P.Sarah.waitForSelector("#team-name-input");
  await shot(P.Sarah, "m02-phone-rename");
  await P.Sarah.fill("#team-name-input", "husbands");
  await P.Sarah.click('[data-action="team-rename-save"]');
  ok(await toastSays(P.Sarah, "already has that name"), "a team can't steal the other team's name");
  await P.Sarah.fill("#team-name-input", "Mrs. Clauses");
  await P.Sarah.press("#team-name-input", "Enter");
  await until(board, () => [...document.querySelectorAll(".roster-head span:first-child")].some((e) => e.textContent === "Mrs. Clauses"));
  ok(true, "a wife renames the team from her phone → the big screen updates");
  ok(await toastSays(P.Emma, "Mrs. Clauses"), "her teammate gets a heads-up about the new name");
  await until(P.Jake, () => !document.body.innerText.includes("Wives") || true);
  await openDrawer(host, "Game");
  await host.uncheck('input[data-change="setting-bool"][data-key="playersRename"]');
  await until(P.Jake, () => !document.querySelector('[data-action="team-rename"]'));
  ok(true, "host can lock team names (rename button disappears)");
  await host.check('input[data-change="setting-bool"][data-key="playersRename"]');
  await until(P.Jake, () => !!document.querySelector('[data-action="team-rename"]'));

  // ---- add someone without a phone ----
  await host.click('.tab:has-text("Players")');
  await host.fill("#add-player-team1", "Grandpa Mistle");
  await host.press("#add-player-team1", "Enter");
  await until(board, () => [...document.querySelectorAll(".roster.team1 .chip")].some((e) => e.textContent === "Grandpa Mistle"));
  ok(true, "host adds a player who has no phone (3 husbands vs 2 wives)");

  // ---- couples: 1a plays 1b ----
  const pid = (n) => host.evaluate((x) => window.__G.P.find((p) => p.name.startsWith(x)).id, n);
  const setPair = async (name, n) => {
    const id = await pid(name);
    await host.fill(`.pairf input[data-id="${id}"]`, String(n));
    await host.dispatchEvent(`.pairf input[data-id="${id}"]`, "change");
  };
  await setPair("Jake", 1);
  await until(host, () => document.body.innerText.includes("Nobody is 1b yet"));
  ok(true, "half a couple is flagged until their other half has the same number");
  await setPair("Sarah", 1);
  await setPair("Tom", 2);
  await setPair("Emma", 2);
  await until(host, () => window.__G.P.filter((p) => p.pair).length === 4);
  eq((await host.$$eval(".pairf .ptag", (els) => els.map((e) => e.textContent))).filter((t) => t !== "pair").sort(), ["1a", "1b", "2a", "2b"], "couples are numbered 1a / 1b, 2a / 2b");
  ok((await host.textContent(".sect")).includes("2 couples"), "the Players tab counts the couples");
  await shot(host, "m05b-settings-couples");

  // ---- questions ----
  await host.click('.tab:has-text("Questions")');
  await host.setInputFiles('input[data-change="import"]', TEMPLATE);
  await until(host, () => (document.querySelector(".import-msg") || {}).textContent?.includes("Imported"));

  // ---- set up the mini games ----
  await host.click('.tab:has-text("Mini games")');
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  ok(await toastSays(host, "Type a name"), "adding a game without a name asks for one");
  await host.fill("#mini-new-name", "Snowball Toss");
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  await until(host, () => window.__G.S.minis.list.length === 1);
  let g = await mini(host, "Snowball Toss");
  await setField(host, `[data-id="${g.id}"][data-f="points"]`, 300);
  // played against the clock
  ok(!(await host.$(`.minicard[data-key="mini-${g.id}"] .pts.secs`)), "no seconds box until the timer is ticked");
  await host.check(`input[data-change="mini-timed"][data-id="${g.id}"]`);
  await until(host, () => window.__G.S.minis.list[0].timed === true);
  await setField(host, `[data-id="${g.id}"][data-f="seconds"]`, 6);
  await until(host, () => window.__G.S.minis.list[0].seconds === 6);
  ok((await host.textContent(`.minicard[data-key="mini-${g.id}"] .timerrow`)).includes("0:06"), "⏱ Timer: 6 seconds on the clock");
  await host.click('.ideas .chipbtn:has-text("Speed Wrap")');
  await until(host, () => window.__G.S.minis.list.length === 2);
  await host.fill("#mini-new-name", "Cookie Stack");
  await host.click('[data-action="mini-add"][data-type="best"]');
  await until(host, () => window.__G.S.minis.list.length === 3);
  g = await mini(host, "Cookie Stack");
  await setField(host, `[data-id="${g.id}"][data-f="unit"]`, "cookies");
  await host.fill("#mini-new-name", "Tug of War");
  await host.press("#mini-new-name", "Enter"); // Enter adds a head-to-head game
  await until(host, () => window.__G.S.minis.list.length === 4);
  g = await mini(host, "Tug of War");
  await host.selectOption(`[data-id="${g.id}"][data-f="award"]`, "match");
  await setField(host, `[data-id="${g.id}"][data-f="points"]`, 100);
  await host.fill("#mini-new-name", "Oops");
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  await until(host, () => window.__G.S.minis.list.length === 5);
  await host.click(`[data-action="mini-remove"][data-id="${(await mini(host, "Oops")).id}"]`);
  await until(host, () => window.__G.S.minis.list.length === 4);
  const tug = await mini(host, "Tug of War");
  for (let i = 0; i < 2; i++) { await host.click(`.minicard[data-key="mini-${tug.id}"] button[title="Move up"]`); await sleep(150); }
  await until(host, () => window.__G.S.minis.list.map((x) => x.name).join() === "Snowball Toss,Tug of War,Speed Wrap,Cookie Stack");
  const list0 = await minis(host);
  eq(list0.map((x) => [x.name, x.type, x.points, x.award, x.better, x.unit]),
    [["Snowball Toss", "h2h", 300, "game", "high", ""], ["Tug of War", "h2h", 100, "match", "high", ""], ["Speed Wrap", "best", 500, "game", "low", "seconds"], ["Cookie Stack", "best", 500, "game", "high", "cookies"]],
    "4 mini games set up: typed, preset, edited, reordered, one deleted");
  await shot(host, "m03-host-setup");
  await key(host, "Escape");
  ok((await dockText(host)).includes("4 mini games ready"), "lobby checklist shows the mini games");
  ok((await host.textContent(".r-buttons .btn.primary")).includes("Start the mini games"), "the gold button now starts the mini games");
  await shot(host, "m04-host-lobby");

  // ---- game 1: head-to-head, winner takes all ----
  await key(host, "Space");
  await until(board, () => document.querySelectorAll(".mcard").length === 4);
  ok((await board.textContent(".mc-status.next")).includes("Up next"), "big screen lists the games with 'Up next'");
  await until(P.Emma, () => document.querySelectorAll(".ph-mrow").length === 4);
  ok(true, "phones list the mini games too");
  await sleep(400);
  await shot(board, "m05-board-hub");
  await shot(P.Emma, "m06-phone-hub");
  await key(host, "Space"); // Play "Snowball Toss"
  await until(board, () => (document.querySelector(".mg-title") || {}).textContent === "Snowball Toss");
  await shot(board, "m07-board-h2h-wait");
  await key(host, "Space"); // Who's up first?
  await until(board, () => document.querySelectorAll(".versus .spin.spinning").length === 2, null, 3000);
  ok(true, "names shuffle on the big screen");
  await waitDock(host, "who won?");
  ok(true, "the host's private screen shows who was drawn");
  await until(board, () => document.querySelectorAll(".versus .spin.landed").length === 2, null, 4000);
  let S = await state(host);
  let m = S.minis.list[0].matches[0];
  const first = (x) => x.name.split(" ")[0];
  ok(m.p1 && m.p2 && ["Jake", "Tom", "Grandpa"].includes(first(m.p1)) && ["Sarah", "Emma"].includes(first(m.p2)), `random draw: ${m.p1.name} vs ${m.p2.name}`);
  const mate = { Jake: "Sarah", Sarah: "Jake", Tom: "Emma", Emma: "Tom" };
  ok(!mate[first(m.p1)] || mate[first(m.p1)] === first(m.p2), `a couple is drawn together: ${m.p1.name} vs ${m.p2.name}`);
  eq(await board.$$eval(".versus .spin", (els) => els.map((e) => e.textContent)), [m.p1.name, m.p2.name], "the big screen lands on the drawn names");
  ok((await board.$$(".versus .spin.landed")).length === 2, "…with the landing animation");
  await until(board, () => window.__said.length === 1);
  eq(await board.evaluate(() => window.__said[0]), `Up next: ${m.p1.name}, versus, ${m.p2.name}!`, "the big screen SAYS who's up next out loud");
  const wife1 = P[first(m.p2)];
  await until(wife1, () => !!document.querySelector(".youup.big"));
  ok((await wife1.textContent(".youup")).includes("You're up") && (await wife1.textContent(".youup")).includes(m.p1.name), "the drawn wife's phone says You're up vs her opponent");
  const otherWife = first(m.p2) === "Sarah" ? P.Emma : P.Sarah;
  // ---- the game clock: Jaren starts it, every screen runs off it, horn at zero ----
  ok((await host.textContent(".r-buttons")).includes("Start the timer"), "a timed game gets ⏱ Start the timer in the controls");
  await host.locator('.r-buttons .btn:has-text("Start the timer")').click();
  await until(board, () => !!document.querySelector(".gclock .cd"));
  await until(P.Jake, () => !!document.querySelector(".gclock .cd"));
  ok(true, "the countdown shows on the big screen and on every phone");
  const ends = await Promise.all([board, P.Jake, P.Emma].map((p) => p.evaluate(() => window.__G.S.minis.list[0].clock.endsAt)));
  ok(ends[0] === ends[1] && ends[1] === ends[2], "every screen counts down to the same moment — all tables share one clock");
  ok(/^\d:\d\d$/.test((await board.textContent(".gclock .cd")).trim()), "…shown as minutes:seconds");
  await sleep(400);
  await shot(board, "m07b-board-timer");
  await board.waitForFunction(() => (window.__G.S.sfx || {}).sound === "horn", null, { timeout: 15000 });
  ok(true, "the horn is cued for every screen when the clock runs out");
  const hornAt = await board.evaluate(() => window.__G.S.sfx.at - window.__G.S.minis.list[0].clock.endsAt);
  ok(hornAt <= 0 && hornAt > -1500, `the horn is cued to land on zero (${hornAt} ms, played after the shared-sound lead)`);
  for (const p of [board, P.Jake, P.Emma]) await until(p, () => (document.querySelector(".gclock") || {}).textContent?.includes("TIME'S UP"));
  ok(true, "…and every screen says TIME'S UP");
  await shot(board, "m07c-board-times-up");
  await shot(P.Jake, "m07d-phone-times-up");
  ok((await host.textContent(".r-buttons")).includes("Restart the timer"), "the host can put the clock back on for the next pair");
  ok((await otherWife.textContent(".ph-versus")).includes(m.p1.name), "everyone else sees who's facing off");
  await sleep(300);
  await shot(board, "m08-board-h2h-versus");
  await shot(wife1, "m09-phone-youre-up");
  await shot(host, "m10-host-h2h");
  const firstHusband = m.p1.id;
  await key(host, "1");
  await until(board, () => document.querySelector(".tally .team1 b")?.textContent === "1");
  eq((await state(host)).scores, { team1: 0, team2: 0 }, "winner-takes-all game: no points yet");

  await key(host, "Space"); // next matchup
  await waitDock(host, "who won?");
  S = await state(host);
  m = S.minis.list[0].matches[1];
  ok(m.p1.id !== firstHusband, "next matchup draws a different husband (no repeats)");
  const beforeRepick = m.p2.id;
  await host.click('.mside.team2 button[title="Draw a different player"]');
  await until(host, (id) => { const mm = window.__G.S.minis.list[0].matches[1]; return mm.p2.id !== id; }, beforeRepick);
  ok(true, "🎲 re-draws just the wife");
  const emmaId = await P.Emma.evaluate(() => window.__G.deviceId);
  await sleep(1900);
  await host.selectOption(".mside.team2 select", emmaId);
  await until(host, (id) => window.__G.S.minis.list[0].matches[1].p2.id === id, emmaId);
  await until(board, () => document.querySelector(".versus .vs-side.team2 .spin")?.textContent === "Emma Mistle");
  ok(true, "host hand-picks a player from the list instead");
  await until(P.Emma, () => !!document.querySelector(".youup.big"));
  await host.evaluate(() => document.activeElement && document.activeElement.blur());
  await key(host, "2");
  await until(board, () => document.querySelector(".tally .team2 b")?.textContent === "1");
  await key(host, "Space");
  await waitDock(host, "who won?");
  await key(host, "t");
  await until(host, () => window.__G.S.minis.list[0].matches.filter((x) => x.winner).length === 3);
  ok((await board.textContent(".mhistory")).includes("1 tied"), "ties are tracked");
  const tieId = (await state(host)).minis.list[0].matches[2].id;
  await host.click(`.echip:has-text("🤝") .x`);
  await until(host, (id) => !window.__G.S.minis.list[0].matches.some((x) => x.id === id), tieId);
  ok(true, "a mistaken result can be removed");
  await shot(host, "m11-host-h2h-results");

  await host.click('.r-buttons .btn:has-text("Finish game")');
  await host.waitForSelector(".finish-opts");
  ok((await host.textContent(".modal")).includes("Husbands 1 – 1 Mrs. Clauses"), "finish dialog shows the tally");
  ok((await host.textContent(".finish-opts .btn.suggested")).includes("Tie"), "…and suggests the result (tied 1–1)");
  await sleep(350);
  await shot(host, "m12-host-finish-dialog");
  await host.click('.finish-opts .btn.t1');
  await until(board, () => !!document.querySelector(".mresult"));
  ok((await board.textContent(".mr-title")).includes("Husbands win!"), "host overrules → big screen: Husbands win!");
  eq((await state(host)).scores, { team1: 300, team2: 0 }, "+$300 to the Husbands");
  await sleep(400);
  await shot(board, "m13-board-result");
  await key(host, "u");
  await until(host, () => window.__G.S.scores.team1 === 0 && window.__G.S.minis.list[0].status === "active");
  ok(true, "Undo takes the points back and re-opens the game");
  await host.click('.r-buttons .btn:has-text("Finish game")');
  await host.click('.finish-opts .btn:has-text("Tie")');
  await until(host, () => window.__G.S.minis.list[0].status === "done");
  eq((await state(host)).scores, { team1: 150, team2: 150 }, "tie splits the points: +$150 each");
  await until(P.Tom, () => document.body.innerText.includes("It's a tie"));
  ok(true, "phones show the result");
  await key(host, "Space"); // back to the list
  await until(board, () => document.querySelectorAll(".mcard").length === 4);
  ok((await board.textContent(".mcard.done .mc-status")).includes("Tie"), "the list shows who won each game");

  // ---- game 2: head-to-head, points per matchup — run entirely from the phone remote ----
  await until(remote, () => document.querySelectorAll(".r-mini").length === 4);
  await shot(remote, "m14-remote-hub");
  await remote.click('.r-mini:has-text("Tug of War")');
  await until(board, () => (document.querySelector(".mg-title") || {}).textContent === "Tug of War");
  ok((await board.textContent(".mg-kicker")).includes("$100 per matchup win"), "big screen explains points per matchup");
  let before = (await state(host)).scores;
  for (const side of ["t1", "t2", "t2"]) {
    await remote.click('.r-buttons .btn.primary');
    await until(remote, () => !!document.querySelector(".r-buttons .btn.t1"), null, 6000);
    if (side === "t1") await shot(remote, "m15-remote-h2h");
    await remote.click(`.r-buttons .btn.${side}`);
    await until(remote, () => !document.querySelector(".r-buttons .btn.t1"));
  }
  S = await state(host);
  eq(S.scores, { team1: before.team1 + 100, team2: before.team2 + 200 }, "points land after every matchup (+100, +200)");
  const tugMatches = S.minis.list[1].matches;
  eq(new Set(tugMatches.map((x) => x.p2.id)).size, 2, "2 wives over 3 matchups: both play before one repeats");
  eq(new Set(tugMatches.map((x) => x.p1.id)).size, 3, "3 husbands over 3 matchups: all different");
  await remote.click('.r-buttons .btn:has-text("Finish game")');
  await remote.waitForSelector(".modal");
  ok((await remote.textContent(".modal")).includes("already given"), "finish dialog explains points were already given");
  await remote.click('.modal .btn.primary');
  await until(board, () => !!document.querySelector(".mresult"));
  ok((await board.textContent(".mr-title")).includes("Mrs. Clauses win!"), "result uses the team's custom name with the right grammar");
  eq((await state(host)).scores, { team1: before.team1 + 100, team2: before.team2 + 200 }, "no extra points at the end of a per-matchup game");
  await remote.click('.r-buttons .btn.primary'); // back to the list

  // ---- game 3: best overall, fastest time wins ----
  await until(host, () => !window.__G.S.minis.current);
  const saidBefore = await board.evaluate(() => window.__said.length);
  ok(saidBefore >= 3, `random draws are announced (${saidBefore} so far)`);
  await openDrawer(host, "Game");
  await host.uncheck('input[data-change="setting-bool"][data-key="announce"]');
  await until(host, () => window.__G.S.settings.announce === false);
  await key(host, "Escape");
  await key(host, "Space"); // Play "Speed Wrap"
  await until(board, () => (document.querySelector(".mg-title") || {}).textContent === "Speed Wrap");
  await key(host, "Space"); // who's up first
  await until(board, () => !!document.querySelector(".upnext .spin.spinning"), null, 3000);
  await waitDock(host, "is up");
  await until(board, () => !!document.querySelector(".upnext .spin.landed"), null, 4000);
  S = await state(host);
  const t1 = S.minis.list[2].turn;
  eq(await board.textContent(".upnext .spin"), t1.name, "big screen shows who's up");
  await sleep(300);
  eq(await board.evaluate(() => window.__said.length), saidBefore, "with the announcer switched off in settings, the screen stays quiet");
  await until(host, () => document.activeElement && document.activeElement.id === "mini-score");
  ok(true, "the score box is ready to type in");
  await host.keyboard.type("42.5");
  await host.keyboard.press("Enter");
  await until(board, () => document.querySelectorAll(".lb-row").length === 1);
  ok((await board.textContent(".lb-row")).includes("42.5 seconds"), "score appears on the leaderboard with its unit");
  await host.evaluate(() => document.activeElement && document.activeElement.blur());
  await key(host, "Space");
  await waitDock(host, "is up");
  S = await state(host);
  const t2 = S.minis.list[2].turn;
  ok(t2.team !== t1.team, "turns alternate between the teams");
  await host.evaluate(() => document.activeElement && document.activeElement.blur());
  await host.click('.r-buttons .btn:has-text("Save score")');
  ok(await toastSays(host, "Type their score"), "saving without a score asks for one");
  await host.fill("#mini-score", "38");
  await host.press("#mini-score", "Enter");
  await until(board, () => document.querySelectorAll(".lb-row").length === 2);
  eq(await board.$$eval(".lb-row .lb-score", (els) => els.map((e) => e.textContent)), ["38 seconds", "42.5 seconds"], "fastest time is on top");
  await sleep(300);
  await shot(board, "m16-board-best");
  await host.evaluate(() => document.activeElement && document.activeElement.blur());
  await key(host, "Space");
  await waitDock(host, "is up");
  const t3 = (await state(host)).minis.list[2].turn;
  await shot(host, "m17-host-best-turn");
  await host.click('.mpanel button:has-text("Someone else")');
  await until(host, (id) => window.__G.S.minis.list[2].turn.id !== id, t3.id);
  const t3b = (await state(host)).minis.list[2].turn;
  ok(t3b.pid !== t3.pid && t3b.team === t3.team, "'Someone else' swaps in a teammate");
  await host.selectOption(".mpanel select", { label: "Grandpa Mistle — Husbands" });
  await until(host, () => window.__G.S.minis.list[2].turn.name.startsWith("Grandpa"));
  ok(true, "host hand-picks the phone-less player");
  await host.fill("#mini-score", "55");
  await host.press("#mini-score", "Enter");
  await until(host, () => window.__G.S.minis.list[2].entries.length === 3);
  await host.click('.echip:has-text("55 seconds") .x');
  await until(host, () => window.__G.S.minis.list[2].entries.length === 2);
  ok(true, "a mistyped score can be removed");
  const withScore = P[t1.name] || P[t2.name];
  if (withScore) ok((await withScore.textContent(".locked-note")).includes("Your score"), "players see their own score on their phone");
  const fastest = t2;
  before = (await state(host)).scores;
  await host.click('.r-buttons .btn:has-text("Finish game")');
  ok((await host.textContent(".modal")).includes(fastest.name), "finish dialog names the best score");
  await host.click(".finish-opts .btn.suggested");
  await until(host, () => window.__G.S.minis.list[2].status === "done");
  S = await state(host);
  eq(S.scores[fastest.team] - before[fastest.team], 500, "the fastest player's team gets +$500");
  await key(host, "Space");

  // ---- game 4: the host just declares the winner ----
  await until(host, () => !window.__G.S.minis.current);
  await key(host, "Space"); // Play "Cookie Stack"
  await until(board, () => (document.querySelector(".mg-title") || {}).textContent === "Cookie Stack");
  before = (await state(host)).scores;
  await host.click('.r-buttons .btn:has-text("Finish game")');
  ok((await host.textContent(".modal")).includes("just pick who won"), "no scores tracked → just pick who won");
  await host.click(".finish-opts .btn.t2");
  await until(host, () => window.__G.S.minis.list[3].status === "done");
  eq((await state(host)).scores.team2 - before.team2, 500, "+$500 to the declared winners");
  await key(host, "Space");

  // ---- on to Jeopardy with the points carried over ----
  await waitDock(host, "All the mini games are done");
  ok((await host.textContent(".r-buttons .btn.primary")).includes("Start Jeopardy"), "when the games are done the gold button starts Jeopardy");
  await shot(host, "m18-host-all-done");
  await sleep(300);
  await shot(board, "m19-board-hub-done");
  const carried = (await state(host)).scores;
  await host.click('[data-action="first-pick"][data-v="team2"]');
  await key(host, "Space");
  await until(board, () => document.querySelectorAll(".jcell .val").length === 30);
  S = await state(host);
  eq([S.phase, S.scores, S.control], ["board", carried, "team2"], "Jeopardy starts with the mini-game points on the scoreboard");
  ok((await board.textContent(".ctrl")).includes("Mrs. Clauses pick next"), "custom team name picks first");
  await sleep(1100);
  await shot(board, "m20-board-jeopardy-carried");
  await P.Sarah.waitForSelector(".ph-card");
  ok(!(await P.Sarah.$('[data-action="team-rename"]')), "team names lock once Jeopardy starts");

  // one clue
  const q = await host.evaluate(() => window.__G.Q.find((x) => x.category === "Christmas Movies" && x.points === 100 && x.round === 1));
  await host.click(`.r-cell[data-id="${q.id}"]`);
  await until(host, (id) => window.__G.S.clue && window.__G.S.clue.id === id, q.id);
  await key(host, "Space");
  await until(P.Jake, () => !!document.querySelector(".buzz.live"));
  await P.Jake.dispatchEvent('[data-action="buzz"]', "pointerdown");
  await until(host, () => window.__G.S.clue.stage === "answering");
  await key(host, "c");
  await until(host, () => window.__G.S.clue.stage === "done");
  await key(host, "Space");
  await until(host, () => window.__G.S.phase === "board");
  eq((await state(host)).scores.team1, carried.team1 + 100, "Jeopardy points add on top");

  // ---- a bonus mini game in the middle of Jeopardy ----
  await openDrawer(host, "Game");
  await host.click('.drawer [data-p*="minisStart"]');
  await until(host, () => window.__G.S.phase === "minis");
  ok(!(await host.$(".drawer.open")), "settings close when jumping to mini games");
  ok((await host.textContent(".r-buttons .btn.primary")).includes("Back to Jeopardy"), "mid-game: the gold button goes back to Jeopardy");
  await host.click('.r-buttons .btn:has-text("Edit mini games")');
  await host.fill("#mini-new-name", "Bonus Round");
  await host.click('[data-action="mini-add"][data-type="h2h"]');
  await until(host, () => window.__G.S.minis.list.length === 5);
  const bonus = await mini(host, "Bonus Round");
  await host.click(`.minicard[data-key="mini-${bonus.id}"] button:has-text("Play")`);
  await until(board, () => (document.querySelector(".mg-title") || {}).textContent === "Bonus Round");
  ok(!(await host.$(".drawer.open")), "▶ Play in settings jumps straight into the game");
  before = (await state(host)).scores;
  await key(host, "Space");
  await waitDock(host, "who won?");
  await key(host, "1");
  await until(host, () => window.__G.S.minis.list[4].matches.filter((x) => x.winner).length === 1);
  await host.click('.r-buttons .btn:has-text("Finish game")');
  await host.click(".finish-opts .btn.suggested");
  await until(host, () => window.__G.S.minis.list[4].status === "done");
  await key(host, "Space"); // back to list
  await until(host, () => !window.__G.S.minis.current);
  await key(host, "Space"); // back to Jeopardy
  await until(host, () => window.__G.S.phase === "board");
  S = await state(host);
  eq([S.round, S.control, S.scores.team1 - before.team1, await host.evaluate((id) => window.__G.Q.find((x) => x.id === id).used, q.id)],
    [1, "team1", 500, true], "back on the same Jeopardy board: round, control and used clues intact, bonus points added");
  await until(board, () => document.querySelectorAll(".jcell .val").length === 29);

  // ---- Final Jeopardy and the winner ----
  await openDrawer(host, "Game");
  await host.click('[data-action="confirm"][data-p*="finalStart"]');
  await host.click('[data-action="confirm-yes"]');
  await until(host, () => window.__G.S.phase === "final");
  await host.fill("#fw-team1", "100");
  await host.click('[data-action="final-host-wager"][data-team="team1"]');
  await until(host, () => !!window.__G.S.final.wagers.team1);
  await key(host, "Space");
  await until(host, () => window.__G.S.final.stage === "clue");
  await host.click('.r-buttons .btn:has-text("Lock answers now")');
  await until(host, () => window.__G.S.final.stage === "reveal");
  for (let i = 0; i < 2; i++) { await key(host, "Space"); await key(host, "c"); await sleep(200); }
  await until(host, () => window.__G.S.final.results.team1 && window.__G.S.final.results.team2);
  await key(host, "Space");
  await until(board, () => !!document.querySelector(".over-title"));
  S = await state(host);
  const champ = S.scores.team1 > S.scores.team2 ? "Husbands win!" : "Mrs. Clauses win!";
  ok((await board.textContent(".over-title")).includes(champ), `winner screen: “${champ}”`);
  ok((await host.textContent(".r-status")).includes(champ), "host dock agrees");

  // ---- new game keeps the setup ----
  await host.click('.r-buttons [data-action="confirm"]');
  await host.click('[data-action="confirm-yes"]');
  await until(host, () => window.__G.S.phase === "lobby" && window.__G.S.scores.team1 === 0);
  S = await state(host);
  eq([S.minis.list.map((x) => x.status), S.teamNames.team2, S.minis.list.length],
    [["pending", "pending", "pending", "pending", "pending"], "Mrs. Clauses", 5], "new game: mini games reset but kept, team name kept");
  ok((await host.textContent(".r-buttons .btn.primary")).includes("Start the mini games"), "ready to go again");

  // =====================================================================
  console.log("Scenario B — nobody has a phone");
  // =====================================================================
  await fetch(URL + "__fs/reset", { method: "POST" });
  const solo = await device("solo-host", { width: 1280, height: 720 });
  await hostLogin(solo, "#/admin");
  await solo.waitForSelector(".remote");
  await until(solo, () => window.__G.S && window.__G.S.phase === "lobby" && window.__G.S.minis);
  ok((await solo.textContent(".r-buttons")).includes("Add mini games"), "empty lobby offers to add mini games");
  await solo.click('.r-buttons .btn:has-text("Add mini games")');
  await solo.waitForSelector(".drawer.open #mini-new-name");
  await solo.click('.ideas .chipbtn:has-text("Candy Cane Hook")');
  await solo.click('.ideas .chipbtn:has-text("Present Stack")');
  await until(solo, () => window.__G.S.minis.list.length === 2);
  await key(solo, "Escape");
  await key(solo, "Space"); // start mini games
  await until(solo, () => window.__G.S.phase === "minis");
  await key(solo, "Space"); // play Candy Cane Hook
  await until(solo, () => !!window.__G.S.minis.current);
  await key(solo, "Space"); // who's up — nobody has joined
  await waitDock(solo, "who won?");
  ok((await solo.textContent(".r-status")).includes("Husbands") && (await solo.textContent(".r-status")).includes("Wives"), "no players: a round is simply Husbands vs Wives");
  ok((await solo.textContent(".mpanel")).includes("just pick the winner"), "the dock explains there are no names to draw");
  await shot(solo, "m21-solo-h2h-no-names");
  await key(solo, "2");
  await until(solo, () => window.__G.S.minis.list[0].matches.filter((x) => x.winner).length === 1);
  // add people by hand, mid-game
  await openDrawer(solo, "Players");
  for (const [team, name] of [["team1", "Bob Pine"], ["team1", "Al Pine"], ["team2", "Sue Pine"]]) {
    await solo.fill(`#add-player-${team}`, name);
    await solo.click(`[data-action="player-add"][data-team="${team}"]`);
  }
  await until(solo, () => window.__G.P.length === 3);
  await key(solo, "Escape");
  await key(solo, "Space");
  await waitDock(solo, "who won?");
  S = await state(solo);
  m = S.minis.list[0].matches[1];
  ok(["Bob Pine", "Al Pine"].includes(m.p1.name) && m.p2.name === "Sue Pine", `hand-added players are drawn: ${m.p1.name} vs ${m.p2.name}`);
  await key(solo, "2");
  await sleep(200);
  await solo.click('.r-buttons .btn:has-text("Finish game")');
  ok((await solo.textContent(".finish-opts .btn.suggested")).includes("Wives"), "Wives lead 2–0 → suggested winner");
  await solo.click(".finish-opts .btn.suggested");
  await until(solo, () => window.__G.S.minis.list[0].status === "done");
  eq((await state(solo)).scores, { team1: 0, team2: 500 }, "Wives +$500");
  await key(solo, "Space");
  await until(solo, () => !window.__G.S.minis.current);
  await key(solo, "Space"); // play Present Stack (best overall, highest wins)
  await until(solo, () => window.__G.S.minis.current);
  const seen = [];
  for (const sc of [4, 9, 7]) {
    await solo.evaluate(() => document.activeElement && document.activeElement.blur());
    await key(solo, "Space");
    await waitDock(solo, "is up");
    seen.push((await state(solo)).minis.list[1].turn.name);
    await solo.fill("#mini-score", String(sc));
    await solo.press("#mini-score", "Enter");
    await until(solo, (n) => window.__G.S.minis.list[1].entries.length === n, seen.length);
  }
  eq(seen.map((n) => n.split(" ")[0]).sort(), ["Al", "Bob", "Sue"], "everyone gets exactly one turn (uneven teams)");
  await waitDock(solo, "Everyone's had a turn");
  ok((await solo.textContent(".r-buttons .btn.primary")).includes("Finish game"), "after everyone's turn the gold button becomes Finish");
  await shot(solo, "m22-solo-best-everyone");
  await solo.evaluate(() => document.activeElement && document.activeElement.blur());
  await key(solo, "Space"); // opens the finish dialog
  await solo.waitForSelector(".finish-opts");
  const winner9 = seen[1];
  ok((await solo.textContent(".modal")).includes(winner9), "dialog names the top scorer");
  await solo.click(".finish-opts .btn.suggested");
  await until(solo, () => window.__G.S.minis.list[1].status === "done");
  await key(solo, "Space");
  await waitDock(solo, "All the mini games are done");
  ok((await solo.textContent(".r-buttons")).includes("Load Jeopardy questions"), "no questions yet → the dock offers to load them instead of failing");
  await solo.click('.r-buttons .btn:has-text("Load Jeopardy questions")');
  await solo.setInputFiles('input[data-change="import"]', TEMPLATE);
  await until(solo, () => window.__G.Q.length > 0);
  await key(solo, "Escape");
  await until(solo, () => (document.querySelector(".r-buttons .btn.primary") || {}).textContent?.includes("Start Jeopardy"));
  await key(solo, "Space");
  await until(solo, () => window.__G.S.phase === "board");
  ok(true, "host-only night flows from mini games into Jeopardy");
  await shot(solo, "m23-solo-board-720p");

  // =====================================================================
  console.log("Scenario C — an older saved game is upgraded, not wiped");
  // =====================================================================
  await fetch(URL + "__fs/reset", { method: "POST" });
  const oldState = {
    v: 2, gameId: "old", phase: "board", round: 1, control: "team1",
    teamNames: { team1: "Team 1", team2: "The Elves" }, scores: { team1: 700, team2: 400 },
    settings: { answerSeconds: 20, buzzWindowSeconds: 0, readSeconds: 0, finalSeconds: 45, autoRebound: true, finalNeedsPositive: true },
    clue: null, history: [], sfx: null,
    final: { stage: "off", eligible: { team1: true, team2: true }, wagers: { team1: null, team2: null }, answers: { team1: null, team2: null }, deadline: null, order: ["team1", "team2"], results: { team1: null, team2: null }, shown: { team1: { answer: false, wager: false }, team2: { answer: false, wager: false } } },
  };
  await fetch(URL + "__fs/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes: [{ op: "set", path: "state/game", data: oldState }] }) });
  const up = await device("upgrade", { width: 1280, height: 800 });
  await hostLogin(up, "#/admin");
  await up.waitForSelector(".remote");
  await until(up, () => window.__G.S && !!window.__G.S.minis);
  S = await state(up);
  eq([S.phase, S.scores, S.teamNames, S.settings.answerSeconds, S.settings.playersRename, S.minis.list.length],
    ["board", { team1: 700, team2: 400 }, { team1: "Husbands", team2: "The Elves" }, 20, true, 0],
    "game in progress kept; 'Team 1' became Husbands; custom name, scores and settings untouched");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
