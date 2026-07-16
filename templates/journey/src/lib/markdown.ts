/**
 * Build-time rendering of the LLM markdown (journey.markdown) for the
 * “Detailed guide” section.
 *
 * Security: the markdown comes from an LLM response (untrusted,
 * prompt-injectable via source-code comments). Before parsing, & < > are
 * escaped — embedded raw HTML (including <script>) is thus rendered as visible
 * text instead of executed; the markdown syntax itself remains untouched.
 * Additionally, link/image targets are checked against allowed URL schemes
 * (marked does not sanitize URLs — "[x](javascript:…)" would otherwise become
 * a clickable XSS link): unsafe targets lose the <a>/<img>, only the text
 * remains. Deterministic (NFR2): marked works without randomness/time.
 */

import { Marked } from 'marked';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Only http/https/mailto and scheme-less (relative) targets are allowed.
 * Control/whitespace characters are stripped before the check — "java\tscript:"
 * would otherwise be a bypass (browsers ignore them when resolving the scheme).
 */
function isSafeUrl(href: string): boolean {
  const scheme = href
    .replace(/[\u0000-\u0020]/g, '')
    .toLowerCase()
    .match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme === null) return true; // relative or anchor — no scheme
  return scheme[1] === 'http' || scheme[1] === 'https' || scheme[1] === 'mailto';
}

// Own instance instead of the global marked singleton — the renderer overrides
// must not leak into other users of the module.
const parser = new Marked({
  renderer: {
    link(token) {
      if (isSafeUrl(token.href)) return false; // default rendering
      return this.parser.parseInline(token.tokens); // only the link text, no <a>
    },
    image(token) {
      if (isSafeUrl(token.href)) return false;
      return escapeHtml(token.text); // only the alt text, no <img>
    },
  },
});

export function renderMarkdown(markdown: string): string {
  if (markdown.trim() === '') return '';
  return parser.parse(escapeHtml(markdown), { async: false, gfm: true });
}
