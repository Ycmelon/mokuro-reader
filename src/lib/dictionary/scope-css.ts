/**
 * Scopes a dictionary's bundled styles.css so its rules only apply inside the
 * popup. Each top-level selector is prefixed with `scope`; rule bodies (which
 * may use native CSS nesting with `&`) are copied verbatim.
 *
 * The bundled CSS (e.g. Jitendex) contains no at-rules — only attribute
 * selectors, combinators, and native nesting — so a simple brace-depth walk
 * is sufficient.
 */
export function scopeCss(css: string, scope: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let prelude = '';
  let depth = 0;

  for (const ch of stripped) {
    if (depth === 0) {
      if (ch === '{') {
        out += prefixSelectors(prelude.trim(), scope) + ' {';
        prelude = '';
        depth = 1;
      } else {
        prelude += ch;
      }
    } else {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      out += ch;
    }
  }

  return out;
}

function prefixSelectors(selectorList: string, scope: string): string {
  if (!selectorList) return '';
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${scope} ${s}`)
    .join(', ');
}
