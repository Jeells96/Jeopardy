// Spreadsheet template download + import. Uses global `XLSX` (SheetJS, loaded via CDN).
//
// NEW layout: each CATEGORY is its own tab (sheet). The tab's name is the category
// shown on the board. Add a tab = new category; delete a tab = remove it. A tab named
// "Final Jeopardy" (or just "Final") holds the Final Jeopardy clue.

// Per-category sheet columns (no "Category" column — the tab name is the category):
export const COLUMNS = [
  "Points", "Question", "Answer", "Type",
  "Choice A", "Choice B", "Choice C", "Choice D", "Correct", "Daily Double",
];
const COL_WIDTHS = [7, 55, 28, 9, 16, 16, 16, 16, 9, 13];

// Example content, grouped by category (tab name -> rows).
const EXAMPLE = {
  "Christmas Movies": [
    [100, "This 1990 film features Kevin McCallister defending his home from burglars.", "Home Alone", "spoken", "", "", "", "", "", ""],
    [200, "In which movie does a boy ride a magical train to the North Pole?", "The Polar Express", "mcq", "Elf", "The Polar Express", "The Grinch", "Klaus", "B", ""],
    [300, "DAILY DOUBLE! This grumpy green creature tried to steal Christmas from Whoville.", "The Grinch", "spoken", "", "", "", "", "", "Yes"],
  ],
  "Holiday Songs": [
    [100, "Chestnuts roasting on an open fire opens which classic song?", "The Christmas Song", "spoken", "", "", "", "", "", ""],
    [200, "Which reindeer had a very shiny nose?", "Rudolph", "mcq", "Dasher", "Rudolph", "Comet", "Blitzen", "B", ""],
  ],
  "Santa Trivia": [
    [100, "What do children traditionally leave out for Santa on Christmas Eve?", "Cookies and milk", "spoken", "", "", "", "", "", ""],
  ],
  "Final Jeopardy": [
    ["", "This fictional town is home to the Grinch.", "Whoville", "spoken", "", "", "", "", "", ""],
  ],
};

const INSTRUCTIONS = [
  ["🎄 Christmas Jeopardy — question template"],
  [],
  ["HOW THIS WORKS:"],
  ["• Each CATEGORY is its own tab (sheet) at the bottom. The tab name is the category shown on the board."],
  ["• Add a tab to add a category. Delete a tab to remove it. Rename a tab to rename the category."],
  ["• Tab names are limited by Excel to 31 characters and can't contain : \\ / ? * [ ]"],
  ["• The tab named 'Final Jeopardy' is the Final round (its first row is used). Rename/keep it, but keep the word 'Final'."],
  [],
  ["IN EACH CATEGORY TAB, fill the columns:"],
  ["• Points  — the clue value (100/200/300…). Clues are ordered by Points, then top-to-bottom."],
  ["• Question / Answer — the clue and its answer."],
  ["• Type — 'spoken' (you judge out loud) or 'mcq' (multiple choice, auto-scored)."],
  ["• Choice A–D + Correct — only for 'mcq'. Put the correct letter (A/B/C/D) in Correct."],
  ["• Daily Double — put 'Yes' to flag that clue as a Daily Double."],
  [],
  ["Tip: the sample tabs show both spoken and multiple-choice clues plus a Daily Double. Edit or replace them."],
  ["Blank rows and this tab are ignored on import."],
];

function sanitizeSheetName(name) {
  // Excel sheet names: <=31 chars, none of : \ / ? * [ ]
  return String(name).replace(/[:\\/?*\[\]]/g, " ").slice(0, 31).trim() || "Category";
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();

  const info = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  info["!cols"] = [{ wch: 95 }];
  XLSX.utils.book_append_sheet(wb, info, "① Read me first");

  for (const [cat, rows] of Object.entries(EXAMPLE)) {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
    ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(cat));
  }
  XLSX.writeFile(wb, "christmas-jeopardy-template.xlsx");
}

function letterToIndex(s) {
  if (s == null) return -1;
  return "ABCD".indexOf(String(s).trim().toUpperCase()); // -1 when not A/B/C/D
}
function truthy(v) {
  return ["yes", "y", "true", "1", "x", "✓"].includes(String(v || "").trim().toLowerCase());
}
function isSkippableTab(name) {
  return /read ?me|instruction|notes|^help$|^info$/i.test(name);
}
function isFinalTab(name) {
  return /^final(\s*jeopardy)?$/i.test(String(name).trim());
}

// Returns { rows, categories, finalCount, error }
export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  if (!wb.SheetNames.length) return { error: "The spreadsheet has no tabs." };

  const rows = [];
  const categories = [];
  let order = 0;
  let finalCount = 0;

  for (const sheetName of wb.SheetNames) {
    const name = String(sheetName).trim();
    if (!name || isSkippableTab(name)) continue;

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    if (!aoa.length) continue;

    // Find the header row (the one containing "Question").
    const headerIdx = aoa.findIndex((r) =>
      r.some((c) => String(c).trim().toLowerCase() === "question")
    );
    if (headerIdx < 0) continue; // not a category sheet (e.g. a notes tab)

    const header = aoa[headerIdx].map((c) => String(c).trim().toLowerCase());
    const col = (n) => header.indexOf(n);
    const idx = {
      points: col("points"), question: col("question"), answer: col("answer"), type: col("type"),
      a: col("choice a"), b: col("choice b"), c: col("choice c"), d: col("choice d"),
      correct: col("correct"), dd: col("daily double"),
    };
    const isFinal = isFinalTab(name);

    let countInCat = 0;
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const r = aoa[i];
      const get = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
      const question = String(get("question") || "").trim();
      if (!question) continue;

      let type = String(get("type") || "spoken").trim().toLowerCase();
      if (type !== "mcq") type = "spoken";
      const choices = [get("a"), get("b"), get("c"), get("d")].map((x) => String(x || "").trim());
      if (type === "mcq" && !choices.some((x) => x)) type = "spoken";

      rows.push({
        category: name,
        points: Number(get("points")) || 0,
        question,
        answer: String(get("answer") || "").trim(),
        type,
        choices: type === "mcq" ? choices : [],
        correctIndex: type === "mcq" ? letterToIndex(get("correct")) : -1,
        dailyDouble: truthy(get("dd")),
        isFinal,
        order: order++,
        used: false,
      });
      countInCat++;
    }
    if (countInCat > 0) {
      categories.push(name);
      if (isFinal) finalCount += countInCat;
    }
  }

  if (!rows.length) {
    return { error: "No clues found. Each category should be its own tab with a 'Question' header row." };
  }
  return { rows, categories, finalCount };
}
