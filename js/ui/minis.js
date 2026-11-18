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
  if (d) return Dr.svg(d.strokes, cls);
  if (docId && !(G.drawLoading || (G.drawLoading = new Set())).has(docId)) {
    G.drawLoading.add(docId);
    loadDrawing(docId).then(() => { G.drawLoading.delete(docId); if (G.render) G.render(); }).catch(() => G.drawLoading.delete(docId));
  }
  return `<div class="drawing ${cls} loading">…</div>`;
}
export const subDocId = (matchId, team) => `drawsub-${matchId}-${team}`;
const J = (o) => esc(JSON.stringify(o));
const actAttr = (name, p = {}, extra = {}) => `data-action="act" data-p="${J({ name, p, ...extra })}"`;
const num = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const scoreText = (g, v) => `${num(v)}${g.unit ? " " + esc(g.unit) : ""}`;
const prize = (g) => (g.type === "h2h" && g.award === "match" ? `${money(g.points)} per matchup win` : `${money(g.points)} to the winners`);
const namesOn = (G, team) => G.P.filter((p) => !team || p.team === team).map((p) => p.name);
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
  { name: "Blind Drawing", type: "draw", desc: "Phone on your head! Jaren describes a picture and you draw it without looking. The website judges whose drawing is closest." },
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

function gameHead(M, g) {
  return `<div class="mg-kicker">${esc(kicker(M, g))}</div>
    <div class="${cls("mg-title", g.name.length > 24 && "long")}">${esc(g.name)}</div>
    ${g.desc ? `<div class="mg-desc">${esc(g.desc)}</div>` : ""}`;
}

// Several tables playing the same game at once: one card per table.
function tableCards(G, g, items) {
  const used = items.map((x) => x.table);
  const cards = items.map((x) => {
    const it = pickOf(G.S, x.id);
    const sum = !itemSpinning(G, it) ? itemSummon(it) : "";
    const who = g.type === "h2h"
      ? `<div class="tc-vs"><span class="team1">${x.p1 ? spin(namesOn(G, "team1"), x.p1.name, x.p1.at, "tspin") : esc(tn(G, "team1"))}</span><i>vs</i><span class="team2">${x.p2 ? spin(namesOn(G, "team2"), x.p2.name, x.p2.at, "tspin") : esc(tn(G, "team2"))}</span></div>`
      : `<div class="tc-vs solo ${x.team}">${spin(namesOn(G), x.name, x.at, "tspin")}<small>${esc(tn(G, x.team))}</small></div>`;
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
      ${gameHead(M, g)}
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
      ${p ? spin(namesOn(G, team), p.name, p.at) : `<span class="spin">${esc(tn(G, team))}</span>`}
    </div>`;
  const center = m
    ? `<div class="versus" data-key="match-${esc(m.id)}">${side("team1", m.p1)}<div class="vs-mid">VS</div>${side("team2", m.p2)}</div>`
    : `<div class="mg-wait" data-key="wait-${g.matches.length}">${g.matches.length ? "Who's up next? 🎲" : "Who's up first? 🎲"}</div>`;
  const past = g.matches.filter((x) => x.winner).slice(-5).reverse();
  return `<div class="mgame" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g)}
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
    ? `<div class="upnext ${t.team}" data-key="turn-${esc(t.id)}"><small>Up now</small>${spin(namesOn(G), t.name, t.at)}<em>${esc(tn(G, t.team))}</em></div>`
    : `<div class="upnext idle" data-key="idle-${g.entries.length}"><small>${g.entries.length ? "Next up" : "First up"}</small><span class="spin">🎲</span><em>${g.better === "low" ? "Lowest" : "Highest"} score wins</em></div>`;
  const rows = st.sorted.slice(0, 8).map((e, i) =>
    `<div class="${cls("lb-row", e.team, i === 0 && "top")}" data-key="lb-${esc(e.id)}"><span class="lb-n">${i === 0 ? "👑" : i + 1}</span><span class="lb-name">${esc(e.name)}</span><span class="lb-team">${esc(tn(G, e.team))}</span><b class="lb-score">${scoreText(g, e.score)}</b></div>`).join("");
  return `<div class="mgame mgame--best" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g)}
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
export function miniSteps(G, { privateView = false } = {}) {
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
        if (itemSpinning(G, it)) return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b><span class="hspins">🎲 ${x.p1 ? spin(namesOn(G, "team1"), a, x.p1.at, "hspin") : esc(a)} <i>vs</i> ${x.p2 ? spin(namesOn(G, "team2"), b, x.p2.at, "hspin") : esc(b)}</span></div>`;
        const win = (w, label, k) => `<button class="btn sm ${k}" ${actAttr("miniMatch", { id: g.id, matchId: x.id, winner: w })}>${label}</button>`;
        return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b>
          <span class="tr-who">${esc(a)} <i>vs</i> ${esc(b)}</span>
          <span class="tr-btns">${win("team1", `🏆 ${esc(a)}`, "t1")}${win("team2", `🏆 ${esc(b)}`, "t2")}${win("tie", "🤝", "ghost")}
          <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, matchId: x.id })} title="Draw two different players">🎲</button>
          <button class="btn ghost sm" data-action="mini-row-edit" data-id="${esc(x.id)}" aria-expanded="${!!editing(G, x.id)}">✏️</button></span>
          ${editing(G, x.id) ? `<span class="tr-swap">${E.TEAMS.map((t) => (G.P.some((p) => p.team === t) ? playerSelect(G, g, t, ((t === "team1" ? x.p1 : x.p2) || {}).id || "", x.id) : "")).join("")}${tableMove(G, g, x)}</span>` : ""}</div>`;
      }).join("")}</div>`;
      if (free.length) btn(`🎲 Draw for ${free.length === 1 ? free[0] : `${free.length} free tables`}`, "act", act("miniNext", { id: g.id }), "primary", "Space");
      btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, free.length ? "ghost" : "primary", free.length ? "" : "");
      btn("↩ Games list", "act", act("miniClose"));
    } else if (m) {
      const a = m.p1 ? m.p1.name : n1;
      const b = m.p2 ? m.p2.name : n2;
      if (spinning) {
        status = `<span class="hspins">🎲 ${m.p1 ? spin(namesOn(G, "team1"), a, m.p1.at, "hspin") : esc(a)} <i>vs</i> ${m.p2 ? spin(namesOn(G, "team2"), b, m.p2.at, "hspin") : esc(b)}</span> <span class="muted">${tally}</span>`;
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
      if (!E.minisTables(G.S).length) panel += tablePicker(G, g, null);
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
      if (itemSpinning(G, it)) return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b><span class="hspins">🎲 ${spin(namesOn(G), x.name, x.at, "hspin")}</span></div>`;
      return `<div class="trow" data-key="tr-${esc(x.id)}"><b class="tr-t">📍 ${esc(x.table || "")}</b>
        <span class="tr-who ${x.team}">${esc(x.name)} <small class="muted">${esc(tn(G, x.team))}</small></span>
        <span class="tr-btns"><label class="score-box sm"><input id="mini-score-${esc(x.id)}" class="wager-input" type="number" step="any" inputmode="decimal" placeholder="Score" autocomplete="off" data-sticky>${g.unit ? `<span>${esc(g.unit)}</span>` : ""}</label>
        <button class="btn primary sm" data-action="mini-score" data-p="${J({ id: g.id, turnId: x.id })}">✓ Save</button>
        <button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, turnId: x.id })} title="Draw someone else">🎲</button>
        <button class="btn ghost sm" data-action="mini-row-edit" data-id="${esc(x.id)}" aria-expanded="${!!editing(G, x.id)}">✏️</button></span>
        ${editing(G, x.id) ? `<span class="tr-swap">${playerSelect(G, g, null, x.pid, x.id)}${tableMove(G, g, x)}</span>` : ""}</div>`;
    }).join("")}</div>`;
    if (freeB.length) btn(`🎲 Draw for ${freeB.length === 1 ? freeB[0] : `${freeB.length} free tables`}`, "act", act("miniNext", { id: g.id }), "primary", "Space");
    btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, "ghost", "");
    btn("↩ Games list", "act", act("miniClose"));
  } else if (g.turn) {
    if (spinning) {
      status = `<span class="hspins">🎲 ${spin(namesOn(G), g.turn.name, g.turn.at, "hspin")}</span> <span class="muted">${leaderTxt}</span>`;
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
  if (!tables.length) {
    return `<div class="mpanel"><span class="muted">📍 Playing at more than one table?</span><button class="btn ghost sm" data-action="drawer" data-p='{"tab":"minis"}'>Set up tables</button></div>`;
  }
  return `<div class="mpanel wrap tablepick"><span class="muted">📍 Send them to:</span>${tables.map((t) =>
    `<button class="${cls("chipbtn", t === current && "on")}" ${actAttr("miniSetTable", { id: g.id, table: t })} aria-pressed="${t === current}">${t === current ? "✓ " : ""}${esc(t)}</button>`).join("")}</div>`;
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
  const tables = E.minisTables(G.S);
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
          <option value="h2h"${g.type === "h2h" && !isDraw(g) ? " selected" : ""}>⚔️ Head-to-head</option>
          <option value="best"${g.type === "best" ? " selected" : ""}>🏅 Best overall</option>
          <option value="draw"${isDraw(g) ? " selected" : ""}>✏️ Blind drawing</option>
        </select>
        <label class="pts"><span>$</span><input type="number" inputmode="numeric" min="0" step="50" value="${g.points}" aria-label="Points" ${field(g, "points")}></label>
      </div>
      <div class="mini-row">${g.type === "h2h"
        ? `<select class="grow" aria-label="How points are won" ${field(g, "award")}${started ? " disabled" : ""}>
             <option value="game"${g.award === "game" ? " selected" : ""}>Points go to the team that wins the game</option>
             <option value="match"${g.award === "match" ? " selected" : ""}>Points for every matchup win</option>
           </select>`
        : `<select class="grow" aria-label="Which score wins" ${field(g, "better")}>
             <option value="high"${g.better === "high" ? " selected" : ""}>Highest score wins</option>
             <option value="low"${g.better === "low" ? " selected" : ""}>Lowest wins (fastest time)</option>
           </select>
           <input class="unit" value="${esc(g.unit)}" maxlength="16" placeholder="unit, e.g. seconds" aria-label="Unit" ${field(g, "unit")}>`}
      </div>
      <input class="desc" value="${esc(g.desc)}" maxlength="240" placeholder="How to play (shown on the big screen) — optional" aria-label="How to play" ${field(g, "desc")}>
      ${tables.length ? `<div class="mini-row"><span class="muted">Played at</span><select class="grow" aria-label="Which table" ${field(g, "table")}>
        <option value=""${tables.includes(g.table) ? "" : " selected"}>🎲 All tables at once</option>
        ${tables.map((t) => `<option value="${esc(t)}"${g.table === t ? " selected" : ""}>📍 ${esc(t)}</option>`).join("")}
      </select></div>` : ""}
      <div class="mini-row foot">${state}<span class="grow"></span>
        ${started ? `<button class="btn ghost sm" data-action="mini-reset-ask" data-id="${esc(g.id)}">↺ Reset</button>` : ""}
        ${g.status !== "done" ? `<button class="btn ghost sm" ${actAttr("miniPlay", { id: g.id }, { then: "drawer" })}>▶ Play</button>` : ""}
      </div>
      ${isDraw(g) ? picsBlock(G, g) : ""}
    </div>`;
  }).join("");
  return `
  <section class="sect"><h4>Tables <small>optional</small></h4>
    <input class="newname" value="${esc(tables.join(", "))}" maxlength="240" placeholder="e.g. Kitchen table, Living room, Garage" aria-label="Table names" data-change="mini-tables" data-key="mini-tables">
    <p class="muted small">Want to get through the mini games faster? Name your tables, separated by commas, and each game is played at <b>all of them at once</b> — one draw puts a different matchup at every table, and everyone is told which table they're summoned to (a different Christmas summons every time). Set a game to one table below if it only has one station. Leave empty to play one at a time.</p>
  </section>
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
      <li>The game draws who's up next at random, and nobody repeats until everyone's had a go.</li>
    </ul>
  </section>
  <section class="sect"><h4>Need ideas? <small>tap to add</small></h4>
    <div class="ideas">${PRESETS.map((p, i) => `<button class="chipbtn" data-action="mini-preset" data-i="${i}" title="${esc(p.desc)}">${p.type === "draw" ? "✏️" : p.type === "h2h" ? "⚔️" : "🏅"} ${esc(p.name)}</button>`).join("")}</div>
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

  const head = `<div class="ph-mini-head"><div class="kicker">${typeLabel(g)} · ${prize(g)}</div><h2>${esc(g.name)}</h2>${g.desc ? `<p>${esc(g.desc)}</p>` : ""}</div>`;
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
        ? `<div class="ph-versus"><span class="team1">${esc(x.names[0] || tn(G, "team1"))}</span><i>vs</i><span class="team2">${esc(x.names[1] || tn(G, "team2"))}</span></div>${where}`
        : `<div class="ph-versus solo"><small>Up now</small><span class="${x.team}">${esc(x.names[0])}</span></div>${where}`;
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
function drawPhase(G, g, m) {
  if (!m.startedAt) return { stage: "ready" };
  const now = G.now();
  if (now < m.startedAt) return { stage: "countdown", endsAt: m.startedAt };
  const total = picTotalSteps(g, m.pic), ms = (g.stepSeconds || 20) * 1000;
  const i = Math.floor((now - m.startedAt) / ms);
  if (i < total) return { stage: "step", i, total, endsAt: m.startedAt + (i + 1) * ms };
  return { stage: "done", total };
}
const cd = (t) => `<span class="cd" data-deadline="${t}" data-format="s"></span>`;
// The step on the big screen: what to draw now, and (for ready-made pictures) what the
// drawing should look like so far.
function stepPanel(G, g, m, size = "") {
  const ph = drawPhase(G, g, m);
  const pic = builtin(m.pic);
  if (ph.stage === "ready") return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-ready"><div class="sp-text"><div class="sp-big">Get ready! 🎄</div><div>Drawers: phone on your head, eyes on this screen.</div></div></div>`;
  if (ph.stage === "countdown") return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-cd"><div class="sp-text"><div class="sp-big">Starting in ${cd(ph.endsAt)}</div><div>Phones on heads!</div></div></div>`;
  if (ph.stage === "done") return `<div class="steppanel ${size} done" data-key="sp-${esc(m.id)}-done"><div class="sp-text"><div class="sp-big">✋ Pencils down!</div><div>Take the phone off your head and <b>hold Send</b>.</div></div>${pic ? Dr.svgSteps(pic.steps, pic.steps.length - 1, "example") : ""}</div>`;
  const text = pic ? pic.steps[ph.i].text : "Listen to Jaren!";
  return `<div class="steppanel ${size}" data-key="sp-${esc(m.id)}-${ph.i}">
    ${pic ? Dr.svgSteps(pic.steps, ph.i, "example") : ""}
    <div class="sp-text"><div class="sp-step">Step ${ph.i + 1} of ${ph.total}</div><div class="sp-big">${esc(text)}</div>
      <div class="sp-time">⏱ ${cd(ph.endsAt)}${ph.i + 1 < ph.total ? " until the next step" : " left"}</div></div>
  </div>`;
}
// Open matchups that started together with the same picture share one step panel.
function stepGroups(g) {
  const groups = new Map();
  for (const m of E.openMatches(g)) {
    const k = `${m.pic}|${m.startedAt || "ready"}`;
    if (!groups.has(k)) groups.set(k, m);
  }
  return [...groups.values()];
}
// The latest matchup at each table (or the only spot): playing now, or its result.
function latestPerTable(G, g) {
  const slots = E.miniSlots(G.S, g);
  const out = [];
  for (const t of slots) {
    const ms = g.matches.filter((m) => (m.table || null) === t);
    if (ms.length) out.push(ms[ms.length - 1]);
    else if (t !== null) out.push({ id: "free-" + t, free: true, table: t });
  }
  return out;
}
const sideName = (G, m, team) => (team === "team1" ? (m.p1 ? m.p1.name : tn(G, "team1")) : (m.p2 ? m.p2.name : tn(G, "team2")));
function drawCard(G, g, m) {
  const where = m.table ? `<div class="tc-name">📍 ${esc(m.table)}</div>` : "";
  if (m.free) return `<div class="tcard free" data-key="dc-free-${esc(m.table)}">${where}<div class="tc-free">Free — next round 🎲</div></div>`;
  if (!m.winner) {
    const it = pickOf(G.S, m.id);
    const ph = drawPhase(G, g, m);
    const status = (team) => (m.done && m.done[team] ? `<em class="dstat ok">✓ Sent</em>` : ph.stage === "ready" || ph.stage === "countdown" ? `<em class="dstat">🎄 Getting ready</em>` : `<em class="dstat">✏️ Drawing…</em>`);
    const side = (team, p) => `<span class="${team}">${p ? spin(namesOn(G, team), p.name, p.at, "tspin") : esc(tn(G, team))}${itemSpinning(G, it) ? "" : status(team)}</span>`;
    return `<div class="tcard" data-key="dc-${esc(m.id)}">${where}<div class="tc-vs">${side("team1", m.p1)}<i>vs</i>${side("team2", m.p2)}</div>
      ${!itemSpinning(G, it) && itemSummon(it) ? `<div class="tc-sum">${esc(itemSummon(it))}</div>` : ""}</div>`;
  }
  // The verdict: the picture, then the winner and the loser.
  const sc = m.scores || {};
  const order = m.winner === "team2" ? ["team2", "team1"] : ["team1", "team2"];
  const panel = (team, role) => `<div class="dpanel ${role}">
      <div class="dp-label">${role === "win" ? "🏆 Winner" : role === "lose" ? "Loser" : "🤝 Tie"}</div>
      ${m.done && m.done[team] ? drawingSvg(G, subDocId(m.id, team)) : `<div class="drawing empty">No drawing</div>`}
      <div class="dp-name ${team}">${esc(sideName(G, m, team))}</div>
      <div class="dp-score">${sc[team] == null ? "—" : sc[team] + "% match"}</div></div>`;
  const tie = m.winner === "tie";
  return `<div class="tcard result" data-key="dr-${esc(m.id)}">${where}
    <div class="dpanels">
      <div class="dpanel ref"><div class="dp-label">The picture</div>${drawingSvg(G, m.pic)}<div class="dp-name">&nbsp;</div><div class="dp-score">&nbsp;</div></div>
      ${panel(order[0], tie ? "tie" : "win")}${panel(order[1], tie ? "tie" : "lose")}
    </div></div>`;
}
function drawView(G, M, g) {
  const st = E.miniStanding(g);
  const cards = latestPerTable(G, g);
  const past = g.matches.filter((x) => x.winner).slice(-5).reverse();
  return `<div class="mgame mgame--draw" data-key="mg-${esc(g.id)}">
    ${gameHead(M, g)}
    ${stepGroups(g).filter((m) => !itemSpinning(G, pickOf(G.S, m.id))).map((m) => stepPanel(G, g, m)).join("")}
    ${cards.length ? `<div class="tcards n${Math.min(cards.length, 4)}">${cards.map((m) => drawCard(G, g, m)).join("")}</div>` : `<div class="mg-wait">Who's drawing first? 🎲</div>`}
    <div class="tally">
      <span class="t team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span>
      <span class="t-sep">–</span>
      <span class="t team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span>
    </div>
    <div class="mhistory">${past.map((x) => matchChip(G, x)).join("")}</div>
  </div>`;
}
function drawSteps(G, g, { btn, act, B, st, n1, n2 }) {
  const tally = `${esc(n1)} <b>${st.wins.team1}</b> – <b>${st.wins.team2}</b> ${esc(n2)}`;
  const open = E.openMatches(g);
  const free = canDrawMore(G, g, open) ? E.miniSlots(G.S, g).filter((t) => !open.some((m) => (m.table || null) === t)) : [];
  let status, panel = "";
  if (!(g.pics || []).length) {
    status = `<b>${esc(g.name)}</b> needs a picture to describe — draw one first.`;
    btn("✏️ Draw a picture", "drawer", { tab: "minis" }, "primary", "Space");
    btn("↩ Games list", "act", act("miniClose"));
    return { status, panel, buttons: B };
  }
  // What's on the big screen right now (and, for your own pictures, the picture to describe).
  const describe = stepGroups(g).map((m) => {
    const ph = drawPhase(G, g, m);
    const mine = !isBuiltin(m.pic);
    return `<div class="describe">${mine ? `<div class="desc-pic"><small>${ph.stage === "step" ? `Describe step ${ph.i + 1} of ${ph.total} 🤫` : "Your picture 🤫"}</small>${drawingSvg(G, m.pic, "host")}</div>` : ""}${stepPanel(G, g, m, "small")}</div>`;
  }).join("");
  const notStarted = open.filter((m) => !m.startedAt && !itemSpinning(G, pickOf(G.S, m.id)));
  const rows = open.map((m) => {
    const it = pickOf(G.S, m.id);
    const a = sideName(G, m, "team1"), b = sideName(G, m, "team2");
    const where = m.table ? `<b class="tr-t">📍 ${esc(m.table)}</b>` : "";
    if (itemSpinning(G, it)) return `<div class="trow" data-key="tr-${esc(m.id)}">${where}<span class="hspins">🎲 ${m.p1 ? spin(namesOn(G, "team1"), a, m.p1.at, "hspin") : esc(a)} <i>vs</i> ${m.p2 ? spin(namesOn(G, "team2"), b, m.p2.at, "hspin") : esc(b)}</span></div>`;
    const mark = (team) => (m.done && m.done[team] ? "✓" : "✏️");
    const anyDone = m.done && (m.done.team1 || m.done.team2);
    return `<div class="trow" data-key="tr-${esc(m.id)}">${where}
      <span class="tr-who">${mark("team1")} ${esc(a)} <i>vs</i> ${mark("team2")} ${esc(b)}</span>
      <span class="tr-btns"><button class="btn ghost sm" data-action="mini-draw-judge" data-p="${J({ id: g.id, matchId: m.id })}" title="Judge with whatever has been sent (a missing drawing loses)">⏭ Judge now</button>
      ${anyDone ? "" : `<button class="btn ghost sm" ${actAttr("miniRepick", { id: g.id, matchId: m.id })} title="Draw two different players">🎲</button>`}</span></div>`;
  }).join("");
  const last = g.matches.filter((m) => m.winner && m.scores).slice(-3).reverse();
  const results = last.length ? `<div class="mpanel wrap"><span class="muted">Website's verdict:</span>${last.map((m) => {
    const w = m.winner === "tie" ? null : m.winner, l = w ? E.otherTeam(w) : null;
    return `<span class="mchip ${w || "tie"}">${m.table ? `📍${esc(m.table)} ` : ""}${w ? `🏆 <b>${esc(sideName(G, m, w))}</b> ${m.scores[w] ?? "—"}% · ${esc(sideName(G, m, l))} ${m.scores[l] ?? "—"}%` : `🤝 ${esc(sideName(G, m, "team1"))} & ${esc(sideName(G, m, "team2"))}`}</span>`;
  }).join("")}</div>` : "";
  if (open.length) {
    status = `<b>${esc(g.name)}</b> · ${open.length > 1 ? `${open.length} tables drawing` : "drawing"} · ${tally} <span class="muted">— the website judges as soon as both drawings are in</span>`;
    panel = `${describe}<div class="trows">${rows}</div>${results}`;
  } else {
    status = `<b>${esc(g.name)}</b> · ${tally}`;
    panel = results + (E.minisTables(G.S).length ? "" : tablePicker(G, g, null));
  }
  const slots = E.miniSlots(G.S, g).filter((t) => t !== null);
  if (notStarted.length) btn(`▶ Start drawing <small>(new step every ${g.stepSeconds || 20}s)</small>`, "act", act("miniDrawStart", { id: g.id }), "primary", "Space");
  if (free.length) btn(open.length ? `🎲 Draw for ${free.length === 1 && free[0] ? free[0] : `${free.length} free tables`}` : slots.length > 1 ? `🎲 Draw for all ${slots.length} tables` : "🎲 Who's drawing?", "act", act("miniNext", { id: g.id }), notStarted.length ? "ghost" : "primary", notStarted.length ? "" : "Space");
  btn("🏁 Finish game", "mini-finish-ask", { id: g.id }, free.length ? "ghost" : "primary", "");
  btn("↩ Games list", "act", act("miniClose"));
  return { status, panel, buttons: B };
}
// Players' phones: the drawer gets a full-screen drawing pad; nothing is sent until they
// hold "Send". Everyone else sees who's drawing where, then the verdict.
function drawPhone(G, g) {
  const me = G.me;
  const open = E.openMatches(g);
  const mine = open.find((m) => (m.p1 && m.p1.id === G.deviceId) || (m.p2 && m.p2.id === G.deviceId));
  if (mine) {
    const team = mine.p1 && mine.p1.id === G.deviceId ? "team1" : "team2";
    const it = pickOf(G.S, mine.id);
    if (itemSpinning(G, it)) return `<div class="ph-note drawing">🎲 Drawing who's up…</div>`;
    const rival = sideName(G, mine, E.otherTeam(team));
    if (mine.done && mine.done[team]) return `<div class="youup big">✓ Drawing sent!<small>Waiting for ${esc(rival)}… then the website judges.</small></div>`;
    const key = `sub-${mine.id}`;
    const ph = drawPhase(G, g, mine);
    const prompt = ph.stage === "ready" ? "Get ready — phone on your head, eyes on the big screen!"
      : ph.stage === "countdown" ? `Starting in ${cd(ph.endsAt)}… phone on your head!`
      : ph.stage === "step" ? `Step ${ph.i + 1} of ${ph.total} — look at the big screen! (${cd(ph.endsAt)})`
      : "✋ Pencils down! Take it off your head and hold Send.";
    return `<div class="${cls("drawfull", ph.stage === "done" && "finished")}" data-key="drawfull-${esc(mine.id)}">
      <div class="df-top"><b>✏️ You vs ${esc(rival)}${mine.table ? ` · 📍 ${esc(mine.table)}` : ""}</b><span>${prompt}</span></div>
      <div class="padbox" data-keep data-key="padbox-${esc(mine.id)}"><canvas class="drawpad" data-pad="${esc(key)}"></canvas></div>
      <div class="df-btns"><button class="btn ghost" data-action="pad-clear" data-pad="${esc(key)}">Start over</button>
        <button class="btn primary holdbtn" data-hold="pad-submit" data-id="${esc(g.id)}" data-match="${esc(mine.id)}" data-team="${team}" data-pad="${esc(key)}"><span>Hold to send ✋</span></button></div>
    </div>`;
  }
  // Not drawing: who's drawing where, then the latest verdicts.
  const rows = open.map((m) => `<div class="ph-versus"><span class="team1">${esc(sideName(G, m, "team1"))}${m.done && m.done.team1 ? " ✓" : ""}</span><i>vs</i><span class="team2">${esc(sideName(G, m, "team2"))}${m.done && m.done.team2 ? " ✓" : ""}</span></div>${m.table ? `<span class="tabletag">📍 ${esc(m.table)}</span>` : ""}`).join("");
  const last = g.matches.filter((m) => m.winner && m.scores).slice(-2).reverse();
  const verdict = last.map((m) => {
    const w = m.winner === "tie" ? null : m.winner;
    const myResult = (m.p1 && m.p1.id === G.deviceId) || (m.p2 && m.p2.id === G.deviceId);
    const iWon = myResult && w && ((w === "team1" && m.p1 && m.p1.id === G.deviceId) || (w === "team2" && m.p2 && m.p2.id === G.deviceId));
    const title = !w ? "🤝 It's a tie!" : myResult ? (iWon ? "🏆 You won!" : "😬 You lost this one") : `🏆 ${esc(sideName(G, m, w))} won`;
    return `<div class="ph-card verdict"><b>${title}</b><small>${w ? `${esc(sideName(G, m, w))} ${m.scores[w] ?? "—"}% · ${esc(sideName(G, m, E.otherTeam(w)))} ${m.scores[E.otherTeam(w)] ?? "—"}% match` : ""} — see the big screen!</small></div>`;
  }).join("");
  const st = E.miniStanding(g);
  return `${rows || `<div class="ph-note">Get ready — the next drawers are about to be picked! 🎲</div>`}${verdict}
    <div class="ph-tally"><span class="team1">${esc(tn(G, "team1"))} <b>${st.wins.team1}</b></span><span>–</span><span class="team2"><b>${st.wins.team2}</b> ${esc(tn(G, "team2"))}</span></div>`;
}

// Which step a phone's drawer is on (so the phone can buzz on each new step).
export function myDrawStep(G) {
  const M = E.minisOf(G.S);
  const g = M.current ? E.miniById(G.S, M.current) : null;
  if (!isDraw(g)) return null;
  const m = E.openMatches(g).find((x) => (x.p1 && x.p1.id === G.deviceId) || (x.p2 && x.p2.id === G.deviceId));
  if (!m) return null;
  const ph = drawPhase(G, g, m);
  return `${m.id}:${ph.stage}:${ph.i == null ? "" : ph.i}`;
}
