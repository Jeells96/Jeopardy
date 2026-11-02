# 🔊 Sound effects — drop your MP3s here

The game plays four sounds on the **host (Jaren's View)** and **projector (Board)** devices.
To use your own authentic audio, add MP3 files to **this `sounds/` folder** with these
**exact file names**:

| Event | File name (exact) | When it plays |
|---|---|---|
| ✅ Correct answer | `correct.mp3` | A team answers correctly (spoken or multiple choice) |
| ❌ Wrong answer | `wrong.mp3` | A team answers wrong |
| ⏰ Time's up | `times-up.mp3` | The answer timer runs out before anyone answers |
| 🎵 Final Jeopardy | `final-jeopardy.mp3` | Plays on a loop during the Final Jeopardy timer |

## How to add them
1. Put the four files in this folder, named exactly as above (all lowercase, `.mp3`).
2. Commit & push (or use GitHub's **Add file → Upload files** on this folder).
3. After the site redeploys (~1 min), hard-refresh. That's it — no code changes needed.

Notes:
- You don't need all four. Any file that's missing just uses a built-in placeholder tone.
- `final-jeopardy.mp3` loops, so a ~30–60s clip is plenty (it stops when the clue is judged).
- Keep each file reasonably small (a few MB) so it loads fast.
- Turn sound on with the **🔊 / 🔇** button in Jaren's View (and on the Board screen).

> ⚠️ The official *Jeopardy!* cues and the "Think!" music are copyrighted, so they can't be
> bundled with this project. Use audio you have the right to use. Until you add files, the
> game plays original, non-copyrighted placeholder tones so everything still works.
