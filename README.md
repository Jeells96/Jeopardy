# 🎄 Christmas Jeopardy 🎅

A heavily Christmas-themed, real-time Jeopardy game built for a party with two teams,
up to ~50 players buzzing in on their own phones, a host ("Jaren's View"), a projector
board, and a private cheat sheet. Runs as a static site on GitHub Pages, with Firebase
(Cloud Firestore) handling the live sync and the buzzer race.

**Live site:** https://Jeells96.github.io/Jeopardy/

---

## 🔥 1. Firebase setup (do this once)

### a) Turn on Cloud Firestore
1. Go to the [Firebase console](https://console.firebase.google.com/) → project **stocks-b13c5**.
2. **Build → Firestore Database → Create database.**
3. Pick a location, choose **Start in production mode** (we'll paste rules next), and finish.

### b) Paste these security rules
In the console: **Firestore Database → Rules** tab, replace everything with the block
below, then click **Publish**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Christmas Jeopardy — open read/write for the party collections only.
    // There's no login (it's a party game), so this lets any player's phone
    // read the board and write their buzz. It does NOT expire.
    match /state/{doc}      { allow read, write: if true; }
    match /questions/{doc}  { allow read, write: if true; }
    match /players/{doc}    { allow read, write: if true; }
    match /buzzes/{doc}     { allow read, write: if true; }

    // Everything else stays locked.
    match /{document=**}    { allow read, write: if false; }
  }
}
```

> **Why open?** The game has no user accounts, so each phone needs to read the board and
> write its buzz directly. These rules only unlock the four game collections and never
> expire (unlike the default 30-day "test mode"). Don't store anything sensitive in this
> project. When the party's over you can set the four rules back to `if false;` to freeze it.

That's the only thing you paste. The Firebase keys are already wired into the site.

---

## 🚀 2. Turn on auto-deploy (one setting, once)

Every change pushed to `main` rebuilds the live site automatically via GitHub Actions.
To enable it:

1. On GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

Done. Within ~1 minute of any push, https://Jeells96.github.io/Jeopardy/ updates. You can
watch each deploy under the repo's **Actions** tab.

---

## 🎮 3. How to run a game

### Views
- **Players:** everyone opens the site, enters a **name**, picks a **team**, taps **Join**.
  This saves on their device and can't be changed by them (⚠️ they're warned). You can fix
  names/teams silently in Jaren's View.
- **Jaren's View (host):** on the site, tap **🔒 Jaren's View** and enter code **2325**.
  This is the control panel — mirror it on the projector.
- **📺 Projector Board:** a clean, answer-free big-screen board (linked from Jaren's View).
  Use this *or* mirror Jaren's View — both are safe to show; neither reveals answers.
- **🤫 Cheat Sheet:** also behind code **2325** (linked from Jaren's View). Open this on a
  **separate phone that is NOT mirrored** — it shows the current clue's answer only.

### Load your questions
1. In Jaren's View → **🛠 Questions & Players → ⬇ Download XLSX template**
   (or grab [`christmas-jeopardy-template.xlsx`](./christmas-jeopardy-template.xlsx) from this repo).
2. **Each category is its own tab** (phone-friendly — only 5 columns, and most clues need
   just 2). The tab's name is the category shown on the board.
   - **Add a tab** → new category. **Delete a tab** → removes it. **Rename a tab** → renames the category. Board columns follow tab order.
   - Columns: `Points · Question · Answer · Other choices · Daily Double`.
     - **Spoken clue:** just fill **Question** + **Answer**.
     - **Points:** leave blank to auto-number 100/200/300…, or type your own.
     - **Multiple choice:** also put the *wrong* options in **Other choices**, separated by
       `;` (e.g. `Elf; The Grinch; Klaus`). The app adds your Answer as the correct option
       and shuffles them. Blank = spoken.
     - **Daily Double:** pick **Yes** (there's a dropdown).
   - The tab named **Final Jeopardy** is the Final round (keep the word "Final"; first row is used).
   - The **① Read me first** tab is instructions and is ignored on import.
   - *(Older templates with the long `Type / Choice A–D / Correct` layout still import fine.)*
3. Back in Jaren's View → **⬆ Import questions**. The board loads for everyone instantly.

### Playing a clue
1. Tap a clue on the board → it shows on all screens.
2. Tap **🔔 Open Buzzers**. Every player gets a giant **BUZZ!** button.
3. The **first buzz wins** — decided on Firebase's server (a transaction), so it's accurate
   even with 50 phones hammering it at once. The buzz order is listed on the board.
4. The buzzed-in player gets a **countdown** (length set in the Answer-timer box):
   - **Spoken:** their phone's **microphone listens automatically** and shows the host the
     live transcript of what they said (and whether they answered in time). You still tap
     ✅ Correct / ❌ Wrong / 😐 No penalty — the **Cheat Sheet** shows a "sounds right / no
     match" hint to help you decide. If the timer runs out you decide whether to dock points.
   - **Multiple choice:** the player taps a choice and it's **scored automatically**
     (right = +value, wrong = −value); a timeout auto-scores as wrong.

### 🎙️ Microphone / spoken answers
- On the player screen there's an **Enable microphone** button — have everyone tap it
  **before the game starts** so answers are captured instantly with no mid-game prompt.
- When a player is the one answering a *spoken* clue, their mic starts listening on its own
  and streams a transcript to your control panel, the projector, and the Cheat Sheet.
- **Browser support:** speech-to-text works on **Chrome, Edge, and Android Chrome**. On
  iPhones/Safari and Firefox it may not transcribe — those players simply answer out loud
  and you judge as normal (the game never blocks on the mic). It needs the HTTPS site
  (GitHub Pages is fine) and an internet connection.
- The host always makes the final call — speech recognition is a helper, not the judge.
5. If the first team misses a spoken clue, tap **↪ Open to [other team]** to pass it.
6. **Reveal answer** on the board if you like, then **✓ Done** to close the clue.

### Daily Double & Final Jeopardy
- **Daily Double:** when you open a flagged clue, assign the controlling team and a wager
  before they answer — no buzzing, correct/wrong adjusts by the wager.
- **Final Jeopardy:** from the board tap **🎯 Start Final Jeopardy**, enter each team's
  wager, reveal the clue with a **Final timer** (set in admin), then mark each team
  correct/wrong — wagers are applied automatically.

### Timers
Set the **Answer timer** and **Final timer** (seconds) in the top bar of Jaren's View at
any time. The countdown shows large on the projector board and in Jaren's View.

---

## 🛠 Tech notes
- Pure static site — no build step. Firebase + SheetJS load from CDNs.
- `index.html` → `js/firebase.js` (config) → `js/data.js` (Firestore + buzzer race) →
  `js/app.js` (all views) → `js/xlsx.js` (template/import). Theme in `css/styles.css`.
- Game state lives in Firestore: `state/game`, `questions/*`, `players/*`, `buzzes/*`.
- Host code is `2325` (in `js/app.js`).

Happy holidays! 🎁
