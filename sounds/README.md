# 🔊 Sound effects — drop your MP3s here

The game plays these on the **host console**, **projector board** and **host remote**
(whichever has 🔊 turned on) — never on players' phones. Add MP3s to **this folder** with
these **exact** names:

| Event | File name |
|---|---|
| ✅ Correct answer | `correct.mp3` |
| ❌ Wrong answer | `wrong.mp3` |
| ⏰ Time's up | `times-up.mp3` |
| 🎵 Final Jeopardy think music (plays once — the Final timer defaults to its length, 31 s) | `final-jeopardy.mp3` |
| 🎬 Jeopardy starts (theme) | `this-is-jeopardy.mp3` |
| ⭐ Daily Double revealed | `daily-double.mp3` |
| 🔔 Someone buzzed in | `buzz-in.mp3` |
| 🎄 Board appears (used if a theme above is missing) | `board-fill.mp3` |
| 🏆 Winner announced | `winner.mp3` |
| 🎲 Mini games: drawing who's up next (about 2 seconds) | `up-next.mp3` |
| 🎯 Mini games: a team wins a mini game | `mini-game-win.mp3` |

## How to add them
1. On GitHub, open this `sounds/` folder → **Add file → Upload files**.
2. Drag in your MP3s (named exactly as above) and commit.
3. Wait ~1 minute for the site to redeploy, then hard-refresh. No code changes needed.

Any file you don't add keeps its built-in sound. Keep files small (a few MB) so they load
quickly; the theme songs stop as soon as a question is picked.

> ⚠️ The official *Jeopardy!* cues and music are copyrighted and can't be bundled with this
> project. Use audio you have the rights to use. The built-in placeholder sounds are
> original.
