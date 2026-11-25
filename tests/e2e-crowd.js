// Screens with a big crowd (34 players, some with long names): takes screenshots of every
// screen that lists players and checks nothing spills off the screen.
//
//   node tests/server.js &
//   node tests/e2e-crowd.js [shotsDir]
//
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, timeout = 15000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
  catch (e) {
    const txt = await page.evaluate(() => document.querySelector("#app").innerText.slice(0, 300)).catch(() => "");
    throw new Error(`[${page.name}] waited for: ${fn.toString().slice(0, 140)}\n  screen: ${txt.replace(/\n+/g, " | ")}`);
  }
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }
const act = (page, name, p = {}) => page.evaluate(async ([n, x]) => { const D = await import("/js/data.js"); await D.act(n, x); }, [name, p]);
// Nothing sticks out sideways, and on fixed-height screens (board, host) nothing is cut off.
const fits = (page, fixedHeight) => page.evaluate((fixed) => {
  const W = document.documentElement.clientWidth, H = window.innerHeight;
  const over = [...document.querySelectorAll("#app *")].filter((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.position === "fixed" || el.closest("[data-keep], .spin, .drawfull")) return false;
    // ignore anything inside a scrolling / clipping box
    for (let a = el.parentElement; a && a.id !== "app"; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) return false; }
    return r.right > W + 2 || r.left < -2 || (fixed && r.bottom > H + 2);
  });
  return { ok: over.length === 0, what: over.slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}`) };
}, fixedHeight);
const NAMES = ["Grandma Jo", "Uncle Bartholomew", "Aunt Marguerite-Rose", "Cousin Eddie", "Big Mike", "Little Mike", "Jen", "Kimberly Anne",
  "Pastor Dave", "Bo", "Sir Reginald Thistlewood", "Ann", "Rick", "Amy", "Christopher", "Elizabeth", "Grandpa Gus", "Nana",
  "Tiffany", "Jose", "Mary Catherine", "Lou", "Theodore", "Penelope", "Zed", "Maximilian", "Ruth", "Sam", "Alexandra", "Ty",
  "Josephine", "Benny", "Ollie", "Winifred"];

(async () => {
  await fetch(URL + "__fs/reset", { method: "POST" });
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, viewport, opts = {}) {
    const page = await (await browser.newContext({ viewport, ...opts })).newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
    page.name = name;
    return page;
  }
  console.log(`A crowd of ${NAMES.length}`);
  const host = await device("host", { width: 430, height: 900 });
  await host.goto(URL + "#/admin");
  await host.fill("#gate-code", "2325");
  await host.press("#gate-code", "Enter");
  await host.waitForSelector(".remote");
  await host.evaluate(async (names) => {
    const D = await import("/js/data.js");
    await D.loadTestGame();
    for (let i = 0; i < names.length; i++) await D.addPlayer(names[i], i % 2 ? "team2" : "team1");
  }, NAMES);
  await until(host, (n) => window.__G.P.length === n, NAMES.length);
  const board = await device("board", { width: 1600, height: 900 });
  await board.goto(URL + "#/board");
  await board.waitForSelector(".stage");
  const tv = await device("tv-1080", { width: 1920, height: 1080 });
  await tv.goto(URL + "#/board");
  await tv.waitForSelector(".stage");
  const phone = await device("phone", { width: 375, height: 667 }, { hasTouch: true });
  await phone.goto(URL);
  await phone.fill("#jn-name", "Hannah Montgomery-Smythe");
  await phone.click(".teambtn.team2");
  await phone.click('[data-action="join"]');
  await phone.waitForSelector(".phone");
  await sleep(800);
  const check = async (page, name, fixed) => { const r = await fits(page, fixed); ok(r.ok, `${name} fits${r.ok ? "" : " — spills: " + r.what.join(", ")}`); await shot(page, "c-" + name.replace(/\W+/g, "-").toLowerCase()); };

  console.log("Lobby");
  await check(board, "board lobby (17 + 18 names)", true);
  await check(tv, "1080p TV lobby", true);
  await check(host, "host lobby", false);
  await check(phone, "phone lobby", false);
  await host.click('.r-tools [data-action="drawer"]');
  await host.click('.tab:has-text("Players")');
  await sleep(300);
  await check(host, "host players tab", false);
  await host.keyboard.press("Escape");

  console.log("Mini games");
  await host.evaluate(async () => {
    const D = await import("/js/data.js");
    await D.act("miniAdd", { game: { name: "Snowball Toss", type: "h2h", tables: 3 } });
    await D.act("miniAdd", { game: { name: "Present Stack", type: "best", unit: "boxes" } });
  });
  const [g1, g2] = await host.evaluate(() => window.__G.S.minis.list.map((g) => g.id));
  await act(host, "minisStart");
  await act(host, "miniPlay", { id: g1 });
  await act(host, "miniNext", { id: g1 });
  await sleep(2600); // let the names shuffle and land
  await host.click('[data-action="mini-row-edit"]');
  await sleep(300);
  await check(board, "board: 3 tables of matchups", true);
  await check(host, "host: table rows with player pickers", false);
  await check(phone, "phone: who's playing where", false);
  for (const m of (await host.evaluate(() => window.__G.S.minis.list[0].matches.filter((x) => !x.winner))) ) await act(host, "miniMatch", { id: g1, matchId: m.id, winner: "team1" });
  await act(host, "miniFinish", { id: g1 });
  await act(host, "miniClose");
  await act(host, "miniPlay", { id: g2 });
  for (let i = 0; i < 34; i++) { await act(host, "miniNext", { id: g2 }); await act(host, "miniScore", { id: g2, score: (i * 7) % 23 }); }
  await sleep(500);
  await check(board, "board: best-overall leaderboard (34 scores)", true);
  await check(host, "host: 34 scores", false);
  await check(phone, "phone: leaderboard", false);
  await act(host, "miniFinish", { id: g2 });
  await act(host, "miniClose");

  console.log("Jeopardy");
  await act(host, "startGame", { control: "team1" });
  await sleep(400);
  await check(board, "board: Jeopardy board with team podiums", true);
  const qid = await host.evaluate(() => window.__G.Q.find((q) => !q.isFinal && !q.used).id);
  await act(host, "pickClue", { qid });
  await act(host, "openBuzzers");
  await sleep(900);
  await phone.dispatchEvent('[data-action="buzz"]', "pointerdown").catch(() => {});
  await until(host, () => window.__G.S.clue && window.__G.S.clue.stage === "answering", null, 8000);
  await sleep(400);
  await check(board, "board: someone buzzed in", true);
  await check(phone, "phone: you're up", false);

  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("judge", { result: "correct" }); await D.act("closeClue"); await D.act("endGame"); });

  console.log("Final scores and the night's awards");
  await until(board, () => document.querySelectorAll(".awards .award").length >= 2);
  await sleep(3500); // the awards appear one after another
  await check(board, "board: final scores with the night's awards", true);
  await check(tv, "1080p TV: final scores with the night's awards", true);
  await check(phone, "phone: your night + the awards", false);
  console.log("Ugly sweater vote");
  await host.evaluate(async () => { const D = await import("/js/data.js"); await D.act("voteSetup"); });
  await until(host, () => window.__G.S.vote && window.__G.S.vote.stage === "setup");
  await sleep(300);
  await check(host, "host: tick 35 sweater wearers", false);
  await act(host, "voteOpen");
  await sleep(500);
  await check(board, "board: sweater vote with 35 candidates", true);
  await check(phone, "phone: vote for one of 35", false);

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
