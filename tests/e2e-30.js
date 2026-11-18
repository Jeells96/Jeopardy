// End-to-end test with 30 phones at once: fair buzzing (even on a slow network), the
// buzzers and sounds lining up on every screen, and a 30-person Blind Drawing round.
//
//   node tests/server.js &
//   node tests/e2e-30.js [shotsDir]
//
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
const N = Number(process.env.PHONES || 30);
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, timeout = 15000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
  catch (e) {
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 400)).catch(() => "");
    throw new Error(`[${page.name}] waited for: ${fn.toString().slice(0, 140)}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
  }
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }
const act = (page, name, p = {}) => page.evaluate(async ([n, x]) => { const D = await import("/js/data.js"); await D.act(n, x); }, [name, p]);
const state = (page) => page.evaluate(() => window.__G.S);
const dump = async () => (await fetch(URL + "__fs/dump", { method: "POST" })).json();

(async () => {
  await fetch(URL + "__fs/reset", { method: "POST" });
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, viewport, ctxOpts = {}) {
    const context = await browser.newContext({ viewport, ...ctxOpts });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
    page.on("console", (m) => { const url = (m.location() && m.location().url) || ""; if (m.type() === "error" && !/favicon|409/.test(m.text()) && !url.endsWith(".mp3")) errors.push(`[${name}] ${m.text()}`); });
    page.name = name;
    return page;
  }

  console.log(`Setting up: host, board and ${N} phones`);
  const host = await device("host", { width: 430, height: 900 });
  await host.goto(URL + "#/admin");
  await host.fill("#gate-code", "2325");
  await host.press("#gate-code", "Enter");
  await host.waitForSelector(".remote");
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.loadTestGame(); });
  await until(host, () => window.__G.Q.length >= 5);
  const board = await device("board", { width: 1600, height: 900 });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  const phones = [];
  for (let b = 0; b < N; b += 10) {
    await Promise.all(Array.from({ length: Math.min(10, N - b) }, async (_, k) => {
      const i = b + k, team = i % 2 ? "team2" : "team1";
      const p = await device("P" + (i + 1), { width: 360, height: 740 }, { hasTouch: true });
      await p.goto(URL);
      await p.fill("#jn-name", "Player" + (i + 1));
      await p.click(`.teambtn.${team}`);
      await p.click('[data-action="join"]');
      await p.waitForSelector(".phone");
      p.team = team;
      phones[i] = p;
    }));
  }
  await until(host, (n) => window.__G.P.length === n, N);
  ok(true, `${N} phones joined`);
  // Every screen re-checks its clock 15 s and 45 s after loading; do those readings now,
  // one screen at a time (all 32 at once, as they joined, made for slow, noisy readings).
  for (let k = 0; k < 2; k++) for (const p of [host, board, ...phones]) await p.evaluate(async () => { const D = await import("/js/data.js"); await D.syncClock(); });
  await act(host, "startGame", { control: "team1" });
  const qs = await host.evaluate(() => window.__G.Q.filter((q) => !q.isFinal).map((q) => q.id));
  const toBoard = async () => { await act(host, "judge", { result: "correct" }).catch(() => {}); await act(host, "closeClue").catch(() => {}); await until(host, () => window.__G.S.phase === "board"); };
  const live = (p) => until(p, () => !!document.querySelector(".buzz.live"));
  const buzzNow = (p) => p.dispatchEvent('[data-action="buzz"]', "pointerdown");

  console.log("Fair buzzing on a slow network");
  const A = phones[0], B = phones[1]; // a husband and a wife
  await act(host, "pickClue", { qid: qs[0] });
  // Watch the moment each screen lights up.
  const watch = (p, sel) => p.evaluate((sel) => {
    window.__liveAt = 0;
    const check = () => { if (!window.__liveAt && document.querySelector(sel)) window.__liveAt = Date.now(); };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, sel);
  await Promise.all([...phones.map((p) => watch(p, ".buzz.live")), watch(board, ".status--open")]);
  // A's phone is on slow Wi-Fi: everything it sends takes an extra 450 ms.
  await A.route("**/__fs/commit", async (route) => { await sleep(450); await route.continue(); });
  const t0 = Date.now();
  // An eager player presses while the question is still being read: TOO SOON, locked out
  // for a quarter second, and the press doesn't count.
  await until(phones[2], () => !!document.querySelector(".buzz.wait"));
  // (press and look in one go: with 30 phones on one test machine, a quarter second goes fast)
  const early = await phones[2].evaluate(async () => {
    document.querySelector('[data-action="buzz"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    await new Promise((r) => requestAnimationFrame(r)); // the screen redraws on the next frame
    return document.querySelector(".buzz").className;
  });
  ok(early.includes("early"), "pressing before the buzzers open: TOO SOON (and the press doesn't count)");
  await act(host, "openBuzzers");
  await until(A, () => window.__G.S.clue && window.__G.S.clue.stage === "open");
  ok(!(await A.$(".buzz.live")) && !!(await A.$(".buzz.wait")), "the buzzer says WAIT for a moment after Jaren opens it");
  await Promise.all([live(A), live(B)]);
  await buzzNow(A);
  await sleep(100);
  await buzzNow(B);
  await until(host, () => window.__G.S.clue.stage === "answering", null, 8000);
  let c = (await state(host)).clue;
  ok(c.locked.name === "Player1", `the faster press wins even though it reached the server later (${c.order.map((o) => `${o.name} ${o.ms}ms`).join(", ")})`);
  ok(c.order.length === 2 && c.order[1].name === "Player2" && c.order[1].ms - c.order[0].ms >= 70, "…and Player2, who pressed 0.1s later, is second");
  ok(!c.order.some((o) => o.name === "Player3"), "the too-soon press isn't in the list");
  await A.unroute("**/__fs/commit");
  // every screen lit up at the same moment
  const lit = await Promise.all([...phones, board].map((p) => p.evaluate(() => window.__liveAt)));
  const opened = c.openedAt; // shared clock = this machine's clock in the test
  const litOk = lit.filter((t, i) => t && (i !== 2));
  const spread = Math.max(...litOk) - Math.min(...litOk);
  ok(litOk.length >= N && spread < 200, `all ${litOk.length} screens lit up together (within ${spread} ms)`);
  ok(Math.min(...litOk) >= opened - 30 && t0 + 650 <= opened, "…at the scheduled moment, not before");
  // the buzz-in sound is due at the same moment on every screen
  await until(board, (id) => window.__G.lastCue && window.__G.lastCue.sound === "buzz", null, 5000);
  const cues = await Promise.all([...phones, board, host].map((p) => p.evaluate(() => window.__G.lastCue && window.__G.lastCue.sound === "buzz" ? window.__G.lastCue.at : null)));
  const cueOk = cues.filter(Boolean);
  ok(cueOk.length === N + 2 && Math.max(...cueOk) - Math.min(...cueOk) <= 5, `the buzz-in sound is due at the same instant on all ${cueOk.length} screens (within ${Math.max(...cueOk) - Math.min(...cueOk)} ms)`);
  await shot(board, "t01-board-fastest");
  await shot(host, "t01b-host-fastest");
  await shot(B, "t01c-phone-fastest");
  ok((await B.textContent(".reaction")).includes("Player1"), "phones show who was fastest, to the hundredth of a second");
  await toBoard();

  console.log(`All ${N} press at once`);
  await act(host, "pickClue", { qid: qs[1] });
  await act(host, "openBuzzers");
  await Promise.all(phones.map(live));
  const before = Date.now();
  await Promise.all(phones.map(buzzNow));
  await until(host, () => window.__G.S.clue.stage === "answering", null, 8000);
  const decidedIn = Date.now() - before;
  c = (await state(host)).clue;
  const docs = Object.entries(await dump()).filter(([k, v]) => k.startsWith("buzzes/") && v.key === `${c.id}:${c.buzzRound}`).map(([, v]) => v);
  const fastest = docs.slice().sort((a, b) => a.t - b.t)[0];
  ok(docs.length === N, `all ${N} presses were recorded (each in its own document — no clashing)`);
  ok(c.locked.deviceId === fastest.deviceId, `exactly one winner: the fastest press (${c.locked.name}, ${c.locked.ms} ms)`);
  ok(c.order.length === 5 && c.order.every((o, i) => i === 0 || o.ms >= c.order[i - 1].ms), "the top 5 are listed fastest first");
  ok(decidedIn < 2500, `decided in ${decidedIn} ms`);
  const winnerPhone = phones.find((p) => p.name === "P" + c.locked.name.replace("Player", ""));
  await until(winnerPhone, () => document.body.textContent.includes("You're up"));
  ok(true, "the winner's phone says You're up");
  await toBoard();

  console.log(`Blind Drawing with ${N} people`);
  // a quick one-step picture (the last step lasts twice as long: 10 s)
  await host.evaluate(async () => {
    const D = await import("/js/data.js");
    await D.saveDrawing("drawpic-test30", { kind: "drawpic", strokes: ["300,300,700,300,700,700,300,700,300,300"] });
    await D.act("miniAdd", { game: { name: "Blind Drawing", type: "draw", pics: ["drawpic-test30"], picSteps: { "drawpic-test30": 1 }, stepSeconds: 5 } });
  });
  const gid = await host.evaluate(() => window.__G.S.minis.list[0].id);
  await act(host, "miniPlay", { id: gid });
  await act(host, "miniDrawRound", { id: gid });
  await Promise.all(phones.map((p) => until(p, () => !!document.querySelector(".drawfull canvas"))));
  ok(true, `all ${N} phones become drawing pads`);
  await act(host, "miniDrawStart", { id: gid });
  await Promise.all(phones.map((p) => until(p, () => document.querySelector(".df-top")?.textContent.includes("Step 1 of 1"), null, 8000)));
  // everyone draws a square-ish shape, more or less well
  await Promise.all(phones.map(async (p, i) => {
    const box = await p.locator(".drawfull canvas").boundingBox();
    const s = Math.min(box.width, box.height), x0 = box.x + (box.width - s) / 2, y0 = box.y + (box.height - s) / 2, w = 0.15 + (i % 7) * 0.03;
    const pts = [[0.3, 0.3], [0.7, 0.3 + w / 3], [0.7, 0.7], [0.3 + w, 0.7], [0.3, 0.3]];
    await p.mouse.move(x0 + pts[0][0] * s, y0 + pts[0][1] * s);
    await p.mouse.down();
    for (const [x, y] of pts.slice(1)) await p.mouse.move(x0 + x * s, y0 + y * s, { steps: 3 });
    await p.mouse.up();
  }));
  await until(board, () => (document.querySelector(".steppanel") || {}).textContent?.includes("Pencils down"), null, 15000);
  const down = Date.now();
  await until(host, () => !!window.__G.S.minis.list[0].matches[0].winner, null, 40000);
  const judgedIn = (Date.now() - down) / 1000;
  const m = (await state(host)).minis.list[0].matches[0];
  ok(Object.keys(m.done).length === N, `all ${N} drawings sent themselves at pencils down`);
  ok(judgedIn < 20, `all ${N} judged ${judgedIn.toFixed(1)} s after pencils down`);
  await until(board, () => document.querySelectorAll(".dverdict .dpanel svg.drawing").length >= 3, null, 15000);
  const fits = await board.evaluate(() => { const r = document.querySelector(".dverdict").getBoundingClientRect(); return r.bottom <= window.innerHeight; });
  ok(fits, "the board shows the picture, the best and the worst, and it fits on the screen");
  await sleep(600);
  await shot(board, "t02-board-30-drawings");
  await until(phones[5], () => !!document.querySelector(".dbrowse .mysub svg.drawing") && document.querySelectorAll(".dlb-row").length >= 30);
  ok(true, `each phone shows the drawing it sent, and a leaderboard of all ${N}`);
  await shot(phones[5], "t03-phone-30-leaderboard");

  console.log(errors.length ? "\nPage errors:\n" + errors.slice(0, 20).join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
