/**
 * Scope Parchment CSS under a root selector.
 *
 * Parchment ships with its own stylesheet which is designed for a full-page
 * interpreter. RomM embeds it inside `#parchment-root`, so every selector is
 * prefixed to avoid leaking styles onto the rest of the app.
 *
 * The stylesheet contains selectors for the game window (kept inside the root
 * element) and for the file dialog. The dialog is a Svelte component that is
 * mounted on `document.body` before the player moves it back into the root
 * element (so it stays visible in fullscreen). Rules referencing the dialog or
 * any `svelte-*` scoped class are therefore emitted twice: once scoped under
 * the root selector and once under `body`.
 */

const BLOCK_AT_RULES = new Set([
  "media",
  "supports",
  "document",
  "layer",
  "container",
  "scope",
]);

/**
 * Split a selector list on top-level commas (commas inside parens or brackets
 * are part of a compound selector, e.g. `:not(a, b)`).
 */
function splitTopLevelCommas(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inStr = null;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      else if (c === "\\") i++;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

/**
 * A rule targets the file dialog when it names the dialog element itself or
 * any `svelte-*` scoped class (all dialog markup is Svelte-generated).
 */
function needsDualScope(selector) {
  return selector.includes("dialog") || selector.includes("svelte-");
}

function scopeSelector(selector, rootSelector) {
  const sel = selector.trim();
  if (!sel) return "";

  // `:root` is the page root; inside the player it is #parchment-root.
  if (sel === ":root") return rootSelector;
  if (sel.startsWith(":root")) return rootSelector + sel.slice(5);
  // A lone attribute selector is a root state, e.g. `[data-theme=dark]`.
  // It must be attached to the root (no descendant space), otherwise the
  // variables it declares never cascade onto #parchment-root itself.
  if (/^\[[^\]]+\]$/.test(sel)) return rootSelector + sel;

  let replaced = sel.replace(/\b(?:body|html)\b/g, rootSelector);
  if (replaced.includes(rootSelector)) return replaced;

  if (needsDualScope(sel)) {
    return `${rootSelector} ${sel}, body ${sel}`;
  }
  return `${rootSelector} ${sel}`;
}

function scopeRule(selectorText, block, rootSelector) {
  const clean = selectorText.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!clean) return `${selectorText}{${block}}\n`;

  const scoped = [];
  for (const part of splitTopLevelCommas(clean)) {
    const out = scopeSelector(part, rootSelector);
    if (out && !scoped.includes(out)) scoped.push(out);
  }
  if (scoped.length === 0) return `${selectorText}{${block}}\n`;

  return `${scoped.join(", ")} {${block}}\n`;
}

/** Read a `{...}` block starting at `i` (which must point at `{`). */
function readBlock(css, i) {
  let depth = 0;
  let j = i;
  let inStr = null;
  while (j < css.length) {
    const c = css[j];
    if (c === "/" && css[j + 1] === "*") {
      const close = css.indexOf("*/", j + 2);
      j = close === -1 ? css.length : close + 2;
      continue;
    }
    if (inStr) {
      if (c === inStr) inStr = null;
      else if (c === "\\") j++;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { block: css.slice(i + 1, j), end: j + 1 };
      }
    }
    j++;
  }
  throw new Error("Unbalanced braces in CSS");
}

/**
 * Scope a stylesheet so every rule only applies inside `rootSelector`.
 *
 * @param {string} css The input CSS.
 * @param {string} rootSelector The selector to scope under (e.g. `#parchment-root`).
 * @returns {string} The scoped CSS.
 */
function scopeCss(css, rootSelector) {
  let out = "";
  let i = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i];

    // Comments and strings pass through untouched.
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      if (close === -1) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, close + 2);
      i = close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (css[j] === "\\") j += 2;
        else if (css[j] === c) break;
        else j++;
      }
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // At-rules.
    if (c === "@") {
      let j = i + 1;
      while (j < n && /[a-zA-Z0-9-]/.test(css[j])) j++;
      const name = css.slice(i + 1, j);
      let k = j;
      while (k < n && css[k] !== "{" && css[k] !== ";") k++;
      const prelude = css.slice(j, k);

      if (css[k] === ";") {
        out += css.slice(i, k + 1) + "\n";
        i = k + 1;
        continue;
      }
      if (css[k] !== "{") {
        out += css.slice(i);
        break;
      }

      const { block, end } = readBlock(css, k);
      i = end;

      if (BLOCK_AT_RULES.has(name.toLowerCase())) {
        // @media / @supports contain nested rules; scope inside recursively.
        out += `@${name}${prelude}{${scopeCss(block, rootSelector)}}\n`;
      } else {
        // @font-face, @keyframes, @page, ... keep the block as-is.
        out += `@${name}${prelude}{${block}}\n`;
      }
      continue;
    }

    // Standard rule.
    let j = i;
    while (j < n && css[j] !== "{" && css[j] !== "}") j++;
    if (j >= n) {
      out += css.slice(i);
      break;
    }
    if (css[j] === "}") {
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    const { block, end } = readBlock(css, j);
    out += scopeRule(css.slice(i, j), block, rootSelector);
    i = end;
  }

  return out;
}

module.exports = { scopeCss };
