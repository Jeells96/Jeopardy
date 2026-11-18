// Question library controller: what happens when the host taps, types or changes something
// on the library screen. Kept apart from app.js so the game screens stay simple.
import * as B from "./bank.js";
import { currentSet } from "./ui/library.js";
import { parseWorkbook, exportSetXlsx } from "./xlsx.js";

export function initLibrary(G) {
  G.sets = [];
  G.setsReady = false;
  G.ui.lib = {
    setId: null, search: "", filter: "all", open: {}, showChecks: false, newFrom: "empty", undo: null,
    clip: { mode: "move", items: [] }, // questions picked to copy or move: [{ setId, id, slot, category }]
    paste: { text: "", slot: "r1", category: "" },
    prompt: { categories: 6, perCategory: 5, slot: "r1", topics: "", avoid: true },
  };
}

// ---------- small helpers ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = document.createElement("textarea");
  t.value = text;
  t.style.position = "fixed";
  t.style.opacity = "0";
  document.body.appendChild(t);
  t.select();
  let done = false;
  try { done = document.execCommand("copy"); } catch { done = false; }
  t.remove();
  return done;
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const slug = (s) => String(s || "questions").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "questions";
function focusSoon(find, tries = 15) {
  const go = () => {
    const el = typeof find === "function" ? find() : document.querySelector(find);
    if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (--tries > 0) setTimeout(go, 100);
  };
  setTimeout(go, 100);
}
// After adding a blank clue, put the cursor in its question box once it shows up.
function focusNewClue(G, setId, before) {
  focusSoon(() => {
    const set = G.sets.find((s) => s.id === setId);
    const fresh = set && set.clues.find((c) => !before.has(c.id));
    return fresh ? document.querySelector(`[data-id="${fresh.id}"][data-f="question"]`) : null;
  });
}
async function sampleClues(file = "sample-game") {
  const res = await fetch(`./sets/${file}.txt`, { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load those questions — check your connection and try again.");
  return B.parsePaste(await res.text()).clues;
}
const clearSearch = (L) => { L.search = ""; const i = document.getElementById("lib-search"); if (i) i.value = ""; };

// ---------- taps ----------
export async function libClick(a, el, ctx) {
  const { G, D, toast, render } = ctx;
  const L = G.ui.lib;
  const cur = currentSet(G);
  const d = el.dataset || {};
  const close = () => { G.ui.modal = null; };

  switch (a) {
    case "lib-select": L.setId = d.id; L.filter = "all"; L.undo = null; clearSearch(L); render(); window.scrollTo(0, 0); return;
    case "lib-search-clear": clearSearch(L); return render();
    case "lib-add-test": {
      const set = B.newSet({ name: "Test game (not Christmas)", year: new Date().getFullYear(), clues: await sampleClues("test-game") });
      await D.createSet(set);
      L.setId = set.id;
      render();
      return toast("Added the test game ✓ — one category plus Final, nothing from the real game", "good");
    }
    case "lib-new": L.newFrom = "empty"; G.ui.modal = { type: "libNew" }; render(); return focusSoon("#ns-name");
    case "lib-add-sample": {
      const set = B.newSet({ name: "Sample game", year: new Date().getFullYear(), clues: await sampleClues() });
      await D.createSet(set);
      L.setId = set.id;
      render();
      return toast("Added the sample game ✓", "good");
    }
    case "lib-new-create": {
      const name = (document.getElementById("ns-name") || {}).value || "";
      const year = (document.getElementById("ns-year") || {}).value;
      let clues = [];
      if (L.newFrom === "game") clues = B.fromGameRows(G.Q);
      else if (L.newFrom === "sample") clues = await sampleClues();
      else if (L.newFrom === "test") clues = await sampleClues("test-game");
      else if (L.newFrom === "sample2") clues = await sampleClues("sample-game-2");
      const set = B.newSet({ name, year, clues });
      await D.createSet(set);
      L.setId = set.id; L.filter = "all"; clearSearch(L); close(); render();
      return toast(`Created “${set.name}” ✓`, "good");
    }
    case "lib-filter": L.filter = d.v === "todo" ? "todo" : "all"; return render();
    case "lib-checks": L.showChecks = !L.showChecks; return render();
    case "lib-toggle": L.open[d.id] = !L.open[d.id]; return render();
  }
  if (!cur) return;

  switch (a) {
    case "lib-add-clue": {
      const before = new Set(cur.clues.map((c) => c.id));
      await D.setOp(cur.id, "addClues", { clues: [{ slot: d.slot || "r1", category: d.cat || "" }] });
      if (L.filter === "todo") { /* stays visible: a blank clue is unfinished */ }
      return focusNewClue(G, cur.id, before);
    }
    case "lib-add-cat": {
      const input = document.getElementById("new-cat-" + d.slot);
      const name = input ? input.value.trim() : "";
      if (!name) { if (input) input.focus(); return toast("Type the category name first.", "bad"); }
      if (cur.clues.some((c) => c.slot === d.slot && c.category.toLowerCase() === name.toLowerCase())) return toast("That category is already in this round.", "bad");
      input.value = "";
      const before = new Set(cur.clues.map((c) => c.id));
      await D.setOp(cur.id, "addClues", { clues: [{ slot: d.slot, category: name }] });
      return focusNewClue(G, cur.id, before);
    }
    case "lib-cat-move": await D.setOp(cur.id, "moveCategory", { slot: d.slot, name: d.name, dir: Number(d.dir) }); return;
    case "lib-clue-move": await D.setOp(cur.id, "moveClue", { id: d.id, dir: Number(d.dir) }); return;
    case "lib-clue-del": {
      const clue = cur.clues.find((c) => c.id === d.id);
      if (!clue) return;
      await D.setOp(cur.id, "removeClue", { id: d.id });
      delete L.open[d.id];
      L.clip.items = L.clip.items.filter((x) => x.id !== d.id);
      if (clue.question || clue.answer) { L.undo = { setId: cur.id, clues: [clue], label: `“${(clue.question || clue.answer).slice(0, 60)}”` }; toast("Question deleted — tap Undo at the top to bring it back."); }
      return render();
    }
    case "lib-undo-del": {
      const u = L.undo;
      L.undo = null;
      if (u) { await D.setOp(u.setId, "addClues", { clues: u.clues }); toast(u.clues.length > 1 ? "Category restored ✓" : "Question restored ✓", "good"); }
      return render();
    }
    case "lib-pick": {
      const c = cur.clues.find((x) => x.id === d.id);
      if (!c) return;
      const had = L.clip.items.some((x) => x.id === c.id);
      L.clip.items = had ? L.clip.items.filter((x) => x.id !== c.id) : [...L.clip.items, { setId: cur.id, id: c.id, slot: c.slot, category: c.category }];
      if (cur.locked) L.clip.mode = "copy";
      return render();
    }
    case "lib-cat-pick": {
      const mine = cur.clues.filter((c) => c.slot === d.slot && c.category.toLowerCase() === d.name.toLowerCase());
      const ids = new Set(L.clip.items.map((x) => x.id));
      const all = mine.every((c) => ids.has(c.id));
      L.clip.items = all ? L.clip.items.filter((x) => !mine.some((c) => c.id === x.id))
        : [...L.clip.items, ...mine.filter((c) => !ids.has(c.id)).map((c) => ({ setId: cur.id, id: c.id, slot: c.slot, category: c.category }))];
      if (cur.locked) L.clip.mode = "copy";
      return render();
    }
    case "lib-clip-mode": L.clip.mode = d.v === "copy" ? "copy" : "move"; return render();
    case "lib-clip-clear": L.clip.items = []; return render();
    case "lib-paste-here": return pasteClip(ctx, cur, d.slot, d.cat || "");
    case "lib-paste-newcat": {
      const input = document.getElementById("new-cat-" + d.slot);
      const name = input ? input.value.trim() : "";
      if (!name) { if (input) input.focus(); return toast("Type the new category's name first, then paste.", "bad"); }
      if (cur.clues.some((c) => c.slot === d.slot && c.category.toLowerCase() === name.toLowerCase())) return toast("That category is already in this round — use its 📥 Paste here button.", "bad");
      input.value = "";
      return pasteClip(ctx, cur, d.slot, name);
    }
    case "lib-cat-del-ask": G.ui.modal = { type: "libCatDelete", slot: d.slot, name: d.name }; return render();
    case "lib-cat-del-yes": {
      const m = G.ui.modal || {};
      const gone = cur.clues.filter((c) => c.slot === m.slot && c.category.toLowerCase() === String(m.name).toLowerCase());
      close();
      if (!gone.length) return render();
      await D.setOp(cur.id, "removeCategory", { slot: m.slot, name: m.name });
      const goneIds = new Set(gone.map((c) => c.id));
      L.clip.items = L.clip.items.filter((x) => !goneIds.has(x.id));
      L.undo = { setId: cur.id, clues: gone, label: `the “${m.name}” category (${gone.length} question${gone.length === 1 ? "" : "s"})` };
      render();
      return toast("Category deleted — tap Undo at the top to bring it back.");
    }
    case "lib-paste-open": L.paste = { text: "", slot: "r1", category: "" }; G.ui.modal = { type: "libPaste" }; render(); return focusSoon("#lib-paste");
    case "lib-paste-add": {
      const r = B.parsePaste(L.paste.text, { slot: L.paste.slot, category: L.paste.category });
      if (!r.clues.length) return toast("I couldn't find any questions in that text.", "bad");
      await D.setOp(cur.id, "addClues", { clues: r.clues });
      L.paste.text = ""; L.filter = "all"; close(); render();
      const s = r.stats;
      return toast(`Added ${s.total} question${s.total === 1 ? "" : "s"} ✓${s.needCategory ? ` — ${s.needCategory} need a category (see Unsorted)` : ""}`, "good");
    }
    case "lib-prompt-open": G.ui.modal = { type: "libPrompt" }; return render();
    case "lib-prompt-copy": {
      const box = document.getElementById("lib-prompt-text");
      const done = await copyText(box ? box.value : "");
      return toast(done ? "Copied ✓ — paste it into ChatGPT or Claude" : "Couldn't copy automatically — select the text and copy it.", done ? "good" : "bad");
    }
    case "lib-use": G.ui.modal = { type: "libUse" }; return render();
    case "lib-use-go": {
      const res = await D.loadSetIntoGame(cur);
      close(); render();
      return toast(`“${cur.name}” is on the board ✓ (${res.rows} questions)`, "good");
    }
    case "lib-more": G.ui.modal = { type: "libMore" }; return render();
    case "lib-export-xlsx": exportSetXlsx(cur, B.groupSet(cur)); return;
    case "lib-copy-text": {
      const done = await copyText(B.toText(cur));
      return toast(done ? "All questions copied as text ✓" : "Couldn't copy automatically — use Download as a text file.", done ? "good" : "bad");
    }
    case "lib-download-text": download(slug(cur.name) + ".txt", B.toText(cur)); return;
    case "lib-duplicate": {
      const copy = B.newSet({ name: (cur.name + " (copy)").slice(0, 60), year: cur.year, clues: cur.clues, notes: cur.notes });
      await D.createSet(copy);
      L.setId = copy.id; close(); render();
      return toast(`Made “${copy.name}” ✓`, "good");
    }
    case "lib-lock": await D.setOp(cur.id, "meta", { patch: { locked: !cur.locked } }); close(); return render();
    case "lib-delete-ask": G.ui.modal = { type: "libDelete" }; return render();
    case "lib-delete-yes": {
      const name = cur.name;
      await D.deleteSet(cur.id);
      L.setId = null; close(); render();
      return toast(`Deleted “${name}”`);
    }
    case "lib-copy-hit": {
      const from = G.sets.find((s) => s.id === d.from);
      const clue = from && from.clues.find((c) => c.id === d.id);
      if (!clue) return;
      await D.setOp(cur.id, "addClues", { clues: [clue] });
      return toast(`Copied into “${cur.name}” ✓`, "good");
    }
  }
}

// Paste the picked questions into a category (or the Final / Unsorted section).
async function pasteClip({ G, D, toast, render }, cur, slot, category) {
  const L = G.ui.lib;
  const C = L.clip;
  const n = C.items.length;
  if (!n) return;
  const sameSet = C.items.filter((x) => x.setId === cur.id).map((x) => x.id);
  const others = C.items.filter((x) => x.setId !== cur.id);
  const fresh = [];
  for (const x of others) {
    const src = G.sets.find((s) => s.id === x.setId);
    const c = src && src.clues.find((y) => y.id === x.id);
    if (c) fresh.push({ src, c });
  }
  if (C.mode === "copy") {
    const local = cur.clues.filter((c) => sameSet.includes(c.id));
    const all = [...local, ...fresh.map((f) => f.c)].map((c) => ({ ...c, slot, category, points: null, dd: slot === "final" ? false : c.dd }));
    await D.setOp(cur.id, "addClues", { clues: all });
  } else {
    if (sameSet.length) await D.setOp(cur.id, "moveClues", { ids: sameSet, slot, category });
    if (fresh.length) {
      await D.setOp(cur.id, "addClues", { clues: fresh.map(({ c }) => ({ ...c, slot, category, points: null })) });
      for (const { src, c } of fresh) if (!src.locked) await D.setOp(src.id, "removeClue", { id: c.id });
    }
    C.items = [];
  }
  const where = category ? `“${category}”` : slot === "final" ? "Final Jeopardy" : "Unsorted";
  render();
  return toast(`${C.mode === "copy" ? "Copied" : "Moved"} ${n} question${n === 1 ? "" : "s"} to ${where} ✓`, "good");
}

// Double Jeopardy was removed. Any set that still has Double Jeopardy questions gets them
// moved (not deleted) into a new set of their own, as regular $100–$500 categories.
let splitting = false;
export async function splitOldDoubleJeopardy({ G, D, toast }) {
  if (splitting) return;
  const old = G.sets.find((s) => s.clues.some((c) => c.slot === "r2"));
  if (!old) return;
  splitting = true;
  try {
    const moved = old.clues.filter((c) => c.slot === "r2").map((c) => ({ ...c, slot: "r1", points: c.points ? Math.max(100, Math.round(c.points / 2)) : null }));
    // Remove them first in a transaction: only one device can win this, so no duplicates.
    const changed = await D.setOp(old.id, "dropRound2", {});
    if (changed) {
      const name = `${old.name} – extra categories`.slice(0, 60);
      await D.createSet(B.newSet({ name, year: old.year, clues: moved }));
      toast(`Double Jeopardy is gone — its ${moved.length} questions from “${old.name}” are saved in a new set: “${name}”.`, "good");
    }
  } finally {
    splitting = false;
  }
  if (G.sets.some((s) => s.id !== old.id && s.clues.some((c) => c.slot === "r2"))) setTimeout(() => splitOldDoubleJeopardy({ G, D, toast }).catch(() => {}), 500);
}

// ---------- edits (fired when a field is committed) ----------
export async function libChange(k, el, ctx) {
  const { G, D, toast, render } = ctx;
  const L = G.ui.lib;
  const cur = currentSet(G);
  const d = el.dataset || {};
  switch (k) {
    case "lib-new-from": L.newFrom = el.value; return render();
    case "lib-paste-slot": L.paste.slot = el.value; return render();
    case "lib-prompt-slot": L.prompt.slot = el.value; return render();
    case "lib-prompt-avoid": L.prompt.avoid = el.checked; return render();
  }
  if (!cur) return;
  switch (k) {
    case "lib-meta": await D.setOp(cur.id, "meta", { patch: { [d.f]: el.value } }); return;
    case "lib-clue": await D.setOp(cur.id, "updateClue", { id: d.id, patch: { [d.f]: el.value } }); return;
    case "lib-clue-bool": await D.setOp(cur.id, "updateClue", { id: d.id, patch: { [d.f]: d.invert ? !el.checked : el.checked } }); return;
    case "lib-cat-rename": await D.setOp(cur.id, "renameCategory", { slot: d.slot, from: d.from, to: el.value }); return;
    case "lib-copy": {
      const target = G.sets.find((s) => s.id === el.value);
      const clue = cur.clues.find((c) => c.id === d.id);
      el.value = "";
      if (!target || !clue) return;
      await D.setOp(target.id, "addClues", { clues: [clue] });
      return toast(`Copied to “${target.name}” ✓`, "good");
    }
    case "lib-import-xlsx": {
      const file = el.files && el.files[0];
      if (!file) return;
      try {
        const { rows, error } = parseWorkbook(await file.arrayBuffer());
        if (error) return toast(error, "bad");
        const clues = B.fromGameRows(rows);
        await D.setOp(cur.id, "addClues", { clues });
        G.ui.modal = null;
        render();
        return toast(`Added ${clues.length} questions from the spreadsheet ✓`, "good");
      } finally { el.value = ""; }
    }
  }
}

// ---------- typing ----------
export function libInput(k, el, ctx) {
  const { G, render } = ctx;
  const L = G.ui.lib;
  switch (k) {
    case "lib-search": L.search = el.value; return render();
    case "lib-paste": L.paste.text = el.value; return render();
    case "lib-paste-cat": L.paste.category = el.value; return render();
    case "lib-prompt": {
      const f = el.dataset.f;
      if (f === "topics") L.prompt.topics = el.value;
      else { const n = Math.round(Number(el.value)); if (n >= 1 && n <= 12) L.prompt[f] = n; }
      return render();
    }
  }
}
