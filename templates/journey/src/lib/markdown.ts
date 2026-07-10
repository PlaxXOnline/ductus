/**
 * Buildzeit-Rendering des LLM-Markdowns (journey.markdown) für den Abschnitt
 * „Ausführliche Anleitung“.
 *
 * Sicherheit: Das Markdown stammt aus einer LLM-Antwort (untrusted, über
 * Quellcode-Kommentare prompt-injizierbar). Vor dem Parsen werden & < >
 * escaped — eingebettetes rohes HTML (inkl. <script>) wird dadurch als
 * sichtbarer Text gerendert statt ausgeführt; die Markdown-Syntax selbst bleibt
 * unberührt. Zusätzlich werden Link-/Bild-Ziele auf erlaubte URL-Schemata
 * geprüft (marked sanitisiert URLs nicht — "[x](javascript:…)" würde sonst zu
 * einem klickbaren XSS-Link): unsichere Ziele verlieren das <a>/<img>, nur der
 * Text bleibt. Deterministisch (NFR2): marked arbeitet ohne Zufall/Zeit.
 */

import { Marked } from 'marked';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Erlaubt sind nur http/https/mailto sowie schemalose (relative) Ziele.
 * Steuer-/Leerzeichen werden vor der Prüfung entfernt — "java\tscript:" wäre
 * sonst ein Bypass (Browser ignorieren sie beim Auflösen des Schemas).
 */
function isSafeUrl(href: string): boolean {
  const scheme = href
    .replace(/[\u0000-\u0020]/g, '')
    .toLowerCase()
    .match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme === null) return true; // relativ bzw. Anker — kein Schema
  return scheme[1] === 'http' || scheme[1] === 'https' || scheme[1] === 'mailto';
}

// Eigene Instanz statt globalem marked-Singleton — die Renderer-Overrides
// sollen nicht auf andere Nutzer des Moduls durchschlagen.
const parser = new Marked({
  renderer: {
    link(token) {
      if (isSafeUrl(token.href)) return false; // Standard-Rendering
      return this.parser.parseInline(token.tokens); // nur der Linktext, kein <a>
    },
    image(token) {
      if (isSafeUrl(token.href)) return false;
      return escapeHtml(token.text); // nur der Alt-Text, kein <img>
    },
  },
});

export function renderMarkdown(markdown: string): string {
  if (markdown.trim() === '') return '';
  return parser.parse(escapeHtml(markdown), { async: false, gfm: true });
}
