// @ts-check
import { readFileSync } from 'node:fs';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/**
 * Von Ductus generierte Konfiguration einlesen. Fehlen die Dateien (z. B. direkt
 * nach dem Kopieren des Templates), bleibt die Site mit Fallbacks lauffähig.
 */
function readJson(relativePath, fallback) {
  try {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  } catch {
    return fallback;
  }
}

const site = readJson('./ductus.site.json', { title: 'Dokumentation' });
const sidebar = readJson('./ductus.sidebar.json', []);

/**
 * Remark-Plugin: ```mermaid-Codeblöcke (flowchart, journey, …) werden zu
 * `<pre class="mermaid">` mit dem Diagramm-Quelltext als Textinhalt; das
 * Client-Skript (siehe head-Option unten) rendert daraus SVG.
 *
 * Bewusst KEIN roher html-Node: Der MDX-Compiler verwirft rohe html-Nodes,
 * und die Ductus-Seiten sind MDX. Stattdessen werden hast-Daten
 * (hName/hProperties/hChildren) gesetzt — die greifen in Markdown UND MDX,
 * weil beide Pipelines mdast-util-to-hast verwenden. Der Textinhalt wird dabei
 * automatisch HTML-escaped.
 */
function remarkMermaid() {
  /** @param {{ children?: Array<{ type: string, lang?: string | null, value?: string, children?: unknown[] }> }} node */
  const walk = (node) => {
    if (!Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (child.type === 'code' && child.lang === 'mermaid') {
        node.children[i] = /** @type {typeof child} */ (
          /** @type {unknown} */ ({
            type: 'mermaidDiagram',
            data: {
              hName: 'pre',
              hProperties: { className: ['mermaid'] },
              hChildren: [{ type: 'text', value: child.value ?? '' }],
            },
          })
        );
      } else {
        walk(child);
      }
    }
  };
  return walk;
}

/**
 * Client-seitiges Rendering der Mermaid-Diagramme (gleiche CDN-Quelle wie
 * .ductus/graph.html). Ohne Netz schlägt der Import fehl und der Codeblock
 * bleibt als lesbarer Fallback stehen. Theme-aware: Starlight setzt
 * data-theme ('dark'/'light') auf <html>; bei Wechsel wird aus dem
 * aufbewahrten Quelltext neu gerendert.
 */
const mermaidClientScript = `
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const diagrams = Array.from(document.querySelectorAll('pre.mermaid'));

// Quelltext aufbewahren: mermaid.run() ersetzt den Inhalt durch SVG.
for (const el of diagrams) {
  el.dataset.mermaidSource = el.textContent || '';
}

const pickTheme = () =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';

async function renderAll() {
  for (const el of diagrams) {
    el.removeAttribute('data-processed');
    el.textContent = el.dataset.mermaidSource || '';
  }
  mermaid.initialize({ startOnLoad: false, theme: pickTheme() });
  // suppressErrors: ein fehlerhaftes Diagramm blockiert die übrigen nicht.
  await mermaid.run({ nodes: diagrams, suppressErrors: true });
}

if (diagrams.length > 0) {
  // Observer VOR dem ersten Rendern registrieren, damit ein Renderfehler
  // die Reaktion auf Theme-Wechsel nicht verhindert.
  new MutationObserver(() => {
    renderAll();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  await renderAll();
}
`;

export default defineConfig({
  // Astro ≥ 6.4 rendert Markdown/MDX über markdown.processor; das früher übliche
  // markdown.remarkPlugins ist deprecated. Starlight reicht den Prozessor auch
  // an MDX-Inhalte durch (extendMarkdownConfig der MDX-Integration).
  markdown: {
    processor: unified({ remarkPlugins: [remarkMermaid] }),
  },
  integrations: [
    starlight({
      title: site.title ?? 'Dokumentation',
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: mermaidClientScript,
        },
      ],
      sidebar: [
        {
          label: 'Anleitungen',
          items: sidebar,
        },
      ],
    }),
  ],
});
