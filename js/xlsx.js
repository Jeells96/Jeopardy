// Spreadsheet template download + import. Uses global `XLSX` (SheetJS, loaded via CDN).
//
// Phone-friendly layout: each CATEGORY is its own tab, and each tab has just a few columns:
//   Points | Question | Answer | Other choices | Daily Double
// - Spoken clue: fill Question + Answer (Points optional — blank auto-numbers 100,200,…).
// - Multiple choice: also put the WRONG options in "Other choices", separated by ";".
//   The app treats Answer as the correct option and shuffles them together.
// A tab named "Final Jeopardy" holds the final clue.

export const COLUMNS = ["Points", "Question", "Answer", "Other choices", "Daily Double"];
const COL_WIDTHS = [8, 34, 24, 30, 13];

// Example content per category: [Points, Question, Answer, Other choices, Daily Double]
const EXAMPLE = {
  "Christmas Movies": [
    [100, "This 1990 film features Kevin McCallister defending his home from burglars.", "Home Alone", "", ""],
    [200, "In which film does a boy ride a magical train to the North Pole?", "The Polar Express", "Elf; The Grinch; Klaus", ""],
    [300, "In 'Elf', what are Buddy's four main food groups?", "Candy, candy canes, candy corn, and syrup", "", ""],
    [400, "Which actor plays Clark Griswold in 'National Lampoon's Christmas Vacation'?", "Chevy Chase", "Bill Murray; Tim Allen; Steve Martin", "Yes"],
    [500, "In 'It's a Wonderful Life', what happens every time a bell rings?", "An angel gets its wings", "", ""],
  ],
  "Holiday Songs": [
    [100, "'Chestnuts roasting on an open fire' opens which classic song?", "The Christmas Song", "", ""],
    [200, "Which reindeer had a very shiny nose?", "Rudolph", "Dasher; Comet; Blitzen", ""],
    [300, "In 'The Twelve Days of Christmas', what is given on the fifth day?", "Five gold rings", "", ""],
    [400, "Mariah Carey's holiday hit begins 'I don't want a lot for ___'.", "Christmas", "presents; money; snow", ""],
    [500, "Which 1984 charity single asks 'Do They Know It's Christmas?'", "Band Aid", "", ""],
  ],
  "Santa & Reindeer": [
    [100, "What do children traditionally leave out for Santa on Christmas Eve?", "Cookies and milk", "", ""],
    [200, "How does Santa typically enter a house?", "The chimney", "The window; The front door; The garage", ""],
    [300, "What is the name of Santa's wife?", "Mrs. Claus", "", ""],
    [400, "According to the song, Rudolph's nose did what?", "Glowed", "Sang; Whistled; Sneezed", "Yes"],
    [500, "Name any three of Santa's eight reindeer (besides Rudolph).", "Dasher, Dancer, Prancer, Vixen, Comet, Cupid, Donner, Blitzen", "", ""],
  ],
  "Around the World": [
    [100, "In which country did the Christmas tree tradition originate?", "Germany", "France; Italy; Spain", ""],
    [200, "In Mexico, what are the Christmas processions reenacting Mary and Joseph's search for lodging called?", "Las Posadas", "", ""],
    [300, "In which country does 'La Befana', a kindly witch, bring gifts?", "Italy", "Greece; Russia; Poland", ""],
    [400, "In Japan, which fast-food meal has become a popular Christmas tradition?", "KFC (fried chicken)", "", ""],
    [500, "In Sweden, the Christmas season includes a festival of light honoring which saint?", "St. Lucia", "St. Nicholas; St. Stephen; St. Olaf", ""],
  ],
  "Festive Food & Drink": [
    [100, "What creamy, spiced drink is a Christmas favorite, often spiked with rum?", "Eggnog", "", ""],
    [200, "What fruit is traditionally placed in a Christmas stocking?", "An orange", "An apple; A banana; A grape", ""],
    [300, "What green plant, often hung in doorways, invites a Christmas kiss?", "Mistletoe", "", ""],
    [400, "A traditional British Christmas dessert set alight with brandy is called what?", "Christmas pudding", "Trifle; Mince pie; Yule log", ""],
    [500, "What candy is traditionally shaped like a shepherd's crook with red and white stripes?", "Candy cane", "", ""],
  ],
  "Books & TV": [
    [100, "Who wrote 'A Christmas Carol'?", "Charles Dickens", "", ""],
    [200, "What is the name of Scrooge's deceased business partner?", "Jacob Marley", "Bob Cratchit; Tiny Tim; Fezziwig", ""],
    [300, "In 'How the Grinch Stole Christmas', what is the name of the Grinch's dog?", "Max", "", ""],
    [400, "'Frosty the Snowman' came to life thanks to what?", "A magic hat", "A wish; A snowball; A star", ""],
    [500, "In 'A Charlie Brown Christmas', what kind of tree does Charlie Brown pick out?", "A small, scrawny tree", "", ""],
  ],
  "Final Jeopardy": [
    ["", "This poem beginning 'Twas the night before Christmas' is formally titled this.", "A Visit from St. Nicholas", "", ""],
  ],
};

const INSTRUCTIONS = [
  ["🎄 Christmas Jeopardy — question template (easy on your phone!)"],
  [],
  ["THE BASICS:"],
  ["• Each CATEGORY is its own tab at the bottom. The tab name IS the category on the board."],
  ["• Add a tab = new category. Delete a tab = remove it. Rename a tab = rename the category."],
  ["• For most clues you only fill TWO things: Question and Answer."],
  [],
  ["THE COLUMNS:"],
  ["• Points — leave blank to auto-number (100, 200, 300…), or type your own value."],
  ["• Question — the clue."],
  ["• Answer — the correct answer."],
  ["• Other choices — ONLY for multiple choice. Type the WRONG options separated by a"],
  ["      semicolon ;   e.g.   Elf; The Grinch; Klaus"],
  ["      The app adds your Answer as the correct option and shuffles them. Leave blank = spoken."],
  ["• Daily Double — pick Yes to make a clue a Daily Double."],
  [],
  ["FINAL JEOPARDY:"],
  ["• The tab named 'Final Jeopardy' is the final clue (its first row is used)."],
  [],
  ["PHONE TIP: tap a cell and type in the bar at the top. There are only a few columns now,"],
  ["so there's very little side-scrolling. This notes tab is ignored on import."],
];

function sanitizeSheetName(name) {
  return String(name).replace(/[:\\/?*\[\]]/g, " ").slice(0, 31).trim() || "Category";
}

export async function downloadTemplate() {
  // Prefer the prebuilt, nicely formatted file (wrapped text, tall rows, dropdowns).
  try {
    const res = await fetch("./christmas-jeopardy-template.xlsx", { cache: "no-store" });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "christmas-jeopardy-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
  } catch (e) { /* fall through */ }

  const wb = XLSX.utils.book_new();
  const info = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  info["!cols"] = [{ wch: 92 }];
  XLSX.utils.book_append_sheet(wb, info, "① Read me first");
  for (const [cat, rows] of Object.entries(EXAMPLE)) {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
    ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
    ws["!rows"] = [{ hpt: 26 }, ...rows.map(() => ({ hpt: 64 }))];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(cat));
  }
  XLSX.writeFile(wb, "christmas-jeopardy-template.xlsx");
}

function truthy(v) {
  return ["yes", "y", "true", "1", "x", "✓"].includes(String(v || "").trim().toLowerCase());
}
function letterToIndex(s) {
  if (s == null) return -1;
  return "ABCD".indexOf(String(s).trim().toUpperCase());
}
function isSkippableTab(name) {
  return /read ?me|instruction|notes|^help$|^info$/i.test(name);
}
function isFinalTab(name) {
  return /^final(\s*jeopardy)?$/i.test(String(name).trim());
}
function splitChoices(s) {
  const raw = String(s || "").trim();
  if (!raw) return [];
  const parts = /[\n;]/.test(raw) ? raw.split(/[\n;]+/) : raw.split(",");
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const v = p.trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

    const headerIdx = aoa.findIndex((r) =>
      r.some((c) => String(c).trim().toLowerCase() === "question")
    );
    if (headerIdx < 0) continue;

    const header = aoa[headerIdx].map((c) => String(c).trim().toLowerCase());
    const col = (names) => {
      for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
      return -1;
    };
    const idx = {
      points: col(["points", "value"]),
      question: col(["question", "clue"]),
      answer: col(["answer", "correct answer"]),
      other: col(["other choices", "other options", "wrong options", "wrong answers", "choices", "options", "distractors"]),
      dd: col(["daily double", "dailydouble", "daily-double", "dd"]),
      type: col(["type"]),
      a: col(["choice a"]), b: col(["choice b"]), c: col(["choice c"]), d: col(["choice d"]),
      correct: col(["correct"]),
    };
    const isFinal = isFinalTab(name);

    let autoPoints = 0;
    let countInCat = 0;
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const r = aoa[i];
      const get = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
      const question = String(get("question") || "").trim();
      if (!question) continue;
      autoPoints += 100;

      const answer = String(get("answer") || "").trim();
      const typeExplicit = String(get("type") || "").trim().toLowerCase();

      // Build choices: legacy 4-column layout, else the single "Other choices" column.
      let type = "spoken";
      let choices = [];
      let correctIndex = -1;
      const legacy = [get("a"), get("b"), get("c"), get("d")].map((x) => String(x || "").trim());
      const hasLegacy = legacy.some((x) => x);
      const other = splitChoices(get("other"));

      if (typeExplicit !== "spoken") {
        if (hasLegacy) {
          choices = legacy.filter((x) => x);
          correctIndex = letterToIndex(get("correct"));
          if (correctIndex < 0 && answer) {
            const ai = choices.findIndex((c) => c.toLowerCase() === answer.toLowerCase());
            correctIndex = ai >= 0 ? ai : 0;
          }
          type = "mcq";
        } else if (other.length && answer) {
          const all = shuffle([answer, ...other]).slice(0, 6);
          choices = all;
          correctIndex = all.findIndex((c) => c.toLowerCase() === answer.toLowerCase());
          if (correctIndex < 0) { choices = [answer, ...other]; correctIndex = 0; }
          type = "mcq";
        }
      }

      rows.push({
        category: name,
        points: Number(get("points")) || autoPoints,
        question,
        answer,
        type,
        choices: type === "mcq" ? choices : [],
        correctIndex: type === "mcq" ? correctIndex : -1,
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
