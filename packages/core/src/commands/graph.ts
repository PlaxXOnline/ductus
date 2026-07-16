/**
 * `ductus graph [--open] [--out <path>] [--journey]`: extract in memory,
 * Mermaid on stdout or a standalone HTML page under .ductus/graph.html.
 * --journey prints the journey diagrams of the flow main paths instead of the
 * flowchart; the --open HTML always shows both.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { segmentGraph } from '../llm/segment.js';
import { graphToMermaid, segmentToJourney } from '../output/mermaid.js';
import { outputStrings } from '../output/strings.js';
import { runExtract } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

/** Journey diagram of a flow plus its title for the HTML heading. */
interface FlowJourney {
  title: string;
  journey: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Standalone HTML page; Mermaid is loaded from the CDN at runtime.
 * Always shows both: the flowchart plus each flow's main path as a journey.
 */
function buildGraphHtml(mermaid: string, journeys: FlowJourney[], title: string): string {
  const journeyBlocks = journeys.flatMap((entry) => [
    `  <h2>${escapeHtml(entry.title)}</h2>`,
    `  <pre class="mermaid">${escapeHtml(entry.journey)}</pre>`,
  ]);
  return [
    '<!doctype html>',
    '<html lang="en">',
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
    .description('Prints the graph as Mermaid; --open renders it as HTML in the browser.')
    .option('--open', 'Write HTML to .ductus/graph.html and open it in the browser')
    .option('--out <path>', 'Write the Mermaid text to this file instead of stdout')
    .option('--journey', 'Print journey diagrams of the flow main paths instead of the flowchart')
    .action(async (options: { open?: boolean; out?: string; journey?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const config = loadConfigWithWarnings(globals.config);
        // Inspection only: write nothing to disk (write: false).
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

        // Build flow segments via the existing segmentation (no logic copy);
        // the order is already deterministic, sorted by flow.id (NFR2).
        const journeys: FlowJourney[] = [];
        const strings = outputStrings(config.app.locale);
        for (const segment of segmentGraph(result.graph, 'flow', {
          miscTitle: strings.miscSegmentTitle,
        })) {
          if (segment.kind !== 'flow') continue;
          const journey = segmentToJourney(segment, strings.mainPathHeading);
          if (journey !== undefined) journeys.push({ title: segment.title, journey });
        }

        if (options.journey === true && journeys.length === 0) {
          process.stderr.write(
            'Note: no journey diagram — no flow with a main path of at least two nodes.\n',
          );
        }
        // stdout/--out: with --journey all journey diagrams (blank line as separator), otherwise the flowchart.
        const text = options.journey === true ? journeys.map((entry) => entry.journey).join('\n\n') : mermaid;

        if (options.out !== undefined && text !== '') {
          const outPath = resolve(options.out);
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, `${text}\n`, 'utf8');
          process.stdout.write(`Wrote: ${outPath}\n`);
        }

        if (options.open === true) {
          const htmlPath = join(config.rootDir, '.ductus', 'graph.html');
          mkdirSync(dirname(htmlPath), { recursive: true });
          writeFileSync(htmlPath, buildGraphHtml(mermaid, journeys, config.app.name), 'utf8');
          process.stdout.write(`Wrote: ${htmlPath}\n`);
          const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
          const child = spawn(opener, [htmlPath], { detached: true, stdio: 'ignore' });
          child.on('error', (error) => {
            process.stderr.write(`Could not open the browser (${error.message}).\n`);
          });
          child.unref();
        } else if (options.out === undefined && text !== '') {
          process.stdout.write(`${text}\n`);
        }
        return 0;
      });
    });
}
