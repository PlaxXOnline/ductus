/**
 * `ductus extract`: build + validate the graph →
 * journey-graph.json and ductus-report.json next to the config (rootDir).
 */

import type { Command } from 'commander';
import { runExtract } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerExtract(program: Command): void {
  program
    .command('extract')
    .description('Builds and validates the user-journey graph (journey-graph.json).')
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
          `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
            `${graph.flows.length} flows, ${result.validation.warnings.length} warning(s)\n`,
        );
        for (const path of result.written) {
          process.stdout.write(`Wrote: ${path}\n`);
        }
        return 0;
      });
    });
}
