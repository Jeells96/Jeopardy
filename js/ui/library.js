// Question library screen: every year's questions in one place — write, paste, organise,
// search past years, and put a set on the board.
import { esc, cls } from "./util.js";
import * as B from "../bank.js";

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

// Which set is open: the chosen one, else the one in the game, else the newest.
export function currentSet(G) {
  const L = G.ui.lib;
  const loaded = G.S && G.S.loaded ? G.S.loaded.id : null;
  return G.sets.find((s) => s.id === L.setId) || G.sets.find((s) => s.id === loaded) || G.sets[0] || null;
}
let indexFor = null;
let index = null;
function repeats(G) {
  if (indexFor !== G.sets) { indexFor = G.sets; index = B.repeatIndex(G.sets); }
  return index;
}

export function renderLibrary(G) {
  const L = G.ui.lib;
  const cur = currentSet(G);
  const q = (L.search || "").trim();
  let main;
  if (!G.setsReady) main = `<div class="lib-empty"><div class="spinner"></div><p class="muted">Opening your library…</p></div>`;
  else if (q) main = searchView(G, cur, q);
  else if (cur) main = setView(G, cur);
  else main = emptyView();
  return `<div class="lib">
    <header class="lib-top">
      <a class="hbtn" href="#/admin">← Back to the game</a>
      <div class="lib-title">📚 Question library</div>
      <input id="lib-search" class="lib-search" type="search" placeholder="🔎 Search every year…" value="${esc(L.search || "")}" data-input="lib-search" data-sticky autocomplete="off" aria-label="Search all question sets">
    </header>
    <div class="lib-body">
      ${sidebar(G, cur, q)}
      <main class="lib-main">${main}</main>
    </div>
    ${libModal(G, cur)}
  </div>`;
}

function sidebar(G, cur, q) {
  const loaded = G.S && G.S.loaded ? G.S.loaded.id : null;
  return `<aside class="lib-sets">
    <button class="btn primary newset" data-action="lib-new">+ New question set</button>
    <div class="setlist">${G.sets.map((s) => {
      const st = B.setStats(s);
      return `<button class="${cls("setcard", !q && cur && s.id === cur.id && "on")}" data-action="lib-select" data-id="${esc(s.id)}" data-key="set-${esc(s.id)}">
        <b>${esc(s.name)}</b>
        <span>${s.year} · ${st.ready} ready${st.ideas ? ` · ${st.ideas} unfinished` : ""}</span>
        ${s.id === loaded || s.locked ? `<span class="tags">${s.id === loaded ? `<em class="tag live">▶ In the game</em>` : ""}${s.locked ? `<em class="tag">🔒 Locked</em>` : ""}</span>` : ""}
      </button>`;
    }).join("")}</div>
  </aside>`;
}

function emptyView() {
  return `<div class="lib-empty">
    <div class="big-emoji">📚</div>
    <h2>Your question library is empty</h2>
    <p class="muted">Make a set for this year, then paste or type your questions. Every set is kept, so next year you can look back at what you've already asked.</p>
    <div class="btnrow center">
      <button class="btn primary" data-action="lib-new">+ New question set</button>
      <button class="btn ghost" data-action="lib-add-sample">Add the sample game to look around</button>
    </div>
  </div>`;
}

// ---------------- one set ----------------
function setView(G, set) {
  const L = G.ui.lib;
  const g = B.groupSet(set);
  const st = B.setStats(set);
  const checks = B.checkSet(set);
  const warns = checks.filter((c) => c.level === "warn").length;
  const dis = set.locked ? " disabled" : "";
  const todo = L.filter === "todo";
  const cats = [...new Set(set.clues.map((c) => c.category).filter(Boolean))];
  const inGame = G.S && G.S.loaded && G.S.loaded.id === set.id;
  const show = (c) => !todo || !B.isReady(c);

  const round = (slot) => {
    const list = g.rounds[slot].filter((cat) => cat.clues.some(show));
    const count = g.rounds[slot].reduce((n, c) => n + c.clues.length, 0);
    if (todo && !list.length) return "";
    return `<section class="lib-round" data-key="round-${slot}">
      <h3>${B.SLOT_LABEL[slot]} round <small>${g.rounds[slot].length ? `${plural(g.rounds[slot].length, "category", "categories")} · ${plural(count, "clue")} · values ${slot === "r2" ? "$200–$1,000" : "$100–$500"}` : slot === "r2" ? "optional — add a category to include it" : "no categories yet"}</small></h3>
      ${list.map((cat, i) => catBlock(G, set, cat, i, g.rounds[slot].length, show)).join("")}
      ${set.locked || todo ? "" : `<div class="newcat">
        <input id="new-cat-${slot}" maxlength="60" placeholder="New category name" aria-label="New ${B.SLOT_LABEL[slot]} category" data-sticky>
        <button class="btn ghost sm" data-action="lib-add-cat" data-slot="${slot}">+ Add category</button>
      </div>`}
    </section>`;
  };
  const finals = g.final.filter(show);
  const loose = g.loose.filter(show);

  return `<datalist id="lib-cats">${cats.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
  <div class="set-head">
    <div class="set-title">
      <input class="set-name" value="${esc(set.name)}" maxlength="60" aria-label="Set name" data-change="lib-meta" data-f="name"${dis}>
      <label class="set-year"><span>Year</span><input type="number" inputmode="numeric" value="${set.year}" aria-label="Year" data-change="lib-meta" data-f="year"${dis}></label>
    </div>
    <div class="set-stats">
      <span><b>${st.r1}</b> Jeopardy</span><span><b>${st.r2}</b> Double Jeopardy</span><span>Final ${st.final ? "✓" : "—"}</span>
      <span><b>${st.mc}</b> multiple choice</span><span><b>${st.dd}</b> Daily Double${st.dd === 1 ? "" : "s"}</span>
      ${st.ideas ? `<span class="warn"><b>${st.ideas}</b> unfinished</span>` : ""}
      ${inGame ? `<span class="live">▶ In the game now</span>` : ""}
    </div>
    <div class="set-actions">
      <button class="btn primary" data-action="lib-use">▶ Use in the game</button>
      <button class="btn ghost" data-action="lib-paste-open"${dis}>📋 Paste questions</button>
      <button class="btn ghost" data-action="lib-prompt-open">🤖 Ask AI for questions</button>
      <button class="btn ghost" data-action="lib-more">⋯ More</button>
    </div>
    ${set.locked ? `<div class="lockbar">🔒 This set is locked so it can't be changed by accident. <button class="btn ghost sm" data-action="lib-lock">Unlock</button></div>` : ""}
    <button class="${cls("checkbar", warns ? "warn" : checks.length ? "info" : "good")}" data-action="lib-checks" aria-expanded="${!!L.showChecks}">
      ${!checks.length ? "✅ This set is ready to play" : warns ? `⚠️ ${plural(warns, "thing")} to fix before playing${checks.length > warns ? ` · ${plural(checks.length - warns, "suggestion")}` : ""}` : `💡 ${plural(checks.length, "suggestion")} — nothing stopping you playing`}
      ${checks.length ? `<span>${L.showChecks ? "Hide ▴" : "Show ▾"}</span>` : ""}
    </button>
    ${L.showChecks && checks.length ? `<ul class="checks">${checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join("")}</ul>` : ""}
  </div>
  ${L.undo && L.undo.setId === set.id ? `<div class="undobar">Deleted “${esc((L.undo.clue.question || L.undo.clue.answer).slice(0, 60))}” <button class="btn ghost sm" data-action="lib-undo-del">↩ Undo</button></div>` : ""}
  <div class="set-filter">
    <div class="seg">
      <button class="${cls("seg-btn", !todo && "on")}" data-action="lib-filter" data-v="all">All ${st.total}</button>
      <button class="${cls("seg-btn", todo && "on")}" data-action="lib-filter" data-v="todo">Unfinished ${st.ideas}</button>
    </div>
  </div>
  ${todo && !st.ideas ? `<div class="lib-empty small"><p>🎉 Nothing unfinished in this set.</p></div>` : ""}
  ${round("r1")}
  ${round("r2")}
  ${todo && !finals.length ? "" : `<section class="lib-round" data-key="round-final">
    <h3>Final Jeopardy <small>one clue; teams wager and write their answer</small></h3>
    ${finals.map((c) => clueCard(G, set, c, "final")).join("")}
    ${set.locked || todo || g.final.length ? "" : `<button class="addclue" data-action="lib-add-clue" data-slot="final" data-cat="">+ Add the Final Jeopardy clue</button>`}
  </section>`}
  ${todo && !loose.length ? "" : `<section class="lib-round" data-key="round-loose">
    <h3>Unsorted <small>not on the board until they have a category</small></h3>
    ${loose.map((c) => clueCard(G, set, c, "loose")).join("") || `<p class="muted pad">Questions you paste without a category land here.</p>`}
    ${set.locked || todo ? "" : `<button class="addclue" data-action="lib-add-clue" data-slot="r1" data-cat="">+ Add a question</button>`}
  </section>`}`;
}

function catBlock(G, set, cat, i, total, show) {
  const dis = set.locked ? " disabled" : "";
  const n = cat.clues.length;
  return `<div class="lib-cat" data-key="cat-${cat.slot}-${esc(cat.name.toLowerCase())}">
    <div class="cat-head">
      <input class="cat-name" value="${esc(cat.name)}" maxlength="60" aria-label="Category name" data-change="lib-cat-rename" data-slot="${cat.slot}" data-from="${esc(cat.name)}"${dis}>
      <span class="${cls("cat-count", n >= 5 && "ok")}">${plural(n, "clue")}</span>
      ${set.locked ? "" : `<button class="btn ghost sm" data-action="lib-cat-move" data-slot="${cat.slot}" data-name="${esc(cat.name)}" data-dir="-1" title="Move category earlier"${i === 0 ? " disabled" : ""}>▲</button>
      <button class="btn ghost sm" data-action="lib-cat-move" data-slot="${cat.slot}" data-name="${esc(cat.name)}" data-dir="1" title="Move category later"${i === total - 1 ? " disabled" : ""}>▼</button>`}
    </div>
    ${cat.clues.filter(show).map((c) => clueCard(G, set, c, "cat")).join("")}
    ${set.locked ? "" : `<button class="addclue" data-action="lib-add-clue" data-slot="${cat.slot}" data-cat="${esc(cat.name)}">+ Add a clue</button>`}
  </div>`;
}

function clueCard(G, set, c, where) {
  const L = G.ui.lib;
  const open = !!L.open[c.id];
  const issues = B.clueIssues(c);
  const dis = set.locked ? " disabled" : "";
  const id = esc(c.id);
  const f = (name) => `data-change="lib-clue" data-id="${id}" data-f="${name}" data-key="f-${id}-${name}"`;
  const flags = [];
  if (issues.includes("question")) flags.push(`<span class="flag todo">Needs a question</span>`);
  if (issues.includes("answer")) flags.push(`<span class="flag todo">Needs an answer</span>`);
  if (where === "loose" && c.question && c.answer) flags.push(`<span class="flag todo">Needs a category</span>`);
  if (B.isMC(c)) flags.push(`<span class="flag mc">Multiple choice: ${esc(c.wrong.join(" · "))}</span>`);
  if (c.dd) flags.push(`<span class="flag dd">⭐ Daily Double</span>`);
  if (c.note) flags.push(`<span class="flag note">📝 ${esc(c.note)}</span>`);
  for (const r of B.repeatsFor(c, set.id, repeats(G))) flags.push(`<span class="flag rep">♻ Also asked in ${esc(r.setName)}</span>`);
  const others = G.sets.filter((s) => s.id !== set.id && !s.locked);
  const extra = !open ? "" : `<div class="qc-extra" data-key="x-${id}">
    ${where === "final" ? "" : `<label class="xf wide"><span>Wrong options <small>fill these in to make it multiple choice — separate with a semicolon ;</small></span>
      <input value="${esc(c.wrong.join("; "))}" placeholder="Wrong 1; Wrong 2; Wrong 3" ${f("wrong")}${dis}></label>`}
    ${where === "cat" ? `<label class="xf"><span>Category</span><input list="lib-cats" value="${esc(c.category)}" maxlength="60" ${f("category")}${dis}></label>` : ""}
    <label class="xf"><span>Round</span><select ${f("slot")}${dis}>${B.SLOTS.map((s) => `<option value="${s}"${c.slot === s ? " selected" : ""}>${B.SLOT_LABEL[s]}</option>`).join("")}</select></label>
    ${where === "final" ? "" : `<label class="toggle"><input type="checkbox" data-change="lib-clue-bool" data-id="${id}" data-f="dd"${c.dd ? " checked" : ""}${dis}><span>⭐ Daily Double</span></label>`}
    <label class="xf wide"><span>Host note <small>only shown on your phone remote</small></span><input value="${esc(c.note)}" maxlength="300" placeholder="e.g. also accept “St. Nick”" ${f("note")}${dis}></label>
    <div class="qc-tools">
      ${where === "cat" && !set.locked ? `<button class="btn ghost sm" data-action="lib-clue-move" data-id="${id}" data-dir="-1" title="Earlier in this category">▲</button><button class="btn ghost sm" data-action="lib-clue-move" data-id="${id}" data-dir="1" title="Later in this category">▼</button>` : ""}
      ${others.length ? `<select class="copyto" data-change="lib-copy" data-id="${id}" aria-label="Copy this question to another set"><option value="">Copy to another set…</option>${others.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>` : ""}
      ${set.locked ? "" : `<button class="btn bad sm" data-action="lib-clue-del" data-id="${id}">🗑 Delete</button>`}
    </div>
  </div>`;
  return `<div class="${cls("qc", where, issues.length && "todo", open && "open")}" data-key="qc-${id}">
    <div class="qc-row" data-key="r-${id}">
      ${where === "cat" ? `<input class="qc-pts" inputmode="numeric" value="${c.points == null ? "" : c.points}" placeholder="${c.pts || ""}" title="Points — leave blank and it's set automatically" aria-label="Points" ${f("points")}${dis}>` : ""}
      <textarea class="qc-q" rows="1" maxlength="400" placeholder="Question" aria-label="Question" ${f("question")}${dis}>${esc(c.question)}</textarea>
      <input class="qc-a" value="${esc(c.answer)}" maxlength="200" placeholder="Answer" aria-label="Answer" ${f("answer")}${dis}>
      ${where === "cat" ? "" : `<input class="qc-c" list="lib-cats" value="${esc(c.category)}" maxlength="60" placeholder="${where === "final" ? "Final category" : "Category"}" aria-label="Category" ${f("category")}${dis}>`}
      <button class="qc-more" data-action="lib-toggle" data-id="${id}" title="More: multiple choice, Daily Double, note, move, delete" aria-expanded="${open}">${open ? "▴" : "⋯"}</button>
    </div>
    ${flags.length ? `<div class="qc-flags" data-key="fl-${id}">${flags.join("")}</div>` : ""}
    ${extra}
  </div>`;
}

// ---------------- search across every year ----------------
function searchView(G, cur, q) {
  const hits = B.searchSets(G.sets, q);
  if (!hits.length) return `<div class="lib-empty small"><h2>No matches for “${esc(q)}”</h2><p class="muted">Search looks at questions, answers, categories and notes in every set.</p><button class="btn ghost" data-action="lib-search-clear">Clear search</button></div>`;
  const groups = [];
  for (const h of hits) {
    let g = groups.find((x) => x.set.id === h.set.id);
    if (!g) { g = { set: h.set, clues: [] }; groups.push(g); }
    g.clues.push(h.clue);
  }
  return `<div class="search-head"><b>${plural(hits.length, "match", "matches")}</b> for “${esc(q)}” <button class="btn ghost sm" data-action="lib-search-clear">Clear</button></div>
  ${groups.map((g) => `<section class="lib-round"><h3>${esc(g.set.name)} <small>${g.set.year} · ${plural(g.clues.length, "match", "matches")}</small>
      <button class="btn ghost sm" data-action="lib-select" data-id="${esc(g.set.id)}">Open this set</button></h3>
    ${g.clues.map((c) => `<div class="hit" data-key="hit-${esc(c.id)}">
      <div class="hit-meta">${esc(c.slot === "final" ? "Final Jeopardy" : c.category || "Unsorted")}${c.slot === "r2" ? " · Double Jeopardy" : ""}</div>
      <div class="hit-q">${esc(c.question) || `<span class="muted">(no question yet)</span>`}</div>
      <div class="hit-a">${esc(c.answer) || `<span class="muted">(no answer yet)</span>`}${B.isMC(c) ? ` <small>· not: ${esc(c.wrong.join(", "))}</small>` : ""}</div>
      ${c.note ? `<div class="hit-meta">📝 ${esc(c.note)}</div>` : ""}
      ${cur && cur.id !== g.set.id && !cur.locked ? `<button class="btn ghost sm" data-action="lib-copy-hit" data-from="${esc(g.set.id)}" data-id="${esc(c.id)}">➕ Copy into ${esc(cur.name)}</button>` : ""}
    </div>`).join("")}
  </section>`).join("")}`;
}

// ---------------- dialogs ----------------
function libModal(G, cur) {
  const m = G.ui.modal;
  if (!m || !String(m.type).startsWith("lib")) return "";
  const L = G.ui.lib;
  const wrap = (inner, wide) => `<div class="modal-scrim" data-action="modal-close"></div><div class="${cls("modal", wide && "wide")}" role="dialog">${inner}</div>`;
  const cancel = (label = "Cancel") => `<button class="btn ghost" data-action="modal-close">${label}</button>`;
  const year = new Date().getFullYear();

  if (m.type === "libNew") {
    const radio = (v, label) => `<label class="radio"><input type="radio" name="ns-from" value="${v}" data-change="lib-new-from"${L.newFrom === v ? " checked" : ""}><span>${label}</span></label>`;
    return wrap(`<h3>New question set</h3>
      <label class="field"><span>Name</span><input id="ns-name" value="Christmas ${year}" maxlength="60" data-sticky></label>
      <label class="field"><span>Year</span><input id="ns-year" type="number" inputmode="numeric" value="${year}" data-sticky></label>
      <div class="field"><span>Start with</span>
        ${radio("empty", "An empty set")}
        ${G.Q.length ? radio("game", `The ${G.Q.length} questions that are in the game right now`) : ""}
        ${radio("sample", "The sample game (60 clues + Final) to edit")}
      </div>
      <div class="btnrow end">${cancel()}<button class="btn primary" data-action="lib-new-create">Create set</button></div>`);
  }
  if (!cur) return "";

  if (m.type === "libPaste") {
    const text = L.paste.text || "";
    const r = text.trim() ? B.parsePaste(text, { slot: L.paste.slot, category: L.paste.category }) : null;
    const s = r && r.stats;
    const preview = !r ? `<div class="formats">
        <b>What can I paste?</b> Almost anything with a question and an answer. The tidiest way:
        <pre>## Christmas Movies
100 | Who lives on Mount Crumpit? | The Grinch
200 | Which store introduced Rudolph? | Montgomery Ward | Macy's; Sears; Woolworth's</pre>
        <ul>
          <li><code>## Name</code> starts a category. <code>== Double Jeopardy ==</code> or <code>== Final Jeopardy ==</code> switches round.</li>
          <li>Each line is <code>points | question | answer</code>. Add a 4th part with wrong options (separated by <code>;</code>) to make it <b>multiple choice</b>, and <code>| DD</code> for a Daily Double.</li>
          <li>Also fine: <code>Question? Answer: X</code>, numbered lists with A) B) C) D) options, rows copied from a spreadsheet, or a table.</li>
        </ul>
      </div>`
      : `<div class="paste-sum">
          <span class="${s.total ? "good" : "bad"}"><b>${s.total}</b> found</span>
          <span><b>${s.ready}</b> ready for the board</span>
          ${s.needCategory ? `<span class="warn"><b>${s.needCategory}</b> need a category</span>` : ""}
          ${s.unfinished ? `<span class="warn"><b>${s.unfinished}</b> missing a question or answer</span>` : ""}
          ${s.mc ? `<span><b>${s.mc}</b> multiple choice</span>` : ""}
        </div>
        <div class="paste-prev">${r.clues.slice(0, 80).map((c) => `<div class="${cls("pp", !B.isReady(c) && "todo")}">
            <span class="pp-cat">${esc(c.slot === "final" ? "Final" : c.category || "no category")}${c.slot === "r2" ? " · DJ" : ""}${c.points ? " · " + money(c.points) : ""}</span>
            <span class="pp-q">${esc(c.question) || "<i>no question</i>"}</span>
            <span class="pp-a">${c.answer ? "→ " + esc(c.answer) : "<i>no answer</i>"}${B.isMC(c) ? ` <small>(not: ${esc(c.wrong.join(", "))})</small>` : ""}${c.dd ? " ⭐" : ""}</span>
          </div>`).join("")}${r.clues.length > 80 ? `<div class="muted pad">…and ${r.clues.length - 80} more</div>` : ""}</div>`;
    return wrap(`<h3>📋 Paste questions into “${esc(cur.name)}”</h3>
      <textarea id="lib-paste" class="paste-box" rows="8" spellcheck="false" placeholder="Paste your questions here…" data-input="lib-paste" data-sticky aria-label="Questions to add">${esc(text)}</textarea>
      <div class="paste-opts">
        <label class="xf"><span>Round <small>if your text doesn't say</small></span><select data-change="lib-paste-slot">${B.SLOTS.map((x) => `<option value="${x}"${L.paste.slot === x ? " selected" : ""}>${B.SLOT_LABEL[x]}</option>`).join("")}</select></label>
        <label class="xf"><span>Category <small>if your text doesn't name one</small></span><input id="lib-paste-cat" list="lib-cats" maxlength="60" value="${esc(L.paste.category || "")}" placeholder="optional" data-input="lib-paste-cat" data-sticky></label>
      </div>
      ${preview}
      <div class="btnrow end">${cancel()}<button class="btn primary" data-action="lib-paste-add"${s && s.total ? "" : " disabled"}>${s && s.total ? `Add ${plural(s.total, "question")}` : "Add questions"}</button></div>`, true);
  }

  if (m.type === "libPrompt") {
    const P = L.prompt;
    const avoid = P.avoid ? [...new Set(G.sets.flatMap((s) => s.clues.map((c) => c.answer)).filter(Boolean))] : [];
    const text = B.aiPrompt({ categories: P.categories, perCategory: P.perCategory, slot: P.slot, topics: P.topics, avoid });
    return wrap(`<h3>🤖 Ask ChatGPT or Claude for questions</h3>
      <p class="muted">Copy this request into your AI chat. Paste what it writes back into <b>📋 Paste questions</b> — it comes back in exactly the right format.</p>
      <div class="paste-opts three">
        <label class="xf"><span>Categories</span><input type="number" inputmode="numeric" min="1" max="12" value="${P.categories}" data-input="lib-prompt" data-f="categories" data-sticky></label>
        <label class="xf"><span>Clues in each</span><input type="number" inputmode="numeric" min="1" max="10" value="${P.perCategory}" data-input="lib-prompt" data-f="perCategory" data-sticky></label>
        <label class="xf"><span>Round</span><select data-change="lib-prompt-slot"><option value="r1"${P.slot === "r1" ? " selected" : ""}>Jeopardy</option><option value="r2"${P.slot === "r2" ? " selected" : ""}>Double Jeopardy</option></select></label>
      </div>
      <label class="xf wide"><span>Topics or categories you want <small>optional</small></span><input maxlength="300" value="${esc(P.topics)}" placeholder="e.g. The Grinch, Elf, classic TV specials, Christmas history" data-input="lib-prompt" data-f="topics" data-sticky></label>
      <label class="toggle"><input type="checkbox" data-change="lib-prompt-avoid"${P.avoid ? " checked" : ""}><span>Tell it not to repeat answers from my library (${avoid.length || "none yet"})</span></label>
      <textarea id="lib-prompt-text" class="paste-box" rows="9" readonly aria-label="Request to copy">${esc(text)}</textarea>
      <div class="btnrow end">${cancel("Close")}<button class="btn primary" data-action="lib-prompt-copy">📋 Copy the request</button></div>`, true);
  }

  if (m.type === "libUse") {
    const { rows, skipped, counts } = B.toGameRows(cur);
    const warns = B.checkSet(cur).filter((c) => c.level === "warn");
    const playing = G.S && !["lobby", "minis"].includes(G.S.phase);
    if (!counts.r1) {
      return wrap(`<h3>Not ready yet</h3><p>“${esc(cur.name)}” has no finished Jeopardy-round clues. A clue needs a question, an answer and a category before it can go on the board.</p>
        <div class="btnrow end">${cancel("OK")}</div>`);
    }
    return wrap(`<h3>Put “${esc(cur.name)}” on the board?</h3>
      <ul class="uselist">
        <li><b>${counts.r1}</b> Jeopardy clues${counts.r2 ? ` + <b>${counts.r2}</b> Double Jeopardy` : ""} ${counts.final ? "+ Final Jeopardy" : "— <b>no Final Jeopardy</b>"}</li>
        <li><b>${rows.filter((x) => x.type === "mcq").length}</b> multiple choice · <b>${rows.filter((x) => x.dailyDouble).length}</b> Daily Double</li>
        ${skipped ? `<li class="warn"><b>${skipped}</b> unfinished or unsorted ${skipped === 1 ? "question is" : "questions are"} left out</li>` : ""}
        ${warns.map((w) => `<li class="warn">${esc(w.text)}</li>`).join("")}
      </ul>
      <p class="${playing ? "warnbox" : "muted"}">${playing ? "⚠️ A game is in progress — this replaces the board right now." : "This replaces the questions currently in the game. Your library isn't changed."}</p>
      <div class="btnrow end">${cancel()}<button class="btn primary" data-action="lib-use-go">▶ Load into the game</button></div>`);
  }

  if (m.type === "libMore") {
    return wrap(`<h3>${esc(cur.name)}</h3>
      <div class="morelist">
        <button class="btn ghost" data-action="lib-export-xlsx">⬇ Download as a spreadsheet (.xlsx)</button>
        <button class="btn ghost" data-action="lib-copy-text">📋 Copy all questions as text</button>
        <button class="btn ghost" data-action="lib-download-text">⬇ Download as a text file</button>
        <label class="btn ghost file${cur.locked ? " disabled" : ""}">⬆ Add questions from a spreadsheet<input type="file" accept=".xlsx,.xls" hidden data-change="lib-import-xlsx"${cur.locked ? " disabled" : ""}></label>
        <button class="btn ghost" data-action="lib-duplicate">⧉ Duplicate this set</button>
        <button class="btn ghost" data-action="lib-lock">${cur.locked ? "🔓 Unlock this set" : "🔒 Lock this set (protect a past year)"}</button>
        <button class="btn bad" data-action="lib-delete-ask">🗑 Delete this set…</button>
      </div>
      <div class="btnrow end">${cancel("Close")}</div>`);
  }
  if (m.type === "libDelete") {
    return wrap(`<h3>Delete “${esc(cur.name)}”?</h3><p>All ${plural(cur.clues.length, "question")} in this set are removed from your library for good. The game's current board isn't affected.</p>
      <div class="btnrow end">${cancel()}<button class="btn bad" data-action="lib-delete-yes">Delete set</button></div>`);
  }
  return "";
}
