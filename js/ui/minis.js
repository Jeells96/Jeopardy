// Mini games UI: big-screen views, the host's next steps, the setup tab,
// the finish dialog, and what players see on their phones.
import { esc, money, cls, verb } from "./util.js";
import * as E from "../engine.js";
import { summonText } from "../summons.js";
import * as Dr from "../draw.js";
import { PICTURES, BUILTIN, builtin, isBuiltin, builtinStrokes } from "../pictures.js";
import { cachedDrawing, loadDrawing } from "../data.js";

const tn = (G, t) => E.teamName(G.S || {}, t);
export const TYPE_LABEL = { h2h: "Head-to-head", best: "Best overall", draw: "Blind drawing" };
const isDraw = (g) => !!g && g.mode === "draw";
const typeLabel = (g) => (isDraw(g) ? TYPE_LABEL.draw : TYPE_LABEL[g.type]);
// A saved drawing as a picture; loads it (and refreshes the screen) the first time it's needed.
function drawingSvg(G, docId, cls = "") {
  if (isBuiltin(docId)) return Dr.svg(builtinStrokes(docId) || [], cls);
  const d = docId ? cachedDrawing(docId) : null;
  if (d) return Dr.svg(d.strokes, cls, { fit: String(docId).startsWith("drawsub-") });
  if (docId && !(G.drawLoading || (G.drawLoading = new Set())).has(docId)) {
    G.drawLoading.add(docId);
    loadDrawing(docId).then(() => { G.drawLoading.delete(docId); if (G.render) G.render(); }).catch(() => G.drawLoading.delete(docId));
  }
  return `<div class="drawing ${cls} loading">…</div>`;
}
// Where a player's drawing for a round is saved.
export const subDocId = (roundId, pid) => `drawsub-${roundId}-${pid}`;
const J = (o) => esc(JSON.stringify(o));
const actAttr = (name, p = {}, extra = {}) => `data-action="act" data-p="${J({ name, p, ...extra })}"`;
const num = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const scoreText = (g, v) => (isDraw(g) ? `${num(v)}% match` : `${num(v)}${g.unit ? " " + esc(g.unit) : ""}`);
const prize = (g) => (g.type === "h2h" && g.award === "match" ? `${money(g.points)} per ${isDraw(g) ? "round" : "matchup"} win` : `${money(g.points)} to the winners`);
const namesOn = (G, team) => G.P.filter((p) => !team || p.team === team).map((p) => p.name);
// The names shuffled before landing on a pick: only people still in the pool (and the pick).
function reel(G, g, team, finalName) {
  const pl = (g && g.played) || {};
  const played = team ? pl[team] || [] : [...(pl.team1 || []), ...(pl.team2 || [])];
  const people = G.P.filter((p) => E.TEAMS.includes(p.team) && (!team || p.team === team));
  const left = people.filter((p) => !played.includes(p.id)).map((p) => p.name);
  return left.length ? [...left, finalName] : people.map((p) => p.name);
}
const currentGame = (M) => (M.current ? M.list.find((x) => x.id === M.current) : null) || null;
// The Christmas summon for the current draw (only when tables are set up), as plain text.
export const itemSummon = (it) => (it && it.table && it.summon != null ? summonText(it.summon, it.names, it.table) : "");
export function pickSummon(S) {
  const pick = E.currentPick(S);
  return pick ? pick.items.map(itemSummon).filter(Boolean).join(" ") : "";
}
const pickOf = (S, id) => { const p = E.currentPick(S); return (p && p.items.find((x) => x.id === id)) || null; };
const itemSpinning = (G, it) => !!it && G.now() < it.at + E.SPIN_MS;
const freeTables = (G, g, used) => E.miniSlots(G.S, g).filter((t) => t !== null && !used.includes(t));
// Is there anyone left to send to another table? (Head-to-head needs someone free on each team.)
function canDrawMore(G, g, items) {
  const busy = new Set(items.flatMap((x) => (x.pid ? [x.pid] : [x.p1 && x.p1.id, x.p2 && x.p2.id].filter(Boolean))));
  const free = (t) => G.P.some((p) => p.team === t && !busy.has(p.id));
  return g.type === "h2h" ? E.TEAMS.every((t) => free(t) || !G.P.some((p) => p.team === t)) && E.TEAMS.some(free) : E.TEAMS.some(free);
}
// The game clock: one timer for the whole game, however many tables are playing.
const mmss = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
export const timerLabel = (g) => mmss((g.seconds || 0) * 1000);
// The big countdown, shown on the board and on every phone while the clock runs.
function clockBox(G, g, cls2 = "") {
  const c = E.miniClock(g);
  if (!c) return "";
  const live = G.now() < c.endsAt;
  return `<div class="gclock ${cls2}${live ? "" : " done"}" data-key="gclock-${esc(g.id)}-${c.startedAt}">
    ${live ? `<span class="cd" data-deadline="${c.endsAt}" data-format="ms" data-total="${c.endsAt - c.startedAt}">${esc(mmss(c.endsAt - G.now()))}</span>`
      : `<span class="gc-up">📣 TIME'S UP!</span>`}</div>`;
}
const tableTag = (pick) => (pick && pick.table ? `<span class="tabletag">📍 ${esc(pick.table)}</span>` : "");
function summonBanner(G) {
  const text = pickSummon(G.S);
  return text && !isSpinning(G) ? `<div class="summon" data-key="summon-${esc(E.currentPick(G.S).key)}">${esc(text)}</div>` : "";
}

// Ideas the host can add with one tap.
export const PRESETS = [
  { name: "Snowball Toss", type: "h2h", desc: "Toss cotton-ball snowballs into a cup from 6 feet. Most in 30 seconds wins the matchup." },
  { name: "Candy Cane Hook", type: "h2h", desc: "Hook candy canes out of a bowl using one held in your mouth — no hands! First to 5 wins." },
  { name: "Ornament Spoon Race", type: "h2h", desc: "Carry an ornament on a spoon across the room and back. Drop it and you start over." },
  { name: "Present Stack", type: "best", better: "high", unit: "boxes", desc: "Stack gift boxes one-handed for 30 seconds. Tallest tower still standing wins." },
  { name: "Speed Wrap", type: "best", better: "low", unit: "seconds", desc: "Wrap a box as fast as you can — every side covered. Fastest time wins." },
  { name: "Reindeer Ring Toss", type: "best", better: "high", unit: "rings", desc: "Five tosses at the antlers. Most rings landed wins." },
  { name: "Blind Drawing", type: "best", mode: "draw", desc: "Everyone at once, right where you're sitting: phone on top of your head, follow the steps on the big screen and draw without looking. The closest drawing wins it for their team!" },
];

function resultBits(G, g) {
  const r = g.result;
  if (!r) return null;
  if (r.winner === "tie") return { cls: "tie", text: "🤝 Tie", pts: r.team1 || r.team2 ? `+${money(r.team1)} each` : "" };
  if (r.winner === "none") return { cls: "none", text: "No winner", pts: "" };
  return { cls: r.winner, text: `🏆 ${tn(G, r.winner)}`, pts: r[r.winner] ? `+${money(r[r.winner])}` : "" };
}
function kicker(M, g) {
  const i = M.list.findIndex((x) => x.id === g.id) + 1;
  return `Mini game ${i} of ${M.list.length} · ${typeLabel(g)} · ${prize(g)}`;
}
// A name that shuffles through the candidates, then lands on the pick (driven by app.js tick()).
function spin(names, final, at, extra = "") {
  // --len lets the CSS shrink long names to fit instead of cutting them off.
  return `<span class="${cls("spin", extra)}" style="--len:${Math.max(7, String(final).length)}" data-keep data-spin="${J(names.slice(0, 40))}" data-until="${(at || 0) + E.SPIN_MS}" data-final="${esc(final)}">${esc(final)}</span>`;
}
function matchChip(G, m) {
  const a = m.p1 ? m.p1.name : tn(G, "team1");
  const b = m.p2 ? m.p2.name : tn(G, "team2");
  if (m.winner === "tie") return `<span class="mchip tie">${esc(a)} 🤝 ${esc(b)}</span>`;
  const [w, l] = m.winner === "team1" ? [a, b] : [b, a];
  return `<span class="mchip ${m.winner}"><b>${esc(w)}</b> beat ${esc(l)}</span>`;
}
function isSpinning(G) {
  const pick = E.currentPick(G.S);
  return !!pick && G.now() < pick.at + E.SPIN_MS;
}

// =====================================================================
// Big screen (projector + host console)
// =====================================================================
export function minisStage(G, opts = {}) {
  const M = E.minisOf(G.S);
  const g = currentGame(M);
  if (!g) return hub(G, M, opts);
  if (g.status === "done") return resultView(G, g);
  if (isDraw(g)) return drawView(G, M, g);
  return g.type === "h2h" ? h2hView(G, M, g) : bestView(G, M, g);
}

function hub(G, M, opts) {
  if (!M.list.length) {
    return `<div class="mhub"><div class="mhub-title">🎯 Mini Games</div><div class="mhub-sub">No mini games set up yet.</div>${opts.pick ? `<div class="muted">Add some in ⚙ Settings → Mini games.</div>` : ""}</div>`;
  }
  const next = M.list.find((g) => g.status === "active") || M.list.find((g) => g.status === "pending");
  const n = M.list.length;
  const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : n <= 12 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const scale = rows <= 2 ? 1 : +(2 / rows).toFixed(2); // shrink everything when there are lots of games
  return `<div class="mhub" data-key="mhub" style="--cols:${cols};--s:${scale}">
    <div class="mhub-title">🎯 Mini Games</div>
    ${rows <= 2 ? `<div class="mhub-sub">${next ? "Win points for your team!" : "That's all of them — great playing!"}</div>` : ""}
    <div class="mcards">${M.list.map((g, i) => {
      const r = resultBits(G, g);
      const tag = r ? `<div class="mc-status ${r.cls}">${esc(r.text)}${r.pts ? ` <b>${r.pts}</b>` : ""}</div>`
        : g.status === "active" ? `<div class="mc-status live">▶ In progress</div>`
        : next && next.id === g.id ? `<div class="mc-status next">Up next</div>` : `<div class="mc-status"></div>`;
      return `<div class="${cls("mcard", g.status, r && "w-" + r.cls, opts.pick && "pick")}" data-key="mc-${esc(g.id)}"${opts.pick ? ` ${actAttr("miniPlay", { id: g.id })} role="button" tabindex="0"` : ""}>
        <div class="mc-num">${i + 1}</div>
        <div class="mc-name">${esc(g.name)}</div>
        <div class="mc-meta">${typeLabel(g)} · ${money(g.points)}${g.type === "h2h" && g.award === "match" ? " a win" : ""}</div>
        ${tag}
      </div>`;
    }).join("")}</div>
  </div>`;
}

function gameHead(M, g, G = null) {
  return `<div class="mg-kicker">${esc(kicker(M, g))}</div>
    <div class="${cls("mg-title", g.name.length > 24 && "long")}">${esc(g.name)}</div>
    ${g.desc ? `<div class="mg-desc">${esc(g.desc)}</div>` : ""}
    ${G ? clockBox(G, g) : ""}`;
}

// Several tables playing the same game at once: one card per table.
function tableCards(G, g, items) {
  const used = items.map((x) => x.table);
  const cards = items.map((x) => {
    const it = pickOf(G.S, x.id);
    const sum = !itemSpinning(G, it) ? itemSummon(it) : "";
    const who = g.type === "h2h"
      ? `<div class="tc-vs"><span class="team1">${x.p1 ? spin(reel(G, g, "team1", x.p1.name), x.p1.name, x.p1.at, "tspin") : esc(tn(G, "team1"))}</span><i>vs</i><span class="team2">${x.p2 ? spin(reel(G, g, "team2", x.p2.name), x.p2.name, x.p2.at, "tspin") : esc(tn(G, "team2"))}</span></div>`
      : `<div class="tc-vs solo ${x.team}">${spin(reel(G, g, null, x.name), x.name, x.at, "tspin")}<small>${esc(tn(G, x.team))}</small></div>`;
    return `<div class="tcard" data-key="tc-${esc(x.id)}"><div class="tc-name">📍 ${esc(x.table || "")}</div>${who}${sum ? `<div class="tc-sum">${esc(sum)}</div>` : ""}</div>`;
  });
  for (const t of freeTables(G, g, used)) cards.push(`<div class="tcard free" data-key="tc-free-${esc(t)}"><div class="tc-name">📍 ${esc(t)}</div><div class="tc-free">Free — next draw 🎲</div></div>`);
  return `<div class="tcards n${Math.min(cards.length, 4)}">${cards.join("")}</div>`;
}
const multiTable = (G, g, items) => items.length > 1 || (items.length && E.miniSlots(G.S, g).length > 1);

function h2hView(G, M, g) {
  const st = E.miniStanding(g);
  const open = E.openMatches(g);
  const m = E.openMatch(g);
  if (multiTable(G, g, open)) {
    const past = g.matches.filter((x) => x.winner).slice(-5).reverse();
    return `<div class="mgame" data-key="mg-${esc(g.id)}">
      ${gameHead(M, g, G)}
      ${tableCards(G, g, open)}
      <div class="tally">
        <span class="t team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span>
        <span class="t-sep">–</span>
        <span class="t team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span>
      </div>
      <div class="mhistory">${past.map((x) => matchChip(G, x)).join("")}</div>
    </div>`;
  }
  const side = (team, p) => `<div class="vs-side ${team}" data-key="vs-${team}-${p ? esc(p.id) + "-" + p.at : "none"}">
      <small>${esc(tn(G, team))}</small>
      ${p ? spin(reel(G, g, team, p.name), p.name, p.at) : `<span class="spin">${esc(tn(G, team))}</span>`}
    </div>`;
  const center = m
    ? `<div class="versus" data-key="match-${esc(m.id)}">${side("team1", m.p1)}<div class="vs-mid">VS</div>${side("team2", m.p2)}</div>`
    : `<div class="mg-wait" data-key="wait-${g.matches.length}">${g.matches.length ? "Who's up next? 🎲" : "Who's up first? 🎲"}</div>`;
  const past = g.matches.filter((x) => x.winner).slice(-5).reverse();
  return `<div class="mgame" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g, G)}
    ${center}
    ${m ? summonBanner(G) : ""}
    <div class="tally">
      <span class="t team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span>
      <span class="t-sep">–</span>
      <span class="t team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span>
    </div>
    <div class="mhistory">${past.map((x) => matchChip(G, x)).join("")}${st.wins.ties ? `<span class="mchip tie">${st.wins.ties} tied</span>` : ""}</div>
  </div>`;
}

function bestView(G, M, g) {
  const st = E.miniStanding(g);
  const turns = E.turnsOf(g);
  const t = turns[0] || null;
  const multi = multiTable(G, g, turns);
  const up = t
    ? `<div class="upnext ${t.team}" data-key="turn-${esc(t.id)}"><small>Up now</small>${spin(reel(G, g, null, t.name), t.name, t.at)}<em>${esc(tn(G, t.team))}</em></div>`
    : `<div class="upnext idle" data-key="idle-${g.entries.length}"><small>${g.entries.length ? "Next up" : "First up"}</small><span class="spin">🎲</span><em>${g.better === "low" ? "Lowest" : "Highest"} score wins</em></div>`;
  const rows = st.sorted.slice(0, 8).map((e, i) =>
    `<div class="${cls("lb-row", e.team, i === 0 && "top")}" data-key="lb-${esc(e.id)}"><span class="lb-n">${i === 0 ? "👑" : i + 1}</span><span class="lb-name">${esc(e.name)}</span><span class="lb-team">${esc(tn(G, e.team))}</span><b class="lb-score">${scoreText(g, e.score)}</b></div>`).join("");
  return `<div class="mgame mgame--best" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g, G)}
    <div class="best-cols">
      <div class="upcol">${multi ? tableCards(G, g, turns) : up + (t ? summonBanner(G) : "")}</div>
      <div class="lboard" style="--rows:${Math.max(3, Math.min(8, st.sorted.length))}"><div class="lb-head">Leaderboard${st.sorted.length > 8 ? ` <small>top 8 of ${st.sorted.length}</small>` : ""}</div>${rows || `<div class="lb-empty">No scores yet</div>`}</div>
    </div>
  </div>`;
}

function resultView(G, g) {
  const r = g.result || { winner: "none", team1: 0, team2: 0 };
  const st = E.miniStanding(g);
  const title = r.winner === "tie" ? "🤝 It's a tie!" : r.winner === "none" ? "No winner this time"
    : `🏆 ${esc(tn(G, r.winner))} ${verb(tn(G, r.winner), "wins", "win")}!`;
  let pts = "";
  if (g.award === "match" && (r.team1 || r.team2)) pts = E.TEAMS.map((t) => `${esc(tn(G, t))} +${money(r[t])}`).join(" · ");
  else if (r.winner === "tie" && r.team1) pts = `+${money(r.team1)} each`;
  else if (E.TEAMS.includes(r.winner) && r[r.winner]) pts = `+${money(r[r.winner])}`;
  const detail = g.type === "h2h"
    ? (g.matches.length ? `${esc(tn(G, "team1"))} ${st.wins.team1} – ${st.wins.team2} ${esc(tn(G, "team2"))}` : "")
    : (st.sorted[0] ? `Best: ${esc(st.sorted[0].name)} — ${scoreText(g, st.sorted[0].score)}` : "");
  return `<div class="mresult w-${r.winner}" data-key="mr-${esc(g.id)}">
    <div class="mr-kicker">${esc(g.name)}</div>
    <div class="mr-title">${title}</div>
    ${pts ? `<div class="mr-points">${pts}</div>` : ""}
    ${detail ? `<div class="mr-detail">${detail}</div>` : ""}
  </div>`;
}

// =====================================================================
// Host: what to do next (shared by the console dock and the phone remote)
// =====================================================================
// Any game in progress can be un-started: back to "Not played yet" and the games list.
export function miniSteps(G, opts = {}) {
  const out = gameSteps(G, opts);
  const g = currentGame(E.minisOf(G.S));
  if (g && g.status === "active") {
    timerSteps(G, g, out);
    out.buttons.push({ label: "↶ Undo start", action: "mini-unstart", params: { id: g.id }, kind: "ghost", key: "" });
  }
  return out;
}
// ⏱ The game clock — one for the whole game, whatever is happening at the tables.
function timerSteps(G, g, out) {
  if (!g.timed) return;
  const c = E.miniClock(g);
  const running = c && G.now() < c.endsAt;
  const act = (name) => ({ name, p: { id: g.id } });
  if (running) {
    out.status += `<div class="timerline running">⏱ <span class="cd" data-deadline="${c.endsAt}" data-format="ms">${esc(mmss(c.endsAt - G.now()))}</span> left <span class="muted">— every table is playing to this clock</span></div>`;
    out.buttons.push({ label: "⏹ Stop the timer", action: "act", params: act("miniTimerStop"), kind: "ghost", key: "K" });
  } else {
    if (c) out.status += `<div class="timerline up">📣 Time's up! <span class="muted">— the horn sounded on every screen</span></div>`;
    out.buttons.push({ label: `⏱ ${c ? "Restart" : "Start"} the timer <small>(${timerLabel(g)})</small>`, action: "act", params: act("miniTimerStart"), kind: c ? "ghost" : "primary", key: "K" });
  }
}
// Has this game given out results (so undoing it needs a confirm)?
export const miniHasResults = (g) => !!g && ((g.matches || []).some((m) => m.winner) || (g.entries || []).length > 0);
function gameSteps(G, { privateView = false } = {}) {
  const S = G.S;
  const M = E.minisOf(S);
  const B = [];
  let status = "";
  let panel = "";
  let wantFirstPick = false;
  const btn = (label, action, params = {}, kind = "ghost", key = "") => B.push({ label, action, params, kind, key });
  const act = (name, p = {}) => ({ name, p });
  const g = currentGame(M);
  const hasClues = E.boardClues(G.Q, 1).length > 0;
  const jeopardy = (primary) => {
    const kind = primary ? "primary" : "ghost";
    const key = primary ? "Space" : "";
    if (M.back === "board") btn("↩ Back to Jeopardy", "act", act("minisEnd"), kind, key);
    else if (hasClues && S.jStarted) btn("▶ Resume Jeopardy", "act", act("startGame"), kind, key);
    else if (hasClues && primary) btn("▶ Start Jeopardy!", "act", act("startGame", { control: G.ui.firstPick || "random" }), kind, key);
    else if (hasClues) btn("Skip to Jeopardy", "confirm", { what: "startGame" }, kind, key);
    else btn("📥 Load Jeopardy questions", "drawer", { tab: "questions" }, kind, key);
  };

  // ---- the list of games ----
  if (!g) {
    const done = M.list.filter((x) => x.status === "done").length;
    const next = M.list.find((x) => x.status === "active") || M.list.find((x) => x.status === "pending");
    if (!M.list.length) {
      status = "No mini games yet — add a few, or head straight to Jeopardy.";
      btn("🎯 Add mini games", "drawer", { tab: "minis" }, "primary", "Space");
      jeopardy(false);
    } else if (next) {
      status = `<b>${done}</b> of <b>${M.list.length}</b> played. Next up: <b>${esc(next.name)}</b> <span class="muted">${typeLabel(next)} · ${money(next.points)}</span>`;
      btn(`▶ ${next.status === "active" ? "Continue" : "Play"} “${esc(next.name)}”`, "act", act("miniPlay", { id: next.id }), "primary", "Space");
      jeopardy(false);
      btn("✏️ Edit mini games", "drawer", { tab: "minis" });
    } else {
      status = "All the mini games are done! 🎉";
      wantFirstPick = M.back !== "board" && hasClues;
      jeopardy(true);
      btn("✏️ Edit mini games", "drawer", { tab: "minis" });
    }
    if (M.back !== "board") btn("↩ Back to lobby", "act", act("leaveMinis"));
    return { status, panel, buttons: B, wantFirstPick };
  }

  // ---- a finished game ----
  if (g.status === "done") {
    const r = resultBits(G, g);
    status = `<b>${esc(g.name)}</b> — ${esc(r.text)}${r.pts ? ` <b>${r.pts}</b>` : ""}`;
    btn("↩ Back to the mini games", "act", act("miniClose"), "primary", "Space");
    return { status, panel, buttons: B };
  }

  const st = E.miniStanding(g);
  const spinning = isSpinning(G); // the host's screen shuffles the names too
  const everyone = E.miniEveryonePlayed(g, G.P);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];

  // ---- blind drawing ----
  if (isDraw(g)) return drawSteps(G, g, { btn, act, B, st, n1, n2 });

  // ---- head-to-head ----
  if (g.type === "h2h") {
    const tally = `${esc(n1)} <b>${st.wins.team1}</b> – <b>${st.wins.team2}</b> ${esc(n2)}`;
    const open = E.openMatches(g);
    const m = open[0] || null;
    const free = canDrawMore(G, g, open) ? freeTables(G, g, open.map((x) => x.table)) : [];
    if (m && multiTable(G, g, open)) {
      // Several tables at once: a row of controls per table.
      status = `<b>${esc(g.name)}</b> · ${open.length} table${open.length === 1 ? "" : "s"} playing · ${tally}`;
      panel = `<div class="trows">${open.map((x) => {
        const a = x.p1 ? x.p1.name : n1, b = x.p2 ? x.p2.name : n2;
        const it = pickOf(G.S, x.id);
        if (itemSpinning(G, it)) return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b><span class="hspins">🎲 ${x.p1 ? spin(reel(G, g, "team1", a), a, x.p1.at, "hspin") : esc(a)} <i>vs</i> ${x.p2 ? spin(reel(G, g, "team2", b), b, x.p2.at, "hspin") : esc(b)}</span></div>`;
        const win = (w, label, k) => `<button class="btn sm ${k}" ${actAttr("miniMatch", { id: g.id, matchId: x.id, winner: w })}>${label}</button>`;
        return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b>
          <span class="tr-who">${esc(a)} <i>vs</i> ${esc(b)}</span>
          <span class="tr-btns">${win("team1", `🏆 ${esc(a)}`, "t1")}${win("team2", `🏆 ${esc(b)}`, "t2")}${win("tie", "🤝", "ghost")}
          <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, matchId: x.id })} title="Draw two different players">🎲</button>
          <button class="btn ghost sm" data-action="mini-row-edit" data-id="${esc(x.id)}" aria-expanded="${!!editing(G, x.id)}">✏️</button></span>
          ${editing(G, x.id) ? `<span class="tr-swap">${E.TEAMS.map((t) => (G.P.some((p) => p.team === t) ? playerSelect(G, g, t, ((t === "team1" ? x.p1 : x.p2) || {}).id || "", x.id) : "")).join("")}${tableMove(G, g, x)}</span>` : ""}</div>`;
      }).join("")}</div>`;
      panel += tableControls(G, g, open);
      if (free.length) btn(`🎲 Draw for ${free.length === 1 ? free[0] : `${free.length} free tables`}`, "act", act("miniNext", { id: g.id }), "primary", "Space");
      btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, free.length ? "ghost" : "primary", free.length ? "" : "");
      btn("↩ Games list", "act", act("miniClose"));
    } else if (m) {
      const a = m.p1 ? m.p1.name : n1;
      const b = m.p2 ? m.p2.name : n2;
      if (spinning) {
        status = `<span class="hspins">🎲 ${m.p1 ? spin(reel(G, g, "team1", a), a, m.p1.at, "hspin") : esc(a)} <i>vs</i> ${m.p2 ? spin(reel(G, g, "team2", b), b, m.p2.at, "hspin") : esc(b)}</span> <span class="muted">${tally}</span>`;
      } else {
        status = `<b>${esc(a)}</b> vs <b>${esc(b)}</b>${m.table ? ` at <b>${esc(m.table)}</b>` : ""} — who won? <span class="muted">${tally}</span>`;
        btn(`🏆 ${esc(a)}`, "act", act("miniMatch", { id: g.id, winner: "team1" }), "t1", "1");
        btn(`🏆 ${esc(b)}`, "act", act("miniMatch", { id: g.id, winner: "team2" }), "t2", "2");
        btn("🤝 Tie", "act", act("miniMatch", { id: g.id, winner: "tie" }), "ghost", "T");
        panel = `<div class="mpanel"><span class="muted">Swap a player:</span>${E.TEAMS.map((t) => sidePicker(G, g, t, t === "team1" ? m.p1 : m.p2)).join("")}</div>${tablePicker(G, g, m.table)}`;
      }
    } else {
      const played = g.matches.length;
      const slots = E.miniSlots(G.S, g).filter((t) => t !== null);
      status = `<b>${esc(g.name)}</b> · ${tally}${st.wins.ties ? ` · ${st.wins.ties} tied` : ""}${everyone ? ` <span class="muted">Everyone's had a turn.</span>` : ""}`;
      const label = slots.length > 1 ? `🎲 Draw for all ${slots.length} tables` : played ? "🎲 Next matchup" : "🎲 Who's up first?";
      btn(label, "act", act("miniNext", { id: g.id }), everyone ? "ghost" : "primary", everyone ? "" : "Space");
      btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, everyone ? "primary" : "ghost", everyone ? "Space" : "");
      btn("↩ Games list", "act", act("miniClose"));
      if (played) {
        panel = `<div class="mpanel wrap"><span class="muted">Results:</span>${g.matches.filter((x) => x.winner).map((x) =>
          `<span class="echip">${matchChip(G, x)}<button class="x" title="Remove this result" ${actAttr("miniMatchRemove", { id: g.id, matchId: x.id })}>✕</button></span>`).join("")}</div>`;
      }
      panel += tableControls(G, g, []);
    }
    return { status, panel, buttons: B };
  }

  // ---- best overall ----
  const top = st.sorted[0];
  const leaderTxt = top ? `Best so far: <b>${esc(top.name)}</b> <span class="muted">(${esc(tn(G, top.team))})</span> ${scoreText(g, top.score)}` : `${g.better === "low" ? "Lowest" : "Highest"} score wins.`;
  const turns = E.turnsOf(g);
  const freeB = canDrawMore(G, g, turns) ? freeTables(G, g, turns.map((x) => x.table)) : [];
  if (turns.length && multiTable(G, g, turns)) {
    status = `<b>${esc(g.name)}</b> · ${turns.length} table${turns.length === 1 ? "" : "s"} playing · <span class="muted">${leaderTxt}</span>`;
    panel = `<div class="trows">${turns.map((x) => {
      const it = pickOf(G.S, x.id);
      if (itemSpinning(G, it)) return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b><span class="hspins">🎲 ${spin(reel(G, g, null, x.name), x.name, x.at, "hspin")}</span></div>`;
      return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b>
        <span class="tr-who ${x.team}">${esc(x.name)} <small class="muted">${esc(tn(G, x.team))}</small></span>
        <span class="tr-btns"><label class="score-box sm"><input id="mini-score-${esc(x.id)}" class="wager-input" type="number" step="any" inputmode="decimal" placeholder="Score" autocomplete="off" data-sticky>${g.unit ? `<span>${esc(g.unit)}</span>` : ""}</label>
        <button class="btn primary sm" data-action="mini-score" data-p="${J({ id: g.id, turnId: x.id })}">✓ Save</button>
        <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, turnId: x.id })} title="Draw someone else">🎲</button>
        <button class="btn ghost sm" data-action="mini-row-edit" data-id="${esc(x.id)}" aria-expanded="${!!editing(G, x.id)}">✏️</button></span>
        ${editing(G, x.id) ? `<span class="tr-swap">${playerSelect(G, g, null, x.pid, x.id)}${tableMove(G, g, x)}</span>` : ""}</div>`;
    }).join("")}</div>`;
    panel += tableControls(G, g, turns);
    if (freeB.length) btn(`🎲 Draw for ${freeB.length === 1 ? freeB[0] : `${freeB.length} free tables`}`, "act", act("miniNext", { id: g.id }), "primary", "Space");
    btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, "ghost", "");
    btn("↩ Games list", "act", act("miniClose"));
  } else if (g.turn) {
    if (spinning) {
      status = `<span class="hspins">🎲 ${spin(reel(G, g, null, g.turn.name), g.turn.name, g.turn.at, "hspin")}</span> <span class="muted">${leaderTxt}</span>`;
    } else {
      status = `<b>${esc(g.turn.name)}</b> <span class="muted">(${esc(tn(G, g.turn.team))})</span> is up${g.turn.table ? ` at <b>${esc(g.turn.table)}</b>` : ""} — type their score. <span class="muted">${leaderTxt}</span>`;
      btn("✓ Save score", "mini-score", { id: g.id }, "primary", "Space");
      panel = `<div class="mpanel">
        <label class="score-box"><input id="mini-score" class="wager-input" type="number" step="any" inputmode="decimal" placeholder="Score" autocomplete="off" data-sticky>${g.unit ? `<span>${esc(g.unit)}</span>` : ""}</label>
        <span class="mside"><span class="muted">Swap player:</span>${playerSelect(G, g, null, g.turn.pid)}<button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id })} title="Draw someone else">🎲 Someone else</button></span>
      </div>${tablePicker(G, g, g.turn.table)}`;
    }
  } else {
    status = `<b>${esc(g.name)}</b> · ${leaderTxt}${everyone ? ` <span class="muted">Everyone's had a turn.</span>` : ""}`;
    const slotsB = E.miniSlots(G.S, g).filter((t) => t !== null);
    btn(slotsB.length > 1 ? `🎲 Draw for all ${slotsB.length} tables` : g.entries.length ? "🎲 Who's next?" : "🎲 Who's up first?", "act", act("miniNext", { id: g.id }), everyone ? "ghost" : "primary", everyone ? "" : "Space");
    btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, everyone ? "primary" : "ghost", everyone ? "Space" : "");
    btn("↩ Games list", "act", act("miniClose"));
    if (g.entries.length) {
      panel = `<div class="mpanel wrap"><span class="muted">Scores:</span>${st.sorted.map((e) =>
        `<span class="echip"><span class="mchip ${e.team}"><b>${esc(e.name)}</b> ${scoreText(g, e.score)}</span><button class="x" title="Remove this score" ${actAttr("miniEntryRemove", { id: g.id, entryId: e.id })}>✕</button></span>`).join("")}</div>`;
    }
    panel += tableControls(G, g, []);
  }
  return { status, panel, buttons: B };
}

const editing = (G, id) => G.ui.miniEdit && G.ui.miniEdit[id];
// Move one table's matchup / player to another table (swaps with whoever is there).
function tableMove(G, g, x) {
  const tables = E.minisTables(G.S);
  if (tables.length < 2) return "";
  return `<select class="msel" data-change="mini-move" data-id="${esc(g.id)}" data-ref="${esc(x.id)}" aria-label="Move to table">${tables.map((t) => `<option value="${esc(t)}"${t === x.table ? " selected" : ""}>📍 ${esc(t)}</option>`).join("")}</select>`;
}
// Which table to send the drawn player(s) to — right in the mini-game controls.
function tablePicker(G, g, current) {
  const tables = E.minisTables(G.S);
  if (!tables.length) return "";
  return `<div class="mpanel wrap tablepick"><span class="muted">📍 Send them to:</span>${tables.map((t) =>
    `<button class="${cls("chipbtn", t === current && "on")}" ${actAttr("miniSetTable", { id: g.id, table: t })} aria-pressed="${t === current}">${t === current ? "✓ " : ""}${esc(t)}</button>`).join("")}</div>`;
}

// Add / remove tables, right where you draw who's up next. A table someone is
// playing at can't be removed until it's free.
function tableControls(G, g, items) {
  const tables = E.minisTables(G.S);
  const busy = new Set(items.map((x) => x.table).filter(Boolean));
  const chips = tables.map((t) => `<span class="echip tchip" data-key="tb-${esc(t)}"><span class="mchip">📍 ${esc(t)}</span>${busy.has(t) ? "" : `<button class="x" title="Remove ${esc(t)}" aria-label="Remove ${esc(t)}" ${actAttr("miniTableRemove", { table: t })}>✕</button>`}</span>`).join("");
  const add = tables.length < 8 ? `<button class="btn ghost sm" data-key="tb-add" ${actAttr("miniTableAdd", {})}>+ Add table</button>` : "";
  return `<div class="mpanel wrap tablectl" data-key="tablectl"><span class="muted">${tables.length ? `Playing at ${tables.length} tables at once:` : "📍 Playing at one table."}</span>${chips}${add}</div>`;
}

function playerSelect(G, g, team, selectedId, ref = "") {
  const list = G.P.filter((p) => !team || p.team === team);
  const opt = (p) => `<option value="${esc(p.id)}"${p.id === selectedId ? " selected" : ""}>${esc(p.name)}${team ? "" : " — " + esc(tn(G, p.team))}</option>`;
  return `<select class="msel" data-change="mini-player" data-id="${esc(g.id)}"${team ? ` data-team="${team}"` : ""}${ref ? ` data-ref="${esc(ref)}"` : ""} aria-label="Choose who's up">${list.map(opt).join("")}</select>`;
}
function sidePicker(G, g, team, p) {
  const has = G.P.some((x) => x.team === team);
  if (!has) return `<span class="mside ${team}"><span class="dot ${team}"></span><span class="muted">No ${esc(tn(G, team))} have joined — just pick the winner</span></span>`;
  return `<span class="mside ${team}"><span class="dot ${team}"></span>${playerSelect(G, g, team, p ? p.id : "")}
    <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, team })} title="Draw a different player">🎲</button></span>`;
}

// =====================================================================
// Dialogs
// =====================================================================
export function miniModal(G, m) {
  const g = E.miniById(G.S, m.id);
  if (!g) return "";
  const wrap = (inner) => `<div class="modal-scrim" data-action="modal-close"></div><div class="modal" role="dialog">${inner}</div>`;
  const cancel = (label = "Cancel") => `<button class="btn ghost" data-action="modal-close">${label}</button>`;
  if (m.type === "miniDrawPic") {
    return `<div class="modal-scrim"></div><div class="modal drawmodal" role="dialog">
      <h3>✏️ Draw a picture for “${esc(g.name)}”</h3>
      <p class="muted small">Keep it Christmassy and simple (finger-sized shapes). The big screen only shows “Step 2 of 4” for a picture you draw yourself — you describe each step out loud — so plan your steps as you draw.</p>
      <div class="padbox" data-keep data-key="padbox-ref-${esc(g.id)}"><canvas class="drawpad" data-pad="ref-${esc(g.id)}"></canvas></div>
      <label class="xf stepsfield"><span>How many steps will you describe? <small>required</small></span><input id="draw-pic-steps" type="number" inputmode="numeric" min="1" max="10" placeholder="e.g. 3" data-sticky></label>
      <div class="btnrow end"><button class="btn ghost" data-action="pad-clear" data-pad="ref-${esc(g.id)}">Start over</button>${cancel()}<button class="btn primary" data-action="draw-pic-save" data-id="${esc(g.id)}">Save picture</button></div>
    </div>`;
  }
  if (m.type === "miniDrawGallery") {
    const have = new Set(g.pics || []);
    return wrap(`<h3>🎄 Ready-made Christmas drawings</h3>
      <p class="muted small">Each one is built up step by step on the big screen, with an example of what the drawing should look like so far. Tap to add or remove.</p>
      <div class="gallery">${PICTURES.map((p) => {
        const id = BUILTIN + p.key, on = have.has(id);
        return `<button class="${cls("gpic", on && "on")}" data-action="draw-builtin-toggle" data-id="${esc(g.id)}" data-pic="${esc(id)}" aria-pressed="${on}">
          ${Dr.svg(p.steps.flatMap((s) => s.strokes), "thumb")}<b>${esc(p.name)}</b><small>${p.steps.length} steps</small><em>${on ? "✓ Added" : "+ Add"}</em></button>`;
      }).join("")}</div>
      <div class="btnrow end">${cancel("Done")}</div>`, true);
  }
  if (m.type === "miniUnstart") {
    return wrap(`<h3>Undo starting “${esc(g.name)}”?</h3><p>It goes back to <b>Not played yet</b>: its results are cleared and any points it gave out are taken back.</p>
      <div class="btnrow end">${cancel("Keep playing")}<button class="btn bad" ${actAttr("miniReset", { id: g.id }, { then: "modal" })}>↶ Undo start</button></div>`);
  }
  if (m.type === "miniDrawCancel") {
    return wrap(`<h3>Undo this round?</h3><p>Everyone's drawing so far is thrown away and it's as if the round never started. The same picture is used next time.</p>
      <div class="btnrow end">${cancel("Keep drawing")}<button class="btn bad" ${actAttr("miniDrawCancel", { id: g.id, matchId: m.matchId }, { then: "modal" })}>Undo round</button></div>`);
  }
  if (m.type === "miniReset") {
    return wrap(`<h3>Reset “${esc(g.name)}”?</h3><p>Its results are cleared and any points it gave out are taken back.</p>
      <div class="btnrow end">${cancel()}<button class="btn primary" ${actAttr("miniReset", { id: g.id }, { then: "modal" })}>Reset game</button></div>`);
  }
  if (m.type === "miniRemove") {
    return wrap(`<h3>Delete “${esc(g.name)}”?</h3><p>The game is removed from the list. Points already awarded stay on the scoreboard.</p>
      <div class="btnrow end">${cancel()}<button class="btn bad" ${actAttr("miniRemove", { id: g.id }, { then: "modal" })}>Delete game</button></div>`);
  }
  // Finish: confirm (or overrule) the winner.
  const st = E.miniStanding(g);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];
  const summary = g.type === "h2h"
    ? (g.matches.some((x) => x.winner) ? `${esc(n1)} <b>${st.wins.team1}</b> – <b>${st.wins.team2}</b> ${esc(n2)}${st.wins.ties ? ` (${st.wins.ties} tied)` : ""}` : "No matchups were recorded — just pick who won.")
    : (st.sorted[0] ? `Best score: <b>${esc(st.sorted[0].name)}</b> (${esc(tn(G, st.sorted[0].team))}) — ${scoreText(g, st.sorted[0].score)}` : "No scores were recorded — just pick who won.");
  if (g.award === "match") {
    return wrap(`<h3>Finish “${esc(g.name)}”?</h3><p>${summary}</p><p class="muted">Points were already given for each matchup win.</p>
      <div class="btnrow end">${cancel("Keep playing")}<button class="btn primary" ${actAttr("miniFinish", { id: g.id }, { then: "modal" })}>🏁 Finish game</button></div>`);
  }
  const half = Math.round(g.points / 2);
  const opt = (winner, label, kind) => {
    const lead = st.leader === winner;
    return `<button class="${cls("btn", kind, "big", lead && "suggested")}" ${actAttr("miniFinish", { id: g.id, winner }, { then: "modal" })}>${label}${lead ? ` <small>★ ${winner === "tie" ? "level" : "leading"}</small>` : ""}</button>`;
  };
  return wrap(`<h3>Who won “${esc(g.name)}”?</h3><p>${summary}</p>
    <div class="finish-opts">
      ${opt("team1", `🏆 ${esc(n1)} · +${money(g.points)}`, "t1")}
      ${opt("team2", `🏆 ${esc(n2)} · +${money(g.points)}`, "t2")}
      ${opt("tie", `🤝 Tie · +${money(half)} each`, "ghost")}
      ${opt("none", "No winner · no points", "ghost")}
    </div>
    <div class="btnrow end">${cancel("Keep playing")}</div>`);
}

// =====================================================================
// Settings → Mini games
// =====================================================================
export function minisTab(G) {
  const M = E.minisOf(G.S);
  const [n1, n2] = [tn(G, "team1"), tn(G, "team2")];
  const field = (g, f) => `data-change="mini-field" data-id="${esc(g.id)}" data-f="${f}" data-key="mf-${esc(g.id)}-${f}"`;
  const cards = M.list.map((g, i) => {
    const r = resultBits(G, g);
    const started = g.status !== "pending" || g.matches.length || g.entries.length;
    const state = r ? `<span class="ms ${r.cls}">${esc(r.text)}${r.pts ? " " + r.pts : ""}</span>` : g.status === "active" ? `<span class="ms live">In progress</span>` : `<span class="ms">Not played yet</span>`;
    return `<div class="minicard" data-key="mini-${esc(g.id)}">
      <div class="mini-row">
        <span class="mini-num">${i + 1}</span>
        <input class="grow" value="${esc(g.name)}" maxlength="40" aria-label="Game name" ${field(g, "name")}>
        <button class="btn ghost sm" ${actAttr("miniMove", { id: g.id, dir: -1 })}${i === 0 ? " disabled" : ""} title="Move up">▲</button>
        <button class="btn ghost sm" ${actAttr("miniMove", { id: g.id, dir: 1 })}${i === M.list.length - 1 ? " disabled" : ""} title="Move down">▼</button>
        <button class="btn bad sm" data-action="mini-remove" data-id="${esc(g.id)}" title="Delete">✕</button>
      </div>
      <div class="mini-row">
        <select aria-label="Type of game" ${field(g, "type")}${started ? " disabled" : ""}>
          <option value="h2h"${g.type === "h2h" ? " selected" : ""}>⚔️ Head-to-head</option>
          <option value="best"${g.type === "best" ? " selected" : ""}>🏅 Best overall</option>
        </select>
        <label class="pts"><span>$</span><input type="number" inputmode="numeric" min="0" step="50" value="${g.points}" aria-label="Points" ${field(g, "points")}></label>
      </div>
      <div class="mini-row">${g.type === "h2h"
        ? `<select class="grow" aria-label="How points are won" ${field(g, "award")}${started ? " disabled" : ""}>
             <option value="game"${g.award === "game" ? " selected" : ""}>Points go to the team that wins the game</option>
             <option value="match"${g.award === "match" ? " selected" : ""}>Points for every matchup win</option>
           </select>`
        : isDraw(g)
        ? ""
        : `<select aria-label="Which score wins" ${field(g, "better")}>
             <option value="high"${g.better === "high" ? " selected" : ""}>Highest score wins</option>
             <option value="low"${g.better === "low" ? " selected" : ""}>Lowest wins (fastest time)</option>
           </select>
           <input class="unit" value="${esc(g.unit)}" maxlength="16" placeholder="unit, e.g. seconds" aria-label="Unit" ${field(g, "unit")}>`}
      </div>
      ${isDraw(g) ? "" : `<div class="mini-row timerrow">
        <label class="timertick"><input type="checkbox"${g.timed ? " checked" : ""} data-change="mini-timed" data-id="${esc(g.id)}" data-key="mf-${esc(g.id)}-timed"><span>⏱ Timer</span></label>
        ${g.timed ? `<label class="pts secs"><input type="number" inputmode="numeric" min="5" max="3600" value="${g.seconds}" aria-label="Seconds on the clock" ${field(g, "seconds")}><span>seconds <small>(${timerLabel(g)})</small></span></label>` : `<span class="muted small">Tick it for a game played against the clock</span>`}
      </div>`}
      ${g.type === "best" ? `<label class="mini-row drawtick"><input type="checkbox"${isDraw(g) ? " checked" : ""}${started ? " disabled" : ""} data-change="mini-draw" data-id="${esc(g.id)}" data-key="mf-${esc(g.id)}-draw"><span>✏️ Blind drawing <small>— everyone draws at once, the website scores every drawing, and the best one wins the points for its team</small></span></label>` : ""}
      <textarea class="desc auto" rows="1" maxlength="240" placeholder="How to play (shown on the big screen) — optional" aria-label="How to play" ${field(g, "desc")}>${esc(g.desc)}</textarea>
      <div class="mini-row foot">${state}<span class="grow"></span>
        ${started ? `<button class="btn ghost sm" data-action="mini-reset-ask" data-id="${esc(g.id)}">↺ Reset</button>` : ""}
        ${g.status !== "done" ? `<button class="btn ghost sm" ${actAttr("miniPlay", { id: g.id }, { then: "drawer" })}>▶ Play</button>` : ""}
      </div>
      ${isDraw(g) ? picsBlock(G, g) : ""}
    </div>`;
  }).join("");
  return `
  <section class="sect"><h4>Your mini games <small>${M.list.length ? `(${M.list.length})` : ""}</small></h4>
    ${cards || `<p class="muted">None yet. Mini games are played before Jeopardy and the points count toward each team's score.</p>`}
  </section>
  <section class="sect"><h4>Add a mini game</h4>
    <input id="mini-new-name" class="newname" maxlength="40" placeholder="Name, e.g. Snowball Toss" aria-label="New game name" data-sticky>
    <div class="btnrow add">
      <button class="btn primary sm" data-action="mini-add" data-type="h2h">+ ⚔️ Head-to-head</button>
      <button class="btn primary sm" data-action="mini-add" data-type="best">+ 🏅 Best overall</button>
    </div>
    <ul class="explain">
      <li><b>Head-to-head:</b> one of the ${esc(n1)} faces one of the ${esc(n2)} each round. You tap who won.</li>
      <li><b>Best overall:</b> everyone takes a turn and you type their score. The best score wins it for their team.</li>
      <li>The game draws who's up next at random. Once picked, a player is out of the pool until everyone on their team has had a go — and people who haven't played any mini game yet tonight go first.</li>
    </ul>
  </section>
  <section class="sect"><h4>Need ideas? <small>tap to add</small></h4>
    <div class="ideas">${PRESETS.map((p, i) => `<button class="chipbtn" data-action="mini-preset" data-i="${i}" title="${esc(p.desc)}">${p.mode === "draw" ? "✏️" : p.type === "h2h" ? "⚔️" : "🏅"} ${esc(p.name)}</button>`).join("")}</div>
  </section>`;
}

// =====================================================================
// Host remote: list of games to start
// =====================================================================
export function remoteMinis(G) {
  const M = E.minisOf(G.S);
  if (G.S.phase !== "minis" || M.current || !M.list.length) return "";
  return `<div class="r-minis">${M.list.map((g, i) => {
    const r = resultBits(G, g);
    return `<button class="${cls("r-mini", g.status)}" ${actAttr("miniPlay", { id: g.id })}>
      <b>${i + 1}. ${esc(g.name)}</b><span>${typeLabel(g)} · ${money(g.points)}</span>
      <em>${r ? esc(r.text) : g.status === "active" ? "In progress ▶" : "Play ▶"}</em></button>`;
  }).join("")}</div>`;
}

// =====================================================================
// Players' phones
// =====================================================================
export function playerMinis(G, extra = "") {
  const S = G.S;
  const me = G.me;
  const M = E.minisOf(S);
  const g = currentGame(M);
  if (!g) {
    const next = M.list.find((x) => x.status === "active") || M.list.find((x) => x.status === "pending");
    return `<div class="ph-card hero"><div class="big-emoji">🎯</div><h2>Mini games!</h2>
      <p>${next ? `Up next: <b>${esc(next.name)}</b>` : M.list.length ? "All done — Jeopardy is next!" : "Jaren is setting things up…"}</p>
      <div class="ph-minis">${M.list.map((x) => {
        const r = resultBits(G, x);
        return `<div class="${cls("ph-mrow", x.status)}" data-key="pm-${esc(x.id)}"><span class="pm-name">${esc(x.name)}</span><span class="pm-meta">${money(x.points)}</span><span class="pm-res ${r ? r.cls : ""}">${r ? esc(r.text) : x.status === "active" ? "▶" : ""}</span></div>`;
      }).join("")}</div>
      ${extra}
    </div>`;
  }
  if (g.status === "done") {
    const r = g.result || { winner: "none" };
    const mine = r.winner === me.team;
    const title = r.winner === "tie" ? "It's a tie!" : r.winner === "none" ? "No winner this time" : mine ? "Your team won!" : `${esc(tn(G, r.winner))} won`;
    const pts = r.winner === "tie" ? (r.team1 ? `+${money(r.team1)} each` : "") : E.TEAMS.includes(r.winner) && r[r.winner] ? `+${money(r[r.winner])}` : "";
    return `<div class="ph-card hero"><div class="big-emoji">${r.winner === "tie" ? "🤝" : mine ? "🏆" : r.winner === "none" ? "🎄" : "😤"}</div>
      <h2>${title}</h2><p><b>${esc(g.name)}</b>${pts ? ` · ${pts}` : ""}</p></div>`;
  }

  const head = `<div class="ph-mini-head"><div class="kicker">${typeLabel(g)} · ${prize(g)}</div><h2>${esc(g.name)}</h2>${g.desc ? `<p>${esc(g.desc)}</p>` : ""}${clockBox(G, g, "ph")}</div>`;
  if (isDraw(g)) return head + drawPhone(G, g);
  const pick = E.currentPick(S);
  const spinning = isSpinning(G);
  const mine = !!pick && pick.pids.includes(G.deviceId);
  const st = E.miniStanding(g);
  let now;
  const myItem = pick ? pick.items.find((x) => x.pids.includes(G.deviceId)) : null;
  if (!pick) now = `<div class="ph-note">Get ready — the next name is about to be drawn! 🎲</div>`;
  else if (spinning) now = `<div class="ph-note drawing">🎲 Drawing who's up…</div>`;
  else if (myItem) {
    // You're up: what you're playing, against whom, and which table to go to.
    const rival = g.type === "h2h" ? (me.team === "team1" ? myItem.names[1] : myItem.names[0]) || tn(G, E.otherTeam(me.team)) : "";
    now = `<div class="youup big">🎯 You're up!<small>${g.type === "h2h" ? `You vs ${esc(rival)}` : `${g.better === "low" ? "Lowest" : "Highest"} score wins`}</small>${tableTag(myItem)}</div>`;
    const sum = itemSummon(myItem);
    if (sum) now += `<div class="ph-summon">${esc(sum)}</div>`;
  } else {
    // Everyone else sees who's playing where.
    now = pick.items.map((x) => {
      const where = x.table ? `<span class="tabletag">📍 ${esc(x.table)}</span>` : "";
      return g.type === "h2h"
        ? `${where}<div class="ph-versus"><span class="team1">${esc(x.names[0] || tn(G, "team1"))}</span><i>vs</i><span class="team2">${esc(x.names[1] || tn(G, "team2"))}</span></div>`
        : `${where}<div class="ph-versus solo"><small>Up now</small><span class="${x.team}">${esc(x.names[0])}</span></div>`;
    }).join("");
  }
  let board;
  if (g.type === "h2h") {
    board = `<div class="ph-tally"><span class="team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span><span>–</span><span class="team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span></div>`;
  } else {
    const my = st.sorted.find((e) => e.pid === G.deviceId);
    board = `<div class="ph-lb">${st.sorted.slice(0, 5).map((e, i) => `<div class="${cls("ph-lbrow", e.team, e.pid === G.deviceId && "me")}" data-key="plb-${esc(e.id)}"><span>${i === 0 ? "👑" : i + 1}</span><span class="grow">${esc(e.name)}</span><b>${scoreText(g, e.score)}</b></div>`).join("") || `<div class="muted">No scores yet</div>`}</div>
      ${my ? `<div class="locked-note">Your score: <b>${scoreText(g, my.score)}</b></div>` : ""}`;
  }
  return `${head}${now}${board}`;
}

// =====================================================================
// Blind drawing
// =====================================================================
function picsBlock(G, g) {
  const pics = g.pics || [];
  const steps = (id) => picTotalSteps(g, id);
  return `<div class="mini-row picrow">
    <span class="muted">Pictures (${pics.length})${pics.length ? ` — used in turn, one per round` : " — add at least one"}</span>
    <div class="pics">${pics.map((id, i) => `<span class="pic" data-key="pic-${esc(id)}">${drawingSvg(G, id, "thumb")}<button class="x" ${actAttr("miniUpdate", { id: g.id, patch: { pics: pics.filter((x) => x !== id) } })} title="Remove this picture">✕</button><small>${i + 1} · ${steps(id)} step${steps(id) === 1 ? "" : "s"}${isBuiltin(id) ? "" : " ✍️"}</small></span>`).join("")}</div>
    <div class="btnrow"><button class="btn primary sm" data-action="draw-gallery" data-id="${esc(g.id)}">🎄 Ready-made drawings</button><button class="btn ghost sm" data-action="draw-pic-new" data-id="${esc(g.id)}">✍️ Draw my own</button></div>
    <label class="pts steps"><span>New step every</span><input type="number" inputmode="numeric" min="5" max="120" value="${g.stepSeconds || 20}" aria-label="Seconds per step" data-change="mini-field" data-id="${esc(g.id)}" data-f="stepSeconds" data-key="mf-${esc(g.id)}-stepSeconds"><span>seconds</span></label>
  </div>`;
}
const picTotalSteps = (g, id) => (builtin(id) ? builtin(id).steps.length : (g.picSteps && g.picSteps[id]) || 1);
// Where a drawing round is: waiting for the host to start, counting down, on step i, or done.
// The last step lasts twice as long, so everyone has time to finish off their drawing.
function drawPhase(G, g, m) {
  if (!m.startedAt) return { stage: "ready" };
  const now = G.now();
  if (now < m.startedAt) return { stage: "countdown", endsAt: m.startedAt };
  const total = picTotalSteps(g, m.pic), ms = (g.stepSeconds || 20) * 1000;
  const i = Math.min(total - 1, Math.floor((now - m.startedAt) / ms));
  const last = i === total - 1;
  const endsAt = m.startedAt + (i + 1) * ms + (last ? ms : 0);
  if (now < endsAt) return { stage: "step", i, total, endsAt, last };
  return { stage: "done", total };
}
const cd = (t) => `<span class="cd" data-deadline="${t}" data-format="s"></span>`;
// The step on the big screen: what to draw now, and (for ready-made pictures) what the
// drawing should look like so far.
function stepPanel(G, g, m, size = "") {
  const ph = drawPhase(G, g, m);
  const pic = builtin(m.pic);
  if (ph.stage === "ready") return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-ready"><div class="sp-text"><div class="sp-big">Get ready! 🎄</div><div>Everyone: phone on top of your head, eyes on this screen.</div></div></div>`;
  if (ph.stage === "countdown") return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-cd"><div class="sp-text"><div class="sp-big">Starting in ${cd(ph.endsAt)}</div><div>Phones on top of your heads!</div></div></div>`;
  if (ph.stage === "done") return `<div class="steppanel ${size} done" data-key="sp-${esc(m.id)}-done"><div class="sp-text"><div class="sp-big">✋ Pencils down!</div><div>Drawings are on their way to the judge…</div></div>${pic ? Dr.svgSteps(pic.steps, pic.steps.length - 1, "example") : ""}</div>`;
  const text = pic ? pic.steps[ph.i].text : "Listen to Jaren!";
  return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-${ph.i}">
    ${pic ? Dr.svgSteps(pic.steps, ph.i, "example") : ""}
    <div class="sp-text"><div class="sp-step">Step ${ph.i + 1} of ${ph.total}</div><div class="sp-big">${esc(text)}</div>
      <div class="sp-time">⏱ ${cd(ph.endsAt)}${ph.last ? " left to finish your drawing" : " until the next step"}</div></div>
  </div>`;
}
// Blind drawing is scored like any Best overall game: each team's best drawing so far.
const bestPct = (st, t) => (st.best[t] ? `${st.best[t].score}%` : "—");
const bestWho = (st, t) => (st.best[t] ? st.best[t].name : "");
const roundNo = (g, r) => E.drawRounds(g).findIndex((x) => x.id === r.id) + 1;
const lastRound = (g) => { const rs = E.drawRounds(g); return rs.length ? rs[rs.length - 1] : null; };
const isSent = (G, r, pid) => !!((r.done || {})[pid] || (G.subs || {})[pid] || (pid === G.deviceId && G.sentRounds && G.sentRounds.has(r.id)));
const sentCount = (G, r) => r.drawers.filter((d) => isSent(G, r, d.id)).length;
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
// Everyone in the round, ✓ once their drawing is in.
function drawerChips(G, r) {
  return `<div class="dchips">${r.drawers.map((d) => {
    const sent = isSent(G, r, d.id);
    return `<span class="${cls("dchip", d.team, sent && "sent")}" data-key="dch-${esc(d.id)}">${sent ? "✓" : "✏️"} ${esc(d.name)}</span>`;
  }).join("")}</div>`;
}
// The verdict: the picture, the winner and last place — then everyone's drawing, best first.
function drawVerdict(G, g, r) {
  const ranked = E.drawRanking(r);
  const scored = ranked.filter((d) => d.score != null);
  const best = scored[0] || null;
  const worst = scored.length > 1 ? scored[scored.length - 1] : null;
  if (!best) return `<div class="mg-wait">No drawings were sent this round 🎄</div>`;
  const tie = r.winner === "tie";
  const panel = (d, role, label) => `<div class="dpanel ${role}">
      <div class="dp-label">${label}</div>
      ${drawingSvg(G, subDocId(r.id, d.id))}
      <div class="dp-name ${d.team}">${esc(d.name)} <small>· ${esc(tn(G, d.team))}</small></div>
      <div class="dp-score">${d.score}% match</div></div>`;
  return `<div class="dverdict" data-key="dv-${esc(r.id)}">
    <div class="dpanels n${worst ? 3 : 2}">
      <div class="dpanel ref"><div class="dp-label">The picture</div>${drawingSvg(G, r.pic)}<div class="dp-name">&nbsp;</div><div class="dp-score">&nbsp;</div></div>
      ${panel(best, tie ? "tie" : "win", tie ? "🤝 Tied for best" : "🏆 Winner")}
      ${worst ? panel(worst, "lose", "😬 Last place") : ""}
    </div>
    <div class="dhint">📱 Everyone's drawing is on your phone</div>
  </div>`;
}
// Phones and Jaren's screen: your own drawing first, the whole ranked list, and anyone's
// drawing (or the original picture) at a tap.
function drawBrowser(G, g, r) {
  const ranked = E.drawRanking(r);
  const mine = ranked.find((d) => d.id === G.deviceId);
  const def = mine && mine.sent ? mine.id : ranked[0] && ranked[0].sent ? ranked[0].id : "pic";
  const pick = G.ui.drawPick && G.ui.drawPick.rid === r.id ? G.ui.drawPick.pid : def;
  const sel = ranked.find((d) => d.id === pick) || null;
  const pct = (d) => (d.score == null ? "no drawing" : `${d.score}% match`);
  const title = !sel ? "The picture" : sel.id === G.deviceId ? `Your drawing — ${pct(sel)}` : `${esc(sel.name)}'s drawing — ${pct(sel)}`;
  const view = !sel ? drawingSvg(G, r.pic, "mine") : sel.sent ? drawingSvg(G, subDocId(r.id, sel.id), "mine") : `<div class="drawing mine empty">No drawing sent</div>`;
  const rows = ranked.map((d, i) => `<button class="${cls("dlb-row", d.team, d.id === pick && "on", d.id === G.deviceId && "me")}" data-action="draw-view" data-rid="${esc(r.id)}" data-pid="${esc(d.id)}" data-key="dlb-${esc(d.id)}">
      <span class="dlb-n">${i === 0 && d.score != null ? "🏆" : i + 1}</span><span class="dlb-name">${esc(d.name)}${d.id === G.deviceId ? " <small>(you)</small>" : ""}</span><span class="dlb-team">${esc(tn(G, d.team))}</span><b>${d.score == null ? "—" : d.score + "%"}</b></button>`).join("");
  return `<div class="dbrowse" data-key="db-${esc(r.id)}">
    <div class="mysub"><small>${title}</small>${view}</div>
    <div class="dlb"><div class="dlb-head"><span>Leaderboard</span><small>tap anyone to see their drawing</small>
      <button class="${cls("chipbtn", !sel && "on")}" data-action="draw-view" data-rid="${esc(r.id)}" data-pid="pic">🖼 The picture</button></div>${rows}</div>
  </div>`;
}
function roundChip(G, g, m) {
  const b = E.drawRanking(m)[0];
  return `<span class="mchip ${m.winner}">Round ${roundNo(g, m)}: ${m.winner === "tie" ? "🤝 tie" : `🏆 <b>${esc(b ? b.name : tn(G, m.winner))}</b>${b && b.score != null ? ` ${b.score}%` : ""}`}</span>`;
}
function drawView(G, M, g) {
  const st = E.miniStanding(g);
  const r = E.drawRound(g);
  const last = lastRound(g);
  let main;
  if (r) main = `${stepPanel(G, g, r)}<div class="dstatus" data-key="dst-${esc(r.id)}"><b>Round ${roundNo(g, r)}</b> · ✓ ${sentCount(G, r)} of ${r.drawers.length} drawings sent</div>${drawerChips(G, r)}`;
  else if (last && last.winner) main = `<div class="dstatus"><b>${esc(g.name)} · Round ${roundNo(g, last)}</b> — the website's verdict</div>${drawVerdict(G, g, last)}`;
  else main = `<div class="mg-wait">✏️ Everyone draws at once — right where you're sitting!</div>`;
  const past = E.drawRounds(g).filter((x) => x.winner && (r || x.id !== (last && last.id))).slice(-5).reverse();
  return `<div class="mgame mgame--draw" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g, G)}
    ${main}
    <div class="tally">
      <span class="t team1">${esc(tn(G, "team1"))} <b>${bestPct(st, "team1")}</b>${bestWho(st, "team1") ? `<small>${esc(bestWho(st, "team1"))}</small>` : ""}</span>
      <span class="t-sep">–</span>
      <span class="t team2"><b>${bestPct(st, "team2")}</b>${bestWho(st, "team2") ? `<small>${esc(bestWho(st, "team2"))}</small>` : ""} ${esc(tn(G, "team2"))}</span>
    </div>
    <div class="tally-note">Best drawing of the night wins ${money(g.points)}</div>
    <div class="mhistory">${past.map((x) => roundChip(G, g, x)).join("")}</div>
  </div>`;
}
function drawSteps(G, g, { btn, act, B, st, n1, n2 }) {
  const tally = `best so far: ${esc(n1)} <b>${bestPct(st, "team1")}</b> – <b>${bestPct(st, "team2")}</b> ${esc(n2)}`;
  let status, panel = "";
  const r = E.drawRound(g);
  if (!(g.pics || []).length && !r) {
    status = `<b>${esc(g.name)}</b> needs a picture to describe — add one first.`;
    btn("🎄 Add a picture", "drawer", { tab: "minis" }, "primary", "Space");
    btn("↩ Games list", "act", act("miniClose"));
    return { status, panel, buttons: B };
  }
  const n = E.drawRounds(g).length;
  if (r) {
    const ph = drawPhase(G, g, r);
    const mine = !isBuiltin(r.pic);
    const sent = sentCount(G, r);
    status = `<b>${esc(g.name)}</b> · Round ${roundNo(g, r)} · ✓ <b>${sent}</b> of ${r.drawers.length} drawings sent · ${tally} <span class="muted">— the website judges as soon as everyone has sent</span>`;
    panel = `<div class="describe">${mine ? `<div class="desc-pic"><small>${ph.stage === "step" ? `Describe step ${ph.i + 1} of ${ph.total} 🤫` : "Your picture 🤫"}</small>${drawingSvg(G, r.pic, "host")}</div>` : ""}${stepPanel(G, g, r, "small")}</div>${drawerChips(G, r)}`;
    if (!r.startedAt) {
      btn(`▶ Start drawing <small>(new step every ${g.stepSeconds || 20}s)</small>`, "act", act("miniDrawStart", { id: g.id }), "primary", "Space");
      btn("↶ Undo round", "act", act("miniDrawCancel", { id: g.id, matchId: r.id }));
    } else {
      const over = ph.stage === "done";
      btn(`⏭ Judge now <small>(${sent} of ${r.drawers.length} sent)</small>`, "mini-draw-judge", { id: g.id, matchId: r.id }, over ? "primary" : "ghost", over ? "Space" : "");
      btn("↶ Undo round", "mini-draw-cancel-ask", { id: g.id, matchId: r.id });
    }
  } else {
    status = `<b>${esc(g.name)}</b> · ${n ? `${n} round${n === 1 ? "" : "s"} played · ` : ""}${tally}`;
    const last = lastRound(g);
    if (last && last.winner) panel = `<div class="muted">Website's verdict, round ${roundNo(g, last)}:</div>${drawBrowser(G, g, last)}`;
    btn(n ? `✏️ Another round <small>(everyone draws)</small>` : "✏️ Everyone draw!", "act", act("miniDrawRound", { id: g.id }), n ? "ghost" : "primary", n ? "" : "Space");
    btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, n ? "primary" : "ghost", n ? "Space" : "");
  }
  btn("↩ Games list", "act", act("miniClose"));
  return { status, panel, buttons: B };
}
// Players' phones: everyone gets a full-screen drawing pad; nothing is sent until they
// hold "Send". Then: how they did.
function drawPhone(G, g) {
  const r = E.drawRound(g);
  const me = r && r.drawers.find((d) => d.id === G.deviceId);
  if (me) {
    if (isSent(G, r, me.id)) return `<div class="youup big">✓ Drawing sent!<small>The website judges as soon as everyone's in.</small></div><div class="mysub"><small>Your drawing</small>${drawingSvg(G, subDocId(r.id, me.id), "mine")}</div>`;
    const key = `sub-${r.id}`;
    const ph = drawPhase(G, g, r);
    // The whole screen is the pad. Nothing to tap by mistake while it's on your head:
    // the pad switches on when step 1 starts, and the drawing sends itself at pencils down.
    const top = ph.stage === "step" ? `Step ${ph.i + 1} of ${ph.total} · ${cd(ph.endsAt)}`
      : ph.stage === "done" ? "✋ Pencils down! Sending your drawing…" : `✏️ Blind drawing · Round ${roundNo(g, r)}`;
    const wait = ph.stage === "ready" ? `<div class="df-wait"><div class="dw-big">📱 Phone on top of your head</div><div>Screen facing up. Your whole screen is the drawing pad — it switches on when the drawing starts.</div></div>`
      : ph.stage === "countdown" ? `<div class="df-wait"><div class="dw-big">Starting in ${cd(ph.endsAt)}</div><div>Phone on top of your head!</div></div>` : "";
    return `<div class="drawfull stage-${ph.stage}" data-key="drawfull-${esc(r.id)}">
      <div class="padbox" data-keep data-key="padbox-${esc(r.id)}"><canvas class="drawpad" data-pad="${esc(key)}"></canvas></div>
      <div class="df-top">${top}</div>${wait}
      ${ph.stage === "done" ? `<div class="df-btns"><button class="btn primary holdbtn" data-hold="pad-submit"><span>Hold to send ✋</span></button></div>` : ""}
    </div>`;
  }
  const st = E.miniStanding(g);
  const tally = `<div class="ph-tally"><span class="team1">${esc(tn(G, "team1"))} <b>${bestPct(st, "team1")}</b></span><span>–</span><span class="team2"><b>${bestPct(st, "team2")}</b> ${esc(tn(G, "team2"))}</span></div>`;
  if (r) return `<div class="ph-note">✏️ Everyone's drawing — you joined after this round started, so you're in the next one!</div>${tally}`;
  const last = lastRound(g);
  let verdict = "";
  if (last && last.winner) {
    const ranked = E.drawRanking(last);
    const i = ranked.findIndex((d) => d.id === G.deviceId);
    const best = ranked[0];
    const myTeam = G.me && G.me.team;
    const title = best && best.id === G.deviceId && last.winner !== "tie" ? "🏆 Your drawing won!"
      : last.winner === "tie" ? "🤝 It's a tie!"
      : last.winner === myTeam ? `🏆 ${esc(tn(G, last.winner))} won the round!` : `😤 ${esc(tn(G, last.winner))} won the round`;
    const mine = i >= 0 ? `You came <b>${ordinal(i + 1)}</b> of ${ranked.length}${ranked[i].score != null ? ` — ${ranked[i].score}% match` : " (no drawing sent)"}` : "";
    verdict = `<div class="ph-card verdict"><b>${title}</b><small>${best && best.score != null ? `Best drawing: ${esc(best.name)} ${best.score}%` : ""}${mine ? `<br>${mine}` : ""}</small></div>${drawBrowser(G, g, last)}`;
  }
  return `${verdict || `<div class="ph-note">✏️ Get ready — everyone draws at once, right where you're sitting!</div>`}${tally}`;
}

// This phone's part in the round being drawn: which stage it's at and whether it's sent.
export function myDrawState(G) {
  const M = E.minisOf(G.S);
  const g = M.current ? E.miniById(G.S, M.current) : null;
  if (!isDraw(g) || g.status !== "active" || G.S.phase !== "minis") return null;
  const r = E.drawRound(g);
  if (!r || !r.drawers.some((d) => d.id === G.deviceId)) return null;
  const ph = drawPhase(G, g, r);
  return { gid: g.id, rid: r.id, pid: G.deviceId, pad: `sub-${r.id}`, stage: ph.stage, i: ph.i, sent: isSent(G, r, G.deviceId) };
}
// Which step this phone's drawing round is on (so the phone can buzz on each new step).
export function myDrawStep(G) {
  const d = myDrawState(G);
  return d ? `${d.rid}:${d.stage}:${d.i == null ? "" : d.i}` : null;
}
