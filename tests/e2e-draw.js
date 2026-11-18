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
  for (const [n, t] of [["Jake", "team1"], ["Emma", "team2"]]) {
    const p = await device(n, { width: 390, height: 844 });
    await p.goto(URL);
    await p.fill("#jn-name", n);
    await p.click(`.teambtn.${t}`);
    await p.click('[data-action="join"]');
    await p.waitForSelector(".phone");
    P[n] = p;
  }
  // a player without a phone can't draw, so they're never picked
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.addPlayer("Grandpa", "team1"); });

  console.log("Playing");
  const id = await host.evaluate(() => window.__G.S.minis.list[0].id);
  await host.evaluate(async (id) => { const D = await import("/js/data.js"); await D.act("miniPlay", { id }); }, id);
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Who's drawing"));
  await host.keyboard.press("Space");
  await until(host, () => window.__G.S.minis.list[0].matches.length === 1);
  const m = await host.evaluate(() => window.__G.S.minis.list[0].matches[0]);
  ok(m.p1.name === "Jake" && m.p2.name === "Emma", "only players with a phone are picked to draw");
  ok(m.pic === "builtin:snowman", "the first round uses the first picture");
  await until(P.Jake, () => !!document.querySelector(".drawfull canvas.drawpad"), null, 5000);
  await until(P.Emma, () => !!document.querySelector(".drawfull canvas.drawpad"), null, 5000);
  ok(true, "both drawers get a full-screen drawing pad");
  ok(!(await P.Jake.$(".drawfull svg")) && !(await P.Jake.$(".describe")), "drawers never see the picture");
  ok(!(await board.$(".tcard.result")), "the board doesn't show the picture while they draw");

  ok((await board.textContent(".steppanel")).includes("Get ready"), "the board says get ready until you start");
  await until(host, () => (document.querySelector(".r-buttons") || {}).textContent?.includes("Start drawing"));
  await host.keyboard.press("Space");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Starting in"));
  ok(true, "a short countdown before step 1");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Step 1 of 10"), null, 6000);
  ok((await board.textContent(".steppanel")).includes("big circle for the bottom"), "step 1 is shown on the big screen");
  ok((await board.$$(".steppanel svg.example polyline.now")).length === 1 && (await board.$$(".steppanel svg.example polyline.done")).length === 0, "with an example of what to draw (the new step in red)");
  await until(P.Jake, () => document.querySelector(".df-top")?.textContent.includes("Step 1 of 10"));
  ok(true, "the drawer's phone says which step it is");
  await shot(board, "d02a-board-step1");
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Step 2 of 10"), null, 7000);
  ok((await board.$$(".steppanel svg.example polyline.done")).length === 1 && (await board.$$(".steppanel svg.example polyline.now")).length === 1 && (await board.textContent(".steppanel")).includes("medium circle"), "after the set time it moves on: the example now shows steps 1 + 2");
  await sleep(700);
  await shot(board, "d02b-board-step2");
  // Jake draws the snowman scene, off to the side and mirrored. Emma scribbles.
  const scene = await P.Jake.evaluate(async () => { const P = await import("/js/pictures.js"); const D = await import("/js/draw.js"); return D.decode(P.builtinStrokes("builtin:snowman")); });
  await drawOn(P.Jake, ".drawfull canvas", scene.map((st) => st.map(([x, y]) => [0.12 + (1 - x / 1000) * 0.75, 0.05 + (y / 1000) * 0.75])));
  await drawOn(P.Emma, ".drawfull canvas", [[[0.1, 0.1], [0.9, 0.3], [0.2, 0.8], [0.7, 0.9], [0.5, 0.2], [0.95, 0.6]], [[0.3, 0.5], [0.6, 0.55]]]);
  await shot(P.Jake, "d02-phone-drawing");
  await sleep(1200); // re-renders happen meanwhile — the drawing must survive them
  ok((await P.Jake.evaluate(async () => (await import("/js/draw.js")).padStrokes(document.querySelector(".drawfull canvas").dataset.pad).length)) === scene.length, "nothing is lost while the screen refreshes (nothing sent yet)");
  ok(!(await host.evaluate(() => window.__G.S.minis.list[0].matches[0].done.team1)), "nothing is sent until the drawer holds Send");
  await P.Jake.click('.drawfull .holdbtn');
  await sleep(300);
  ok(!(await host.evaluate(() => window.__G.S.minis.list[0].matches[0].done.team1)), "a quick tap doesn't send it — you have to hold");
  await hold(P.Jake, ".drawfull .holdbtn");
  await until(host, () => window.__G.S.minis.list[0].matches[0].done.team1 === true);
  await until(P.Jake, () => document.body.textContent.includes("Drawing sent"));
  ok(true, "holding Send sends it");
  await hold(P.Emma, ".drawfull .holdbtn");
  await until(host, () => !!window.__G.S.minis.list[0].matches[0].winner, null, 10000);
  const done = await host.evaluate(() => window.__G.S.minis.list[0].matches[0]);
  ok(done.winner === "team1", `the website picks the shape match, not the placement: Jake ${done.scores.team1}% vs Emma ${done.scores.team2}%`);
  await until(board, () => document.querySelectorAll(".tcard.result svg.drawing polyline").length >= 3, null, 8000);
  const labels = await board.$$eval(".tcard.result .dpanel", (els) => els.map((e) => e.querySelector(".dp-label").textContent + "|" + e.querySelector(".dp-name").textContent));
  ok(labels[0].startsWith("The picture") && labels[1].includes("Winner") && labels[1].includes("Jake") && labels[2].includes("Loser") && labels[2].includes("Emma"), "board shows the picture, the winner and the loser side by side");
  await sleep(500);
  await shot(board, "d03-board-verdict");
  await until(P.Jake, () => document.body.textContent.includes("You won"));
  await until(P.Emma, () => document.body.textContent.includes("You lost"));
  ok(true, "the drawers' phones say who won");
  ok((await host.evaluate(() => window.__G.S.minis.list[0].matches[0].scores.team1)) > (await host.evaluate(() => window.__G.S.minis.list[0].matches[0].scores.team2)), "scores are shown as % match");

  // round 2 uses your own picture: the board shows the step number, no example picture
  await host.keyboard.press("Space");
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

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
