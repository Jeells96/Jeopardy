# 🎄 Christmas Jeopardy 🎅

A show-style, real-time game night for a Christmas party — **Husbands vs Wives** by
default. Play **mini games** for team points, then **Jeopardy**: everyone buzzes in from
their own phone, with a projector board and a private **host screen** (on your phone or
laptop) with the answer key and every control. Finish with an **ugly sweater vote**.

**Live site:** https://Jeells96.github.io/Jeopardy/

---

## ⚡ Host quick start (game night)

1. **Projector:** open **📺 Board** on the projector computer. It only ever shows what
   you've started — the lobby, the mini games or the Jeopardy board — never answers.
2. **You:** open the site, tap **Host login**, enter **2325**. Host and Remote are the same
   private screen: the answer to every question, who's buzzed, wagers, and all the
   buttons. Keep it to yourself and host from anywhere in the room.
3. **Sound:** every screen plays every sound — the board, your host screen and all the
   players' phones. Sound is on by default; 🔊/🔇 turns it off on one screen, and a refresh
   turns it back on. Browsers need one tap on a page before it can make sound, so tap the
   board once (it shows **👆 Tap to start sound** until you do).
4. **Players** scan the QR code on the lobby screen, type their name, pick **Husbands**
   or **Wives** and tap **Join & turn on sound** (one tap joins and starts their phone's sound). (A team can rename itself from a phone.)
5. **Follow the gold button.** It always shows the next step (keyboard: **Space**):
   mini games first if you've set any up, then Jeopardy.

**Practice first:** ⚙ Settings → Questions → **🧪 Put the test game on the board** loads a
one-category, non-Christmas game (plus a multiple-choice Final) so you can try every
feature without seeing the real questions. When you're done, open the question library and
tap **▶ Use in the game** on your real set.

---

## 🎯 Mini games (before Jeopardy)

Set them up in **⚙ Settings → Mini games**: type a name and tap **+ Head-to-head** or
**+ Best overall** (or tap one of the ready-made ideas). Each game has its own point value,
and the points go straight onto the team's score and carry into Jeopardy.

| Type | How it plays | What you do |
|---|---|---|
| ⚔️ **Head-to-head** | One husband faces one wife each round | Tap who won (keys **1** / **2**, **T** for a tie) |
| 🏅 **Best overall** | Everyone takes a turn; best single score wins it for their team | Type each score and press Enter |

- **Who's up next?** Press the gold button and the big screen shuffles through the names,
  lands on the pick with a drum-roll, and **says it out loud** ("Up next: Jake versus
  Sarah!"). The picked players' phones buzz with **You're up!**
- **Fair rotation:** nobody is drawn twice until everyone on their team has had a go, and
  nobody plays twice in a row. Uneven teams are fine.
- **Don't like the draw?** Tap 🎲 to re-draw one side, or choose a person from the list.
- **Points:** head-to-head games can give the points to the team that wins the game, or
  *for every matchup win*. Best-overall games can be highest-wins or lowest-wins (fastest
  time), with a unit like "seconds".
- **Finishing:** the game suggests the winner from what you tracked; you can overrule it,
  call a **tie** (points split) or give no points. You can also skip the tracking entirely
  and just declare who won.
- **Fixing mistakes:** remove a wrong result with ✕, **Undo** the last points, or **↺ Reset**
  a game to hand its points back.
- **No phone?** Add people by hand in **Settings → Players** — they're drawn like anyone else.
- **Several tables at once (to get through the games faster):** in **Settings → Mini
  games → Tables**, name your tables (e.g. "Kitchen, Living room, Garage"). Every mini game
  is then played at **all of them at the same time**: one draw puts a different matchup (or
  player) at every table — nobody is drawn for two tables — and the board, the phones and
  the announcer tell everyone which table they're summoned to, with a different Christmas
  summons every time. Your controls show a row per table: tap who won (or type the score)
  for each table as it finishes, then **🎲 Draw for [table]** refills just that table.
  🎲 re-draws a table; ✏️ lets you swap a player or move a matchup to another table. A game
  with only one station can be set to a single table.
- **Mid-game bonus round:** Settings → Jump to → **Mini games** pauses Jeopardy; the gold
  button brings you back to the same board.

### ✏️ Blind Drawing
Add it from **Settings → Mini games → ideas** (or pick "✏️ Blind drawing" as a game's type).
1. **Draw the pictures:** under the game, tap **+ Draw a picture**, draw it with your finger
   and **Save picture**. Players never see these. Add a few — each round uses the next one.
2. **Play:** the drawers' phones turn into a full-screen drawing pad. They put the phone on
   their head and draw while you describe the picture (it's shown privately on your screen).
   Nothing is sent while they draw, so nothing lags; when they're done they **hold Send**
   (a quick tap won't send it by accident).
3. **The website judges:** as soon as both drawings are in, it compares the **shapes** —
   position, size, rotation and mirror image don't matter, so a good drawing that's off to
   one side, tiny or upside down still wins, and a few stray lines are forgiven. The big
   screen shows **the picture, the winner and the loser** side by side with a % match.
   **⏭ Judge now** judges straight away if someone never sends (a missing drawing loses).
- Only players with a phone are picked to draw. With tables set up, every table draws at
  once (the same picture, so you only describe it once).

### Team names
Teams start as **Husbands** and **Wives**. Until Jeopardy starts, anyone on a team can tap
**✏️ Rename our team** on their phone. You can always rename teams in Settings → Game, and
switch off phone renaming there too.

---

## 🎮 Everything that's in the game

**The board**
- One Jeopardy round ($100–$500) + **Final Jeopardy**. (There's no Double Jeopardy round —
  older sets that had one keep those questions in a separate "– extra categories" set.)
- **Board control:** the team that answered correctly picks next (shown on the board and
  phones).
- Questions zoom in full-screen; categories, values and podium scores styled like the show.

**Buzzing**
- The **first buzz wins**, decided by a database transaction, so it's exact even with 50
  phones at once. The board lists the buzz order with time gaps (+0.02s…).
- The buzzer locks for everyone the moment someone buzzes. Each team's phones show a
  Christmas pun — "we're counting on you" for the buzzer's team, a playful roast for the
  other team — and every member of a team sees the same one.
- **Rebound:** after a miss the other team can buzz in right away (can be turned off).
- Optional **buzz-in window** (nobody buzzes in time → answer revealed) and optional
  **auto-open** of buzzers after a reading delay.
- Phones buzz on touch-down for speed, vibrate when buzzers open / when you're up, and
  stay awake during the game.

**Answering**
- **Typed answers:** whoever wins the buzz gets a text box, already open and ready to
  type. Their answer appears on the board and your screen says whether it matches. You tap
  Correct / Wrong / Skip.
- **Multiple choice:** the player taps an option and it's scored automatically. A wrong
  option is crossed off for the rebound team.
- **Answer timer** with show-style countdown lights. Out of time counts as wrong: the
  points come off automatically (just the time's-up sound), and the other team gets
  **30 seconds to steal** (Settings → Game → Steal time). If nobody buzzes in, the answer
  is shown and nobody loses points.

**Daily Doubles**
- Splash screen and sound, no buzzing — the team that found it plays.
- Wager **$5 up to everything the team has**. At $0 or below, they can wager up to the
  board's top value ($500), like the show. Quick buttons for min / half / **"All in!"**.

**Final Jeopardy**
- Only teams above $0 play (official rule — you can override per team).
- Teams **lock their wager secretly on their phones** (teammates see it, the other team
  and the projector don't). You can also enter wagers by hand.
- Think music + timer (31 s by default — the length of the music, and it always plays to
  the end). One answer per team: whoever submits first submits it for everyone, and any
  teammate can **Undo & change it** until time's up. If the Final has wrong options it's
  **multiple choice** and they tap one.
- Dramatic reveal, lowest score first: answer → you judge → wager → new score. Winner
  screen with confetti.

**Host tools**
- **Undo** the last score change (U), adjust any score from its podium, "put a question back"
  if you misclick, switch who picks, jump to Final, new game.
- Rename or move players between teams (their phone updates instantly) or remove them —
  a removed player's phone is released and has to enter a name again to rejoin.
- Keyboard: Space next step · C correct · W wrong · S skip · N nobody · P pause buzzers ·
  R show answer · U undo · M sound · F fullscreen · Esc close.

**🧶 Ugly sweater vote (after Jeopardy)**
- On the final-scores screen tap **🧶 Ugly sweater vote**. You get the list of everyone —
  untick anyone who isn't in the running, then **Start voting**.
- Everyone votes on their phone (not for themselves) and can change their vote until the
  last one is in. The board shows only how many votes are in — nothing is revealed until
  every phone has voted (or you tap **Reveal now**). Then the winner gets the crown.

---

## 📝 Writing your questions — the Question library

Open **⚙ Settings → Questions → 📚 Open the question library** (or go to `#/questions`, host
code 2325). Every set of questions is kept there — one per year — so you can look back at
past years, search them, and reuse a good question.

- **+ New question set** — start empty, from what's in the game now, from the sample game,
  or from the **quick test game**: one non-Christmas category plus a multiple-choice
  Final, for trying out every feature without seeing the real questions.
- **📋 Paste questions** — mass input. Paste a whole batch and you see a live preview of
  what was understood before anything is saved. The tidiest format:

  ```
  == Jeopardy ==
  ## Christmas Movies
  100 | Who lives on Mount Crumpit? | The Grinch
  300 | Which store introduced Rudolph in 1939? | Montgomery Ward | Macy's; Sears; Woolworth's | DD
  ## History
  200 | Which president made Christmas a federal holiday? | Ulysses S. Grant
  == Final Jeopardy ==
  ## Famous Poems
  This 1823 poem begins 'Twas the night before Christmas | A Visit from St. Nicholas
  ```

  Each line is `points | question | answer`. A 4th part with wrong options (separated by
  `;`) makes it **multiple choice** (Final Jeopardy too: `question | answer | wrong; wrong`);
  `DD` marks a Daily Double; a 6th part is a host note.
  Leave points blank to fill them in automatically. It also understands
  `Question? Answer: X`, numbered lists with A) B) C) D) options, tables, rows copied
  from a spreadsheet, and JSON.
- **🤖 Ask AI for questions** — builds a request to paste into ChatGPT or Claude (number of
  categories, round, topics) that comes back in exactly the paste format, and tells it not
  to reuse answers from your past years.
- **Edit in place** — every question, answer, value and category is editable right on the
  page, and the boxes grow so you can read everything at once. **⋯** opens wrong options
  (multiple choice — with a switch to turn it off without deleting the options), Daily
  Double, round, a **host note**
  (shown only on your phone remote — e.g. "also accept St. Nick"), move, copy to another
  set, and delete (with Undo).
- **✂ Copy / move questions** — tap ✂ on any question (or **✂ All** on a category) to pick
  it, choose **Move** or **Copy** in the bar that appears, then tap **📥 Paste here** in any
  category, Final or Unsorted — or type a name and **Paste into a new category**. Works
  between sets too (e.g. copy last year's favourites into this year).
- **🗑 Delete a whole category** from its header (with Undo).
- **♻ Also asked in Christmas 2025** — repeats from past years are flagged automatically.
- **🔎 Search every year** — questions, answers, categories and notes across all sets;
  copy any result into this year's set.
- **Readiness check** — what's still missing (unfinished questions, short categories, no
  Final Jeopardy, Daily Double count). The **Unfinished** filter shows only what needs work;
  half-written ideas are kept but never put on the board.
- **▶ Use in the game** — puts the set's finished questions on the board.
- **⋯ More** — download as a spreadsheet or text file, add questions from a spreadsheet,
  duplicate, **lock** a past year so it can't be changed by accident, delete.

The spreadsheet template still works (Settings → Questions → Spreadsheet) if you prefer it.
Questions live in Firestore under `state/set-*`, which the existing rules already allow.

---

## 🔊 Sound effects

Built-in, original placeholder sounds play out of the box. To use your own audio, add MP3s
to the [`sounds/`](./sounds) folder with these exact names (any you skip keep the built-in
sound):

| Event | File |
|---|---|
| Correct answer | `correct.mp3` |
| Wrong answer | `wrong.mp3` |
| Time's up | `times-up.mp3` |
| Final Jeopardy think music (loops) | `final-jeopardy.mp3` |
| Daily Double revealed | `daily-double.mp3` |
| Someone buzzed in | `buzz-in.mp3` |
| Board appears / new round | `board-fill.mp3` |
| Winner announced | `winner.mp3` |
| Mini games: drawing who's up next (~2 s) | `up-next.mp3` |
| Mini games: a team wins a mini game | `mini-game-win.mp3` |

> The official *Jeopardy!* sounds and music are copyrighted and aren't included. Use audio
> you have the rights to use.

---

## 🔥 Firebase setup (one time)

Firestore → **Rules**. This project shares Firestore with another app, so the rules are
combined — the Jeopardy part is the four `match` lines at the bottom:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function contestLocked(contestId) {
      let contest = get(/databases/$(database)/documents/contests/$(contestId)).data;
      return contest.keys().hasAny(['lockAt']) && request.time >= contest.lockAt;
    }

    match /contests/{contestId} {
      allow read, write: if true;
      match /pool/{chunkId} { allow read, write: if true; }
      match /standings/{entryId} { allow read, write: if true; }
      match /entries/{entryId} {
        allow get: if true;
        allow list: if contestLocked(contestId);
        allow create, update: if !contestLocked(contestId);
        allow delete: if true;
      }
    }

    match /config/{document} { allow read, write: if true; }

    // ===== Christmas Jeopardy =====
    match /state/{doc}      { allow read, write: if true; }
    match /questions/{doc}  { allow read, write: if true; }
    match /players/{doc}    { allow read, write: if true; }
    match /buzzes/{doc}     { allow read, write: if true; }
  }
}
```

## 🚀 Auto-deploy

Every push to `main` publishes to GitHub Pages (Settings → Pages → Source: **GitHub
Actions**). Hard-refresh after a deploy to get the newest version.

---

## 🛠 For developers

Static site, no build step. Firebase and SheetJS load from CDNs.

| File | What it does |
|---|---|
| `js/engine.js` | Pure game rules — every action is `(state, params) → changes` |
| `js/data.js` | Firestore I/O; runs engine actions inside transactions; server-clock sync |
| `js/app.js` | Routing, live subscriptions, rendering, actions, automations, sounds, typed answers |
| `js/summons.js` | Christmas summon lines for mini games played at several tables |
| `js/draw.js` | Blind Drawing: drawing pad, storage format and the shape judge |
| `js/ui/*.js` | Screens: `stage` (show display), `host`, `dock` (next-step logic), `remote`, `player`, `join`, `minis` (all mini-game screens), `team` (phone renaming) |
| `js/bank.js` | Question library logic: paste parser, checks, search, repeats, export |
| `js/libctl.js` + `js/ui/library.js` | Question library screen |
| `js/xlsx.js` | Spreadsheet template, import and export |
| `tools/make_template.py` | Regenerates the sample template (`python3 tools/make_template.py`) |

**Tests**
```
node tests/engine.test.mjs        # Jeopardy rules
node tests/minis.test.mjs         # mini games, rotation fairness, team names, upgrades
node tests/bank.test.mjs          # question library: paste formats, checks, export, search
node tests/server.js &            # local site + in-memory Firestore stand-in (port 8123)
node tests/e2e.js [shotsDir]      # full Jeopardy game: host, board, remote and 4 phones
node tests/e2e-minis.js [shots]   # Husbands vs Wives night: mini games → Jeopardy,
                                  # a phone-free night, and upgrading an older saved game
node tests/e2e-library.js [shots] # question library: paste, edit, search, lock, load into the game
node tests/e2e-extras.js [shots]  # test game, mini-game tables, multiple-choice Final
node tests/draw.test.mjs          # Blind Drawing: the shape judge and its rules
node tests/e2e-draw.js [shots]    # Blind Drawing: host draws, two phones draw blind, verdict
```

Firestore layout: `state/game` (the whole game, incl. the sweater vote), `state/spoken` (typed answer),
`state/clock-*` (clock sync), `questions/*`, `players/*`, `buzzes/*`.
