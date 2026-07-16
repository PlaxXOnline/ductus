/**
 * Safely embed JSON into a <script type="application/json"> island.
 *
 * Security: `set:html` escapes nothing and JSON.stringify leaves "</script>"
 * verbatim — such a sequence in titles/labels (LLM- or source-code-derived
 * strings, attacker-controlled) would close the island prematurely and execute
 * injected tags (stored XSS). Therefore < > & as well as the JS line breaks
 * U+2028/U+2029 are encoded as \uXXXX escapes — this remains valid JSON, and
 * JSON.parse yields exactly the original value.
 */

export function toJsonIsland(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
