/**
 * `ductus graph [--open] [--out <pfad>] [--journey]` (SPEC §10.1): Extract im Speicher,
 * Mermaid auf stdout bzw. eigenständiges HTML unter .ductus/graph.html.
 * --journey gibt statt des Flowcharts die journey-Diagramme der Flow-Hauptpfade aus;
 * das --open-HTML zeigt immer beides.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { segmentGraph } from '../llm/segment.js';
import { graphToMermaid, segmentToJourney } from '../output/mermaid.js';
import { runExtract } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

/** Journey-Diagramm eines Flows samt Titel für die HTML-Überschrift. */
interface FlowJourney {
  title: string;
  journey: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Eigenständige HTML-Seite; Mermaid kommt zur Laufzeit vom CDN.
 * Zeigt immer beides: das Flowchart plus je Flow den Hauptpfad als journey.
 */
function buildGraphHtml(mermaid: string, journeys: FlowJourney[], title: string): string {
  const journeyBlocks = journeys.flatMap((entry) => [
    `  <h2>${escapeHtml(entry.title)}</h2>`,
    `  <pre class="mermaid">${escapeHtml(entry.journey)}</pre>`,
  ]);
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(title)} — Ductus Graph</title>`,
    '  <style>',
    '    body { font-family: system-ui, sans-serif; margin: 2rem; background: #fff; color: #111; }',
    '    @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } }',
    '  </style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(title)}</h1>`,
    `  <pre class="mermaid">${escapeHtml(mermaid)}</pre>`,
    ...journeyBlocks,
    '  <script type="module">',
    "    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';",
    "    mermaid.initialize({ startOnLoad: true, theme: 'default' });",
    '  </script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function registerGraph(program: Command): void {
  program
    .command('graph')
    .description('Gibt den Graphen als Mermaid aus; --open rendert ihn als HTML im Browser.')
    .option('--open', 'HTML nach .ductus/graph.html schreiben und im Browser öffnen')
    .option('--out <pfad>', 'Mermaid-Text in diese Datei schreiben statt auf stdout')
    .option('--journey', 'journey-Diagramme der Flow-Hauptpfade statt des Flowcharts ausgeben')
    .action(async (options: { open?: boolean; out?: string; journey?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const config = loadConfigWithWarnings(globals.config);
        // Nur Inspektion: nichts auf die Platte schreiben (write: false).
        const result = await runExtract(config, {
          ...(globals.offline !== undefined ? { offline: globals.offline } : {}),
          log: stderrLog,
          write: false,
        });

        if (result.validation.errors.length > 0) {
          printIssues(result.validation.errors);
          return 1;
        }

        const mermaid = graphToMermaid(result.graph);

        // Flow-Segmente über die bestehende Segmentierung bilden (keine Logik-Kopie);
        // die Reihenfolge ist bereits deterministisch nach flow.id sortiert (NFR2).
        const journeys: FlowJourney[] = [];
        for (const segment of segmentGraph(result.graph, 'flow')) {
          if (segment.kind !== 'flow') continue;
          const journey = segmentToJourney(segment);
          if (journey !== undefined) journeys.push({ title: segment.title, journey });
        }

        if (options.journey === true && journeys.length === 0) {
          process.stderr.write(
            'Hinweis: kein journey-Diagramm — kein Flow mit einem Hauptpfad aus mindestens zwei Knoten.\n',
          );
        }
        // stdout/--out: bei --journey alle journey-Diagramme (Leerzeile als Trenner), sonst das Flowchart.
        const text = options.journey === true ? journeys.map((entry) => entry.journey).join('\n\n') : mermaid;

        if (options.out !== undefined && text !== '') {
          const outPath = resolve(options.out);
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, `${text}\n`, 'utf8');
          process.stdout.write(`Geschrieben: ${outPath}\n`);
        }

        if (options.open === true) {
          const htmlPath = join(config.rootDir, '.ductus', 'graph.html');
          mkdirSync(dirname(htmlPath), { recursive: true });
          writeFileSync(htmlPath, buildGraphHtml(mermaid, journeys, config.app.name), 'utf8');
          process.stdout.write(`Geschrieben: ${htmlPath}\n`);
          const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
          const child = spawn(opener, [htmlPath], { detached: true, stdio: 'ignore' });
          child.on('error', (error) => {
            process.stderr.write(`Browser konnte nicht geöffnet werden (${error.message}).\n`);
          });
          child.unref();
        } else if (options.out === undefined && text !== '') {
          process.stdout.write(`${text}\n`);
        }
        return 0;
      });
    });
}
