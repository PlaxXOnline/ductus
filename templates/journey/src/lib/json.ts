/**
 * JSON sicher in eine <script type="application/json">-Insel einbetten.
 *
 * Sicherheit: `set:html` escaped nichts und JSON.stringify lässt "</script>"
 * wörtlich stehen — eine solche Sequenz in Titeln/Labels (LLM- bzw.
 * Quellcode-abgeleitete Strings, angreifergesteuert) würde die Insel vorzeitig
 * schließen und injizierte Tags ausführen (stored XSS). Deshalb werden < > &
 * sowie die JS-Zeilenumbrüche U+2028/U+2029 als \uXXXX-Escapes kodiert — das
 * bleibt gültiges JSON, JSON.parse liefert exakt den ursprünglichen Wert.
 */

export function toJsonIsland(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
