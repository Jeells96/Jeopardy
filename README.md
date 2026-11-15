# 🎄 Christmas Jeopardy 🎅

A show-style, real-time game night for a Christmas party — **Husbands vs Wives** by
default. Play **mini games** for team points, then **Jeopardy**: everyone buzzes in from
their own phone, with a projector board, a host console, and a private **host remote** for
your phone with the answer key and every control.

**Live site:** https://Jeells96.github.io/Jeopardy/

---

## ⚡ Host quick start (game night)

1. **Projector:** open the site, tap **Host login**, enter **2325** → *Jaren's View*.
   Mirror this screen (it never shows answers or wagers). Or open **📺 Board** on the
   projector computer instead.
2. **Sound:** tap **🔊** on whichever screen is connected to speakers.
3. **Your phone:** open **📱 Remote** (same code). It shows the answer to every clue,
   who's buzzed, wagers, and all the buttons — host from anywhere in the room.
4. **Players** scan the QR code on the lobby screen, type their name, pick **Husbands** or
   **Wives** and tap **Enable microphone**. (A team can rename itself from a phone.)
5. **Follow the gold button.** It always shows the next step (keyboard: **Space**):
   mini games first if you've set any up, then Jeopardy.

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
- **Mid-game bonus round:** Settings → Jump to → **Mini games** pauses Jeopardy; the gold
  button brings you back to the same board.

### Team names
Teams start as **Husbands** and **Wives**. Until Jeopardy starts, anyone on a team can tap
**✏️ Rename our team** on their phone. You can always rename teams in Settings → Game, and
switch off phone renaming there too.

---

## 🎮 Everything that's in the game

**The board**
- Jeopardy round + optional **Double Jeopardy** round (doubled values) + **Final Jeopardy**.
- **Board control:** the team that answered correctly picks next (shown on the board and
  phones). In Double Jeopardy the trailing team picks first, like the show.
- Clues zoom in full-screen; categories, values and podium scores styled like the show.

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
- **Spoken clues:** the buzzed-in player's mic transcribes their answer live onto the
  board; your remote says whether it "sounds right". You tap Correct / Wrong / Skip.
- **Multiple choice:** the player taps an option and it's scored automatically. A wrong
  option is crossed off for the rebound team.
- **Answer timer** with show-style countdown lights. Spoken: time's up → your call.
  Multiple choice: time's up counts as wrong.

**Daily Doubles**
- Splash screen and sound, no buzzing — the team that found it plays.
- Wager rules from the show: **$5 up to their score, or the round's top value if that's
  higher**, with quick buttons for min / half / max / **"All in!" (True Daily Double)**.

**Final Jeopardy**
- Only teams above $0 play (official rule — you can override per team).
- Teams **lock their wager secretly on their phones** (teammates see it, the other team
  and the projector don't). You can also enter wagers by hand.
- Think music + timer; teams type their answer on their phones (auto-saves).
- Dramatic reveal, lowest score first: answer → you judge → wager → new score. Winner
  screen with confetti.

**Host tools**
- **Undo** the last score change (U), adjust any score from its podium, "put a clue back"
  if you misclick, switch who picks, jump to Double/Final, new game.
- Rename or move players between teams (their phone updates instantly) or remove them.
- Keyboard: Space next step · C correct · W wrong · S skip · N nobody · P pause buzzers ·
  R show answer · U undo · M sound · F fullscreen · Esc close.

---

## 📝 Writing your questions

In Jaren's View → **⚙ Settings → Questions → ⬇ Download the template** (or grab
[`christmas-jeopardy-template.xlsx`](./christmas-jeopardy-template.xlsx)). It comes with a
full sample game (60 clues + Final) you can play as-is or edit. Built for the Excel /
Google Sheets phone apps:

- **Each category is its own tab** — the tab name is the category on the board.
  Add a tab = new category, delete = remove, rename = rename.
- Start a tab name with **`DJ `** (e.g. `DJ Sweet Treats`) to put it in **Double
  Jeopardy**. No DJ tabs → the game goes straight from round one to Final.
- Columns: `Points · Question · Answer · Other choices · Daily Double`
  - Most clues only need **Question + Answer**.
  - **Points** blank → auto ($100–$500, or $200–$1,000 in Double Jeopardy).
  - **Other choices**: the *wrong* options separated by `;` makes it multiple choice
    (e.g. `Elf; The Grinch; Klaus`). The game shuffles in your Answer.
  - **Daily Double**: pick **Yes** (the show has 1 in round one, 2 in Double Jeopardy).
- **Final Jeopardy tab:** `Category · Question · Answer` in the first row.

Then **⬆ Import your spreadsheet**. The board updates for everyone instantly.

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
| `js/app.js` | Routing, live subscriptions, rendering, actions, automations, sounds, mic |
| `js/ui/*.js` | Screens: `stage` (show display), `host`, `dock` (next-step logic), `remote`, `player`, `join`, `minis` (all mini-game screens), `team` (phone renaming) |
| `js/xlsx.js` | Template download + spreadsheet import |
| `tools/make_template.py` | Regenerates the sample template (`python3 tools/make_template.py`) |

**Tests**
```
node tests/engine.test.mjs        # Jeopardy rules
node tests/minis.test.mjs         # mini games, rotation fairness, team names, upgrades
node tests/server.js &            # local site + in-memory Firestore stand-in (port 8123)
node tests/e2e.js [shotsDir]      # full Jeopardy game: host, board, remote and 4 phones
node tests/e2e-minis.js [shots]   # Husbands vs Wives night: mini games → Jeopardy,
                                  # a phone-free night, and upgrading an older saved game
```

Firestore layout: `state/game` (the whole game), `state/spoken` (live transcript),
`state/clock-*` (clock sync), `questions/*`, `players/*`, `buzzes/*`.
