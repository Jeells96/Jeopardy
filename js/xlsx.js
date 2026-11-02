// Spreadsheet template download + import. Uses global `XLSX` (SheetJS, loaded via CDN).

export const COLUMNS = [
  "Category", "Points", "Question", "Answer", "Type",
  "Choice A", "Choice B", "Choice C", "Choice D", "Correct",
  "Daily Double", "Final Jeopardy",
];

const EXAMPLE_ROWS = [
  ["Christmas Movies", 100, "This 1990 film features Kevin McCallister defending his home from burglars.", "Home Alone", "spoken", "", "", "", "", "", "No", "No"],
  ["Christmas Movies", 200, "In which movie does a boy ride a magical train to the North Pole?", "The Polar Express", "mcq", "Elf", "The Polar Express", "The Grinch", "Klaus", "B", "No", "No"],
  ["Christmas Movies", 300, "DAILY DOUBLE! This grumpy green creature tried to steal Christmas from Whoville.", "The Grinch", "spoken", "", "", "", "", "", "Yes", "No"],
  ["Holiday Songs", 100, "\"Chestnuts roasting on an open fire\" opens which classic song?", "The Christmas Song", "spoken", "", "", "", "", "", "No", "No"],
  ["Holiday Songs", 200, "Which reindeer had a very shiny nose?", "Rudolph", "mcq", "Dasher", "Rudolph", "Comet", "Blitzen", "B", "No", "No"],
  ["Santa Trivia", 100, "What do children traditionally leave out for Santa on Christmas Eve?", "Cookies and milk", "spoken", "", "", "", "", "", "No", "No"],
  ["FINAL JEOPARDY", 0, "This fictional town is home to the Grinch.", "Whoville", "spoken", "", "", "", "", "", "No", "Yes"],
];

export function downloadTemplate() {
  const header = COLUMNS;
  const notes = [
    [],
    ["INSTRUCTIONS — delete this notes block (or leave it; rows without a Question/Category are ignored):"],
    ["• Type must be 'spoken' or 'mcq'."],
    ["• For 'mcq' fill Choice A–D and put the correct letter (A/B/C/D) in Correct. Spoken rows ignore the choices."],
    ["• Daily Double: put 'Yes' to flag that clue as a Daily Double."],
    ["• Final Jeopardy: put 'Yes' on exactly ONE row. Its Category becomes the Final category; Points are ignored."],
    ["• Points are the clue value (100/200/300…). Group clues by Category; order within a category follows row order."],
  ];
  const aoa = [header, ...EXAMPLE_ROWS, ...notes];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 20 }, { wch: 7 }, { wch: 55 }, { wch: 28 }, { wch: 9 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 9 },
    { wch: 13 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  XLSX.writeFile(wb, "christmas-jeopardy-template.xlsx");
}

function letterToIndex(s) {
  if (s == null) return -1;
  const c = String(s).trim().toUpperCase();
  return "ABCD".indexOf(c); // -1 when not A/B/C/D
}
function truthy(v) {
  return ["yes", "y", "true", "1", "x", "✓"].includes(String(v || "").trim().toLowerCase());
}

// Returns { rows, finalCount, error }
export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  if (!aoa.length) return { error: "The spreadsheet is empty." };

  // Find header row (first row containing "Category" and "Question").
  let headerIdx = aoa.findIndex((r) =>
    r.some((c) => String(c).trim().toLowerCase() === "category") &&
    r.some((c) => String(c).trim().toLowerCase() === "question")
  );
  if (headerIdx < 0) headerIdx = 0;
  const header = aoa[headerIdx].map((c) => String(c).trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    category: col("category"), points: col("points"), question: col("question"),
    answer: col("answer"), type: col("type"),
    a: col("choice a"), b: col("choice b"), c: col("choice c"), d: col("choice d"),
    correct: col("correct"), dd: col("daily double"), final: col("final jeopardy"),
  };
  if (idx.category < 0 || idx.question < 0) {
    return { error: "Couldn't find 'Category' and 'Question' columns. Use the provided template." };
  }

  const rows = [];
  let order = 0;
  let finalCount = 0;
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const get = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
    const category = String(get("category") || "").trim();
    const question = String(get("question") || "").trim();
    const isFinal = truthy(get("final"));
    if (!question) continue; // ignore notes / blank rows
    if (!category && !isFinal) continue;

    let type = String(get("type") || "spoken").trim().toLowerCase();
    if (type !== "mcq") type = "spoken";
    const choices = [get("a"), get("b"), get("c"), get("d")].map((x) => String(x || "").trim());
    const hasChoices = choices.some((x) => x);
    if (type === "mcq" && !hasChoices) type = "spoken";

    const row = {
      category: category || "Final Jeopardy",
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
    };
    if (isFinal) finalCount++;
    rows.push(row);
  }
  if (!rows.length) return { error: "No question rows found." };
  return { rows, finalCount };
}
