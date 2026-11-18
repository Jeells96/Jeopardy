"""Builds christmas-jeopardy-template.xlsx (run: python3 tools/make_template.py).

Phone-friendly: one tab per category, five short columns, wrapped text, tall rows,
a Yes/No dropdown for Daily Double. (The extra set of categories, SAMPLE2, is written
to sets/sample-game-2.txt as a second sample set for the question library.)
"""
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "christmas-jeopardy-template.xlsx")

COLS = ["Points", "Question", "Answer", "Other choices", "Daily Double"]
WIDTHS = [8, 34, 24, 30, 13]
CENTER = {1, 5}

# [Points, Question, Answer, Other choices (wrong options; makes it multiple choice), Daily Double]
ROUND1 = {
    "Christmas Movies": [
        [100, "This 1990 film features Kevin McCallister defending his home from burglars.", "Home Alone", "", ""],
        [200, "In which film does a boy ride a magical train to the North Pole?", "The Polar Express", "Elf; The Grinch; Klaus", ""],
        [300, "In 'Elf', Buddy's four main food groups are all types of this.", "Candy (and syrup)", "", ""],
        [400, "Which actor plays Clark Griswold in 'National Lampoon's Christmas Vacation'?", "Chevy Chase", "Bill Murray; Tim Allen; Steve Martin", "Yes"],
        [500, "In 'It's a Wonderful Life', the angel Clarence is trying to earn these.", "His wings", "", ""],
    ],
    "Holiday Songs": [
        [100, "Nat King Cole made this Mel Tormé standard famous; it's often nicknamed for the chestnuts in its first line.", "The Christmas Song", "", ""],
        [200, "Which reindeer had a very shiny nose?", "Rudolph", "Dasher; Comet; Blitzen", ""],
        [300, "In 'The Twelve Days of Christmas', this is given on the fifth day.", "Five gold rings", "", ""],
        [400, "Mariah Carey's 1994 hit is titled 'All I Want for Christmas Is' this.", "You", "A Puppy; Snow; Peace", ""],
        [500, "Bob Geldof and Midge Ure gathered this 1984 supergroup to record 'Do They Know It's Christmas?'", "Band Aid", "", ""],
    ],
    "Santa & Reindeer": [
        [100, "What do children traditionally leave out for Santa on Christmas Eve?", "Cookies and milk", "", ""],
        [200, "How does Santa traditionally get into a house?", "The chimney", "The window; The front door; The garage", ""],
        [300, "What is the name of Santa's wife?", "Mrs. Claus", "", ""],
        [400, "In the song, what is special about Rudolph's nose?", "It glows", "It sings; It whistles; It sneezes", "Yes"],
        [500, "Name any three of Santa's eight classic reindeer.", "Dasher, Dancer, Prancer, Vixen, Comet, Cupid, Donner, Blitzen", "", ""],
    ],
    "Around the World": [
        [100, "In which country did the Christmas tree tradition begin?", "Germany", "France; Italy; Spain", ""],
        [200, "In Mexico, these nine nights of processions reenact Mary and Joseph's search for lodging.", "Las Posadas", "", ""],
        [300, "In which country does La Befana, a kindly witch, bring gifts?", "Italy", "Greece; Russia; Poland", ""],
        [400, "In Japan, a bucket from this fast-food chain is a popular Christmas dinner.", "KFC", "", ""],
        [500, "Sweden's festival of light in December honors which saint?", "St. Lucia", "St. Nicholas; St. Stephen; St. Olaf", ""],
    ],
    "Festive Food & Drink": [
        [100, "This creamy, spiced drink is a Christmas favorite, often spiked with rum.", "Eggnog", "", ""],
        [200, "Which fruit is traditionally tucked into the toe of a Christmas stocking?", "An orange", "An apple; A banana; A grape", ""],
        [300, "This plant, hung in doorways, invites a Christmas kiss.", "Mistletoe", "", ""],
        [400, "A British Christmas dessert that's set alight with brandy is called this.", "Christmas pudding", "Trifle; Mince pie; Yule log", ""],
        [500, "This striped candy is shaped like a shepherd's crook.", "Candy cane", "", ""],
    ],
    "Books & TV": [
        [100, "Who wrote 'A Christmas Carol'?", "Charles Dickens", "", ""],
        [200, "What is the name of Scrooge's late business partner?", "Jacob Marley", "Bob Cratchit; Tiny Tim; Fezziwig", ""],
        [300, "In 'How the Grinch Stole Christmas!', what is the name of the Grinch's dog?", "Max", "", ""],
        [400, "In the song, Frosty the Snowman comes to life thanks to this.", "A magic hat", "A wish; A snowball; A star", ""],
        [500, "In 'A Charlie Brown Christmas', Charlie Brown picks out this kind of tree.", "A small, scrawny real tree", "", ""],
    ],
}

ROUND2 = {
    "DJ Holiday History": [
        [200, "This country sends London a Christmas tree for Trafalgar Square every year to thank Britain for WWII help.", "Norway", "", ""],
        [400, "In 1870 this U.S. president signed the law making Christmas a federal holiday.", "Ulysses S. Grant", "Abraham Lincoln; Andrew Johnson; Rutherford B. Hayes", ""],
        [600, "The famous 1914 Christmas truce, with soccer in no-man's-land, happened during this war.", "World War I", "", ""],
        [800, "This king gave the first royal Christmas broadcast on the radio in 1932.", "George V", "Victoria; George VI; Edward VII", ""],
        [1000, "The first electric Christmas tree lights were shown in 1882 by a colleague of this inventor.", "Thomas Edison", "", "Yes"],
    ],
    "DJ Silver Screen Santas": [
        [200, "Tim Allen accidentally becomes Santa in this 1994 comedy.", "The Santa Clause", "", ""],
        [400, "In 'Miracle on 34th Street', Kris Kringle is hired as Santa at this department store.", "Macy's", "Gimbels; Bloomingdale's; Saks", ""],
        [600, "This 2003 film weaves together several love stories in London at Christmastime.", "Love Actually", "", ""],
        [800, "This actor voices the Conductor, Santa and more in 'The Polar Express'.", "Tom Hanks", "Jim Carrey; Robin Williams; Billy Crystal", ""],
        [1000, "Bill Murray plays a TV executive visited by three ghosts in this 1988 comedy.", "Scrooged", "", ""],
    ],
    "DJ Carols & Composers": [
        [200, "This carol was first performed on Christmas Eve 1818 in Oberndorf, Austria.", "Silent Night", "", ""],
        [400, "Tchaikovsky's ballet featuring the Sugar Plum Fairy.", "The Nutcracker", "Swan Lake; Sleeping Beauty; Giselle", ""],
        [600, "Irving Berlin wrote this Bing Crosby classic, one of the best-selling singles ever.", "White Christmas", "", ""],
        [800, "James Lord Pierpont first published this song in 1857 as 'The One Horse Open Sleigh'.", "Jingle Bells", "", "Yes"],
        [1000, "Handel's oratorio with the famous 'Hallelujah' chorus.", "Messiah", "Water Music; Israel in Egypt; Judas Maccabaeus", ""],
    ],
    "DJ Traditions": [
        [200, "Dutch children leave out shoes on December 5th for this gift-bringer.", "Sinterklaas", "", ""],
        [400, "Iceland has 13 of these mischievous visitors in the days before Christmas.", "Yule Lads", "Trolls; Elves; Gnomes", ""],
        [600, "Find this vegetable-shaped ornament hidden in the tree and you get an extra gift.", "A pickle", "", ""],
        [800, "In Ukraine, trees are decorated with ornaments shaped like these, from a folk tale.", "Spider webs", "Feathers; Fishing nets; Lace", ""],
        [1000, "In Catalonia, kids tap the Tió de Nadal, a smiling log, so it will 'deliver' these.", "Sweets and small presents", "", ""],
    ],
    "DJ Santa's Workshop": [
        [200, "This reindeer's name comes from the German word for thunder.", "Donner", "", ""],
        [400, "In the 1823 poem 'A Visit from St. Nicholas', Santa's sleigh is described as this size.", "Miniature", "Gigantic; Golden; Crystal", ""],
        [600, "The same 1823 poem gave Santa this many reindeer.", "Eight", "", ""],
        [800, "His drawings in Harper's Weekly in the 1860s–80s shaped the modern image of Santa.", "Thomas Nast", "", ""],
        [1000, "The real Saint Nicholas was a bishop in Myra, a city in what is now this country.", "Turkey", "Greece; Italy; Egypt", ""],
    ],
    "DJ Sweet Treats": [
        [200, "Gingerbread houses took off in this country after 'Hansel and Gretel' was published.", "Germany", "France; England; Sweden", ""],
        [400, "This tall, domed sweet bread from Milan is an Italian Christmas staple.", "Panettone", "", ""],
        [600, "Candy canes are traditionally flavored with this.", "Peppermint", "", ""],
        [800, "The French Bûche de Noël cake is shaped like one of these.", "A log", "A star; A tree; A bell", ""],
        [1000, "This fruit bread dusted with powdered sugar is famous in Dresden, Germany.", "Stollen", "", ""],
    ],
}

FINAL = ["Famous Poems", "This 1823 poem beginning 'Twas the night before Christmas' is formally titled this.", "A Visit from St. Nicholas"]

INSTRUCTIONS = [
    ["Christmas Jeopardy - question template (easy on your phone!)"],
    [],
    ["THE BASICS"],
    ["- Each CATEGORY is its own tab at the bottom. The tab name IS the category on the board."],
    ["- Add a tab = new category. Delete a tab = remove it. Rename a tab = rename the category."],
    ["- For most clues you only fill TWO things: Question and Answer."],
    [],
    ["THE COLUMNS"],
    ["- Points: leave blank to auto-number ($100-$500)."],
    ["- Question: the clue.   Answer: the correct answer."],
    ["- Other choices: ONLY for multiple choice. Type the WRONG options separated by a"],
    ["     semicolon ;   for example:   Elf; The Grinch; Klaus"],
    ["     The game adds your Answer as the right option and shuffles them. Blank = spoken clue."],
    ["- Daily Double: pick Yes. The real show has 1 per board."],
    [],
    ["FINAL JEOPARDY"],
    ["- The 'Final Jeopardy' tab: put the category, the clue and the answer in the first row."],
    [],
    ["PHONE TIP: tap a cell and type in the bar at the top. This tab is ignored on import."],
]

wb = openpyxl.Workbook()
info = wb.active
info.title = "Read me first"
info.column_dimensions["A"].width = 92
for row in INSTRUCTIONS:
    info.append(row)
info["A1"].font = Font(bold=True, size=14, color="C1121F")
for r, row in enumerate(INSTRUCTIONS, 1):
    if row and row[0] in ("THE BASICS", "THE COLUMNS", "FINAL JEOPARDY"):
        info.cell(row=r, column=1).font = Font(bold=True)

thin = Side(style="thin", color="D5D5D5")
border = Border(left=thin, right=thin, top=thin, bottom=thin)


def header(ws, cols, widths, fill):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=1, column=i, value=c)
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.font = Font(bold=True, color="FFFFFF", size=11)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"


def body(ws, rows, ncols, center):
    for r in rows:
        ws.append(r)
    for ri in range(2, len(rows) + 2):
        ws.row_dimensions[ri].height = 74
        for ci in range(1, ncols + 1):
            cell = ws.cell(row=ri, column=ci)
            cell.alignment = Alignment(horizontal="center" if ci in center else "left", vertical="top", wrap_text=True)
            cell.border = border
            if ci not in center:
                cell.font = Font(size=12)


def category(name, rows, fill):
    ws = wb.create_sheet(title=name[:31])
    ws.sheet_properties.tabColor = fill
    header(ws, COLS, WIDTHS, fill)
    body(ws, rows, len(COLS), CENTER)
    dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True)
    dv.add("E2:E200")
    ws.add_data_validation(dv)


for name, rows in ROUND1.items():
    category(name, rows, "0B6E3B")

fj = wb.create_sheet(title="Final Jeopardy")
fj.sheet_properties.tabColor = "C1121F"
header(fj, ["Category", "Question", "Answer"], [22, 40, 28], "C1121F")
body(fj, [FINAL], 3, set())

wb.save(OUT)
print("wrote", os.path.normpath(OUT), "tabs:", wb.sheetnames)

# Also write the same game as plain text for the website's question library.
lines = ["# Sample game", "", "== Jeopardy =="]
def dump(groups):
    for name, rows in groups.items():
        lines.append("## " + (name[3:] if name.startswith("DJ ") else name))
        for p, q, a, wrong, dd in rows:
            parts = [str(p), q, a]
            if wrong or dd: parts.append(wrong)
            if dd: parts.append("DD")
            lines.append(" | ".join(parts))
        lines.append("")
dump(ROUND1)
lines += ["== Final Jeopardy ==", "## " + FINAL[0], FINAL[1] + " | " + FINAL[2], ""]
os.makedirs(os.path.join(HERE, "..", "sets"), exist_ok=True)
with open(os.path.join(HERE, "..", "sets", "sample-game.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("wrote sets/sample-game.txt")

# The second sample set: the categories that used to be Double Jeopardy, at $100-$500.
lines = ["# Sample game 2", "", "== Jeopardy =="]
dump({name[3:] if name.startswith("DJ ") else name: [[p // 2, q, a, w, dd] for p, q, a, w, dd in rows] for name, rows in ROUND2.items()})
with open(os.path.join(HERE, "..", "sets", "sample-game-2.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("wrote sets/sample-game-2.txt")
