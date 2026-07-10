/**
 * `ductus extract`: Graph erzeugen + validieren →
 * journey-graph.json und ductus-report.json neben der Config (rootDir).
 */

import type { Command } from 'commander';
import { runExtract } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerExtract(program: Command): void {
  program
    .command('extract')
    .description('Erzeugt und validiert den User-Journey-Graphen (journey-graph.json).')
    .action(async (_options: Record<string, never>, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const config = loadConfigWithWarnings(globals.config);
        const result = await runExtract(config, {
          ...(globals.offline !== undefined ? { offline: globals.offline } : {}),
          log: stderrLog,
        });

        if (result.validation.errors.length > 0) {
          printIssues(result.validation.errors);
          return 1;
        }

        printIssues(result.validation.warnings);
        const { graph } = result;
        process.stdout.write(
          `Graph: ${graph.nodes.length} Nodes, ${graph.edges.length} Edges, ` +
            `${graph.flows.length} Flows, ${result.validation.warnings.length} Warnung(en)\n`,
        );
        for (const path of result.written) {
          process.stdout.write(`Geschrieben: ${path}\n`);
        }
        return 0;
      });
    });
}
