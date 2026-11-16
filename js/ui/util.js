// Small UI helpers: escaping, formatting, and an in-place DOM morph.

export const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function money(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US");
}

// "Husbands win" but "Team 1 wins": pick the verb form that fits a team name.
export const isPlural = (name) => /[^s]s$/i.test(String(name || "").trim());
export const verb = (name, singular, plural) => (isPlural(name) ? plural : singular);

export const attr = (cond, name, value = "") => (cond ? ` ${name}${value !== "" ? `="${esc(value)}"` : ""}` : "");
export const cls = (...parts) => parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------
// morph(container, html): update `container` to match `html` while keeping the
// existing elements in place. Preserves focus, caret and typed text in inputs,
// and lets CSS entrance animations play only when an element first appears.
//   data-key="..."   identifies an element across renders (re-created if it changes)
//   data-keep        this element is managed by JS — leave its attributes and children alone
//   data-sticky      never overwrite this input's value from the template
// ---------------------------------------------------------------
export function morph(container, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  syncChildren(container, tpl.content);
}

function same(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType === 1) return a.getAttribute("data-key") === b.getAttribute("data-key");
  return true;
}

function syncChildren(from, to) {
  const toKids = Array.from(to.childNodes);
  let fromKids = Array.from(from.childNodes);
  for (let i = 0; i < toKids.length; i++) {
    const t = toKids[i];
    const f = fromKids[i];
    if (!f) { from.appendChild(t.cloneNode(true)); continue; }
    if (!same(f, t)) {
      // Try to find a matching keyed sibling further along before replacing.
      const key = t.nodeType === 1 && t.getAttribute("data-key");
      const match = key ? fromKids.slice(i + 1).find((n) => n.nodeType === 1 && n.getAttribute("data-key") === key && n.nodeName === t.nodeName) : null;
      // The current node is still wanted further down: insert the new one in front of it
      // instead of replacing it (replacing would lose focus and anything half-typed).
      const fKey = f.nodeType === 1 && f.getAttribute("data-key");
      const fLater = fKey && toKids.slice(i + 1).some((n) => n.nodeType === 1 && n.getAttribute("data-key") === fKey && n.nodeName === f.nodeName);
      if (match) {
        from.insertBefore(match, f);
        fromKids = Array.from(from.childNodes);
        syncNode(match, t);
      } else if (fLater) {
        from.insertBefore(t.cloneNode(true), f);
        fromKids = Array.from(from.childNodes);
      } else {
        from.replaceChild(t.cloneNode(true), f);
      }
      continue;
    }
    syncNode(f, t);
  }
  fromKids = Array.from(from.childNodes);
  for (let j = fromKids.length - 1; j >= toKids.length; j--) from.removeChild(fromKids[j]);
}

function syncAttrs(f, t) {
  for (const a of Array.from(f.attributes)) if (!t.hasAttribute(a.name)) f.removeAttribute(a.name);
  for (const a of Array.from(t.attributes)) if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
}

function syncNode(f, t) {
  if (f.nodeType === 3 || f.nodeType === 8) {
    if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue;
    return;
  }
  if (f.nodeType !== 1) return;
  if (f.hasAttribute("data-keep")) return;
  syncAttrs(f, t);
  const tag = f.tagName;
  const focused = f === document.activeElement;
  if (tag === "INPUT") {
    if (f.type === "checkbox" || f.type === "radio") {
      if (!focused) f.checked = t.hasAttribute("checked");
    } else if (!focused && !f.hasAttribute("data-sticky")) {
      const v = t.getAttribute("value") || "";
      if (f.value !== v) f.value = v;
    }
    return;
  }
  if (tag === "TEXTAREA") {
    if (!focused && !f.hasAttribute("data-sticky") && f.value !== t.textContent) f.value = t.textContent;
    return;
  }
  syncChildren(f, t);
  if (tag === "SELECT" && !focused) {
    const sel = t.querySelector("option[selected]");
    if (sel) f.value = sel.getAttribute("value");
  }
}
