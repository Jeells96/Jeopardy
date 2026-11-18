// End-to-end test: screens that are already open reload themselves onto a new deploy.
//
//   node tests/server.js &  then  node tests/e2e-update.js
//
// Also run it against a copy with versioned file URLs, the way the deploy builds it:
//   cp -r . /tmp/site && (cd /tmp/site && tools/cache-bust.sh test1)
//   PORT=8124 node /tmp/site/tests/server.js &  then  URL=http://localhost:8124/ node tests/e2e-update.js
//
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8123/";
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deploy = () => fetch(URL + "__deploy", { method: "POST" });

(async () => {
  await fetch(URL + "__fs/reset", { method: "POST" });
  const browser = await chromium.launch();
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { const url = (m.location() && m.location().url) || ""; if (m.type() === "error" && !/favicon|409/.test(m.text()) && !url.endsWith(".mp3")) errors.push(m.text()); });
  let loads = 0;
  page.on("load", () => loads++);

  await page.goto(URL);
  await page.waitForSelector("#jn-name");
  const stamp = (await page.getAttribute('script[type="module"]', "src")).split("?v=")[1];
  if (stamp) {
    console.log("Versioned file URLs (as deployed)");
    const scripts = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/js\/.+\.js/.test(n)));
    ok(scripts.length > 10 && scripts.every((n) => n.includes("?v=" + stamp)), `every module is loaded with the version in its URL (${scripts.length} files) — never a cached old copy`);
    const names = scripts.map((n) => n.split("?")[0]);
    ok(new Set(names).size === names.length, "each module is loaded exactly once");
  }
  console.log("Nothing new deployed");
  await sleep(3500); // the first check runs 3 s after loading
  ok(loads === 1, "no reload while the site hasn't changed");

  console.log("A new version is deployed");
  await page.evaluate(() => { window.__marker = 1; });
  await page.focus("#jn-name");
  await page.keyboard.type("Ann");
  await deploy();
  await page.evaluate(() => window.__G.checkForUpdate());
  await sleep(2000);
  ok(await page.evaluate(() => window.__marker === 1), "not while someone is typing");
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !window.__marker, null, { timeout: 5000 });
  ok(true, "as soon as they stop typing, the screen reloads onto the new version");
  await page.waitForSelector("#jn-name");
  await page.evaluate(() => { window.__marker = 2; });
  await sleep(4500);
  ok(await page.evaluate(() => window.__marker === 2), "it doesn't keep reloading if the new files aren't there yet");

  console.log(errors.length ? "\nPage errors:\n" + errors.join("\n") : "\nNo page errors.");
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
