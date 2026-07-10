// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

/**
 * Journey-Template des Website-Modus: pures Astro ohne Starlight.
 *
 * Von Ductus generierte Daten einlesen (ductus.data.json in der Site-Wurzel).
 * Fehlt die Datei oder ist sie kein gültiges JSON (z. B. direkt nach dem
 * Kopieren des Templates), bleibt die Site mit einem leeren Fallback lauffähig
 * — wie beim Starlight-Template. Die Daten werden per Vite-`define` als
 * Konstante __DUCTUS_DATA__ eingebettet (hier ist import.meta.url noch nicht
 * gebündelt, in src/ wäre der relative Dateizugriff zur Buildzeit unzuverlässig);
 * src/lib/data.ts normalisiert sie.
 */
function readJson(relativePath, fallback) {
  try {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  } catch {
    return fallback;
  }
}

const ductusData = readJson('./ductus.data.json', null);

export default defineConfig({
  vite: {
    define: {
      __DUCTUS_DATA__: JSON.stringify(ductusData),
    },
  },
});
