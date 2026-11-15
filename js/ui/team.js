// Team name helpers for players' phones.
import { esc } from "./util.js";
import * as E from "../engine.js";

// Players may rename their own team until Jeopardy starts (the host can lock this).
export function canRename(S) {
  return !!S && (S.settings || {}).playersRename !== false && ["lobby", "minis"].includes(S.phase);
}
export function renameBlock(G) {
  if (!G.me || !canRename(G.S)) return "";
  const name = E.teamName(G.S, G.me.team);
  if (G.ui.renaming) {
    return `<div class="rename">
      <label class="lbl" for="team-name-input">Your team's name</label>
      <input id="team-name-input" class="join-input" maxlength="24" value="${esc(name)}" autocomplete="off" data-sticky>
      <div class="btnrow"><button class="btn primary" data-action="team-rename-save">Save name</button><button class="btn ghost" data-action="team-rename-cancel">Cancel</button></div>
    </div>`;
  }
  return `<button class="btn ghost sm rename-btn" data-action="team-rename">✏️ Rename our team</button>`;
}
