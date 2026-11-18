// End-to-end test for the Blind Drawing mini game.
//
//   node tests/server.js &
//   node tests/e2e-draw.js [shotsDir]
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

// A five-pointed star, as points 0–1 inside the pad. Options move / shrink / turn / mirror it.
function star({ dx = 0, dy = 0, sc = 1, deg = 0, mirror = false } = {}) {
  const a = (deg * Math.PI) / 180;
  return Array.from({ length: 11 }, (_, i) => {
    const r = (i % 2 ? 0.15 : 0.35) * sc, t = -Math.PI / 2 + (i % 10) * Math.PI / 5;
    let x = r * Math.cos(t), y = r * Math.sin(t);
    if (mirror) x = -x;
    return [0.5 + dx + x * Math.cos(a) - y * Math.sin(a), 0.5 + dy + x * Math.sin(a) + y * Math.cos(a)];
  });
}
async function drawOn(page, sel, strokes) {
  const box = await page.locator(sel).boundingBox();
  for (const s of strokes) {
    await page.mouse.move(box.x + s[0][0] * box.width, box.y + s[0][1] * box.height);
    await page.mouse.down();
    for (const [x, y] of s.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 4 });
    await page.mouse.up();
  }
}
async function hold(page, sel) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await sleep(1150);
  await page.mouse.up();
}

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

  console.log("Setting up Blind Drawing");
  const host = await device("host", { width: 430, height: 900 });
  await host.goto(URL + "#/admin");
  await host.fill("#gate-code", "2325");
  await host.press("#gate-code", "Enter");
  await host.waitForSelector(".remote");
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Mini games")');
  await host.click('.ideas .chipbtn:has-text("Blind Drawing")');
  await until(host, () => window.__G.S.minis.list.length === 1 && window.__G.S.minis.list[0].mode === "draw");
  ok(true, "Blind Drawing can be added from the ideas");
  // ready-made Christmas drawings
  await host.click('[data-action="draw-gallery"]');
  await until(host, () => document.querySelectorAll(".gallery .gpic").length === 10);
  ok(true, "10 ready-made Christmas drawings to choose from");
  await host.click('.gpic[data-pic="builtin:snowman"]');
  await until(host, () => window.__G.S.minis.list[0].pics.includes("builtin:snowman"));
  ok(true, "tap one to add it");
  await host.click('.modal [data-action="modal-close"]');
  // your own drawing: you must say how many steps
  await host.click('[data-action="draw-pic-new"]');
  await host.waitForSelector('canvas[data-pad^="ref-"]');
  await drawOn(host, 'canvas[data-pad^="ref-"]', [star()]);
  await shot(host, "d01-host-draws-picture");
  await host.click('[data-action="draw-pic-save"]');
  await sleep(500);
  ok((await host.evaluate(() => window.__G.S.minis.list[0].pics.length)) === 1, "a hand-drawn picture can't be saved without a step count");
  await host.fill("#draw-pic-steps", "2");
  await host.click('[data-action="draw-pic-save"]');
  await until(host, () => window.__G.S.minis.list[0].pics.length === 2);
  const own = await host.evaluate(() => window.__G.S.minis.list[0].pics[1]);
  ok((await host.evaluate((id) => window.__G.S.minis.list[0].picSteps[id], own)) === 2, "with the step count saved");
  await until(host, () => document.querySelectorAll(".pics svg.drawing polyline").length >= 2);
  ok(true, "both pictures show as thumbnails");
  await host.fill('input[data-f="stepSeconds"]', "5");
  await host.locator('input[data-f="stepSeconds"]').dispatchEvent("change");
  await until(host, () => window.__G.S.minis.list[0].stepSeconds === 5);
  ok(true, "seconds per step can be changed");
  await host.keyboard.press("Escape");

  const board = await device("board", { width: 1600, height: 900 });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  const P = {};
  for (const [n, t] of [["Jake", "team1"], ["Emma", "team2"], ["Kim", "team2"]]) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.fill("#jn-name", n);
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    P[n] = p;
  }
  // a player without a phone can't draw
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.addPlayer("Grandpa", "team1"); });
  // tables are set up for the other games — blind drawing ignores them
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("miniTables", { tables: "Kitchen, Garage" }); });
  const btnText = () => host.evaluate(() => (document.querySelector(".r-buttons") || {}).textContent || "");
  const clickBtn = (text) => host.locator(".r-buttons button", { hasText: text }).first().click();

  console.log("Playing: everyone draws at once");
  const id = await host.evaluate(() => window.__G.S.minis.list[0].id);
  await host.evaluate(async (id) => { const D = await import("/js/data.js"); await D.act("miniPlay", { id }); }, id);
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Everyone draw"));
  ok(!(await host.$(".tablectl")) && !(await host.textContent(".remote")).includes("📍"), "no tables in blind drawing — everyone stays where they're sitting");
  await host.keyboard.press("Space");
  await until(host, () => window.__G.S.minis.list[0].matches.length === 1);
  let rd = await host.evaluate(() => window.__G.S.minis.list[0].matches[0]);
  ok(rd.drawers.map((d) => d.name).join() === "Jake,Emma,Kim", "everyone with a phone draws at once (Grandpa has no phone)");
  ok(!rd.table && rd.pic === "builtin:snowman", "no table; the first round uses the first picture");
  for (const n of ["Jake", "Emma", "Kim"]) await until(P[n], () => !!document.querySelector(".drawfull canvas.drawpad"), null, 5000);
  ok(true, "every phone becomes a full-screen drawing pad");
  ok(!(await P.Jake.$(".drawfull svg")) && !(await P.Jake.$(".describe")), "drawers never see the picture");
  ok(!(await board.$(".spin")), "no name shuffle — nobody is picked");
  ok((await board.textContent(".steppanel")).includes("Get ready"), "the board says get ready until you start");
  ok((await board.$$eval(".dchips .dchip", (els) => els.map((e) => e.textContent.trim()))).join("|") === "✏️ Jake|✏️ Emma|✏️ Kim", "the board lists everyone who's drawing");
  // undo a round set up by mistake
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Undo round"));
  await clickBtn("Undo round");
  await until(host, () => window.__G.S.minis.list[0].matches.length === 0);
  await until(P.Jake, () => !document.querySelector(".drawfull"));
  ok(true, "↶ Undo round: back to before the round (the phones close the pad)");
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Everyone draw"));
  await host.keyboard.press("Space");
  await until(host, () => window.__G.S.minis.list[0].matches.length === 1);
  ok((await host.evaluate(() => window.__G.S.minis.list[0].matches[0].pic)) === "builtin:snowman", "…and the same picture comes up again");

  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Start drawing"));
  await host.keyboard.press("Space");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Starting in"));
  ok(true, "a short countdown before step 1");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Step 1 of 10"), null, 6000);
  ok((await board.textContent(".steppanel")).includes("big circle for the bottom"), "step 1 is shown on the big screen");
  ok((await board.$$(".steppanel svg.example polyline.now")).length === 1 && (await board.$$(".steppanel svg.example polyline.done")).length === 0, "with an example of what to draw (the new step in red)");
  await until(P.Kim, () => document.querySelector(".df-top")?.textContent.includes("Step 1 of 10"));
  ok(true, "every phone says which step it is");
  await shot(board, "d02a-board-step1");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Step 2 of 10"), null, 7000);
  ok((await board.$$(".steppanel svg.example polyline.done")).length === 1 && (await board.$$(".steppanel svg.example polyline.now")).length === 1 && (await board.textContent(".steppanel")).includes("medium circle"), "after the set time it moves on: the example now shows steps 1 + 2");
  await sleep(700);
  await shot(board, "d02b-board-step2");
  await shot(host, "d02c-host-drawing");
  // Jake draws the whole snowman scene, off to the side and mirrored. Kim's parts land a bit
  // off. Emma scribbles.
  const scene = await P.Jake.evaluate(async () => { const P = await import("/js/pictures.js"); const D = await import("/js/draw.js"); return D.decode(P.builtinStrokes("builtin:snowman")); });
  const fit = (st) => st.map(([x, y]) => [0.12 + (1 - x / 1000) * 0.75, 0.05 + (y / 1000) * 0.75]);
  await drawOn(P.Jake, ".drawfull canvas", scene.map(fit));
  // Kim: the whole scene, but each part lands a bit off (lifting your finger with the phone on your head)
  const off = [[0.05, -0.04], [-0.06, 0.03], [0.04, 0.06], [-0.05, -0.05], [0.07, 0.02], [-0.03, 0.07], [0.06, -0.06], [-0.07, 0.04]];
  await drawOn(P.Kim, ".drawfull canvas", scene.map((st, i) => st.map(([x, y]) => [0.12 + (x / 1000) * 0.72 + off[i % off.length][0], 0.12 + (y / 1000) * 0.72 + off[i % off.length][1]])));
  await drawOn(P.Emma, ".drawfull canvas", [[[0.1, 0.1], [0.9, 0.3], [0.2, 0.8], [0.7, 0.9], [0.5, 0.2], [0.95, 0.6]], [[0.3, 0.5], [0.6, 0.55]]]);
  await shot(P.Jake, "d02-phone-drawing");
  await sleep(1200); // re-renders happen meanwhile — the drawing must survive them
  ok((await P.Jake.evaluate(async () => (await import("/js/draw.js")).padStrokes(document.querySelector(".drawfull canvas").dataset.pad).length)) === scene.length, "nothing is lost while the screen refreshes (nothing sent yet)");
  const doneOf = (pid) => host.evaluate((pid) => !!(window.__G.S.minis.list[0].matches[0].done || {})[pid], pid);
  const pidOf = (n) => P[n].evaluate(() => window.__G.deviceId);
  const jake = await pidOf("Jake");
  ok(!(await doneOf(jake)), "nothing is sent until you hold Send");
  await P.Jake.click('.drawfull .holdbtn');
  await sleep(300);
  ok(!(await doneOf(jake)), "a quick tap doesn't send it — you have to hold");
  await hold(P.Jake, ".drawfull .holdbtn");
  await until(host, (pid) => (window.__G.S.minis.list[0].matches[0].done || {})[pid] === true, jake);
  await until(P.Jake, () => document.body.textContent.includes("Drawing sent"));
  ok(true, "holding Send sends it");
  await until(board, () => (document.querySelector(".dstatus") || {}).textContent?.includes("1 of 3"));
  ok((await board.textContent(".dchip.sent")).includes("Jake"), "the board ticks off each drawing as it comes in");
  await hold(P.Kim, ".drawfull .holdbtn");
  await sleep(400);
  ok(!(await host.evaluate(() => window.__G.S.minis.list[0].matches[0].winner)), "no verdict until everyone has sent");
  await hold(P.Emma, ".drawfull .holdbtn");
  await until(host, () => !!window.__G.S.minis.list[0].matches[0].winner, null, 15000);
  const done = await host.evaluate(() => window.__G.S.minis.list[0].matches[0]);
  const ranked = await host.evaluate(async () => { const E = await import("/js/engine.js"); return E.drawRanking(window.__G.S.minis.list[0].matches[0]); });
  ok(done.winner === "team1" && ranked[0].name === "Jake", `the best drawing wins it for their team: ${ranked.map((d) => `${d.name} ${d.score}%`).join(", ")}`);
  ok(ranked[2].name === "Emma", "the scribble comes last");
  await until(board, () => document.querySelectorAll(".dverdict .dpanel svg.drawing polyline").length >= 3, null, 8000);
  const labels = await board.$$eval(".dverdict .dpanel", (els) => els.map((e) => e.querySelector(".dp-label").textContent + "|" + e.querySelector(".dp-name").textContent));
  ok(labels.length === 3 && labels[0].startsWith("The picture") && labels[1].includes("Winner") && labels[1].includes("Jake") && labels[2].includes("Last place") && labels[2].includes("Emma"), "board shows the picture, the winner and last place side by side");
  await until(board, () => document.querySelectorAll(".dall .dall-item svg.drawing polyline").length >= 3, null, 8000);
  ok((await board.$$eval(".dall .dall-item b", (els) => els.map((e) => e.textContent))).join("|") === "1. Jake|2. Kim|3. Emma", "…then everyone's drawing, best first");
  await sleep(500);
  await shot(board, "d03-board-verdict");
  await until(P.Jake, () => document.body.textContent.includes("Your drawing won"));
  await until(P.Kim, () => document.body.textContent.includes("You came 2nd of 3"));
  await until(P.Emma, () => document.body.textContent.includes("You came 3rd of 3"));
  ok(true, "every phone says how they did");
  await shot(P.Kim, "d03b-phone-verdict");
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Another round"));
  ok((await host.textContent(".r-panel")).includes("Jake"), "Jaren sees the website's verdict too");
  await shot(host, "d03c-host-verdict");

  // round 2 uses your own picture: the board shows the step number, no example picture
  await clickBtn("Another round");
  await until(host, () => window.__G.S.minis.list[0].matches.length === 2);
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Start drawing"), null, 5000);
  await until(host, () => !!document.querySelector(".describe svg.drawing.host polyline"), null, 5000);
  ok(true, "for your own picture, you see it privately to describe");
  await host.keyboard.press("Space");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Step 1 of 2"), null, 6000);
  ok((await board.textContent(".steppanel")).includes("Listen to Jaren") && !(await board.$(".steppanel svg.example")), "a hand-drawn picture: step number only, no example picture");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Pencils down"), null, 14000);
  await until(P.Jake, () => document.querySelector(".df-top")?.textContent.includes("Pencils down"));
  ok(true, "after the last step: pencils down, hold Send");
  await hold(P.Jake, ".drawfull .holdbtn").catch(() => {});
  // undo a round that's already been drawn
  await clickBtn("Undo round");
  await host.waitForSelector('.modal:has-text("Undo this round")');
  await host.click('.modal .btn.bad');
  await until(host, () => window.__G.S.minis.list[0].matches.length === 1);
  await until(P.Jake, () => !document.querySelector(".drawfull"));
  ok(true, "↶ Undo round works after drawing has started too (with a check first)");

  console.log("Undo starting a game");
  await clickBtn("Undo start");
  await host.waitForSelector('.modal:has-text("Undo starting")');
  ok((await host.textContent(".modal")).includes("Not played yet"), "a game with results asks first");
  await host.click('.modal .btn.bad');
  await until(host, () => { const M = window.__G.S.minis; return !M.current && M.list[0].status === "pending" && M.list[0].matches.length === 0; });
  ok(true, "↶ Undo start: the game is back to not played yet, and you're back at the games list");
  await until(board, () => !!document.querySelector(".mhub"));
  ok(true, "the board goes back to the list of mini games");
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Play “Blind Drawing”"));
  await host.keyboard.press("Space");
  await until(host, () => window.__G.S.minis.current);
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Undo start"));
  await clickBtn("Undo start");
  await until(host, () => !window.__G.S.minis.current && window.__G.S.minis.list[0].status === "pending");
  ok(!(await host.$(".modal")), "a game with nothing played yet is undone straight away");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
