/**
 * `ductus help [command]`: without an argument prints a rich CLI overview
 * (pitch, workflow, commands, exit codes, configuration, links); with an
 * argument delegates to commander's built-in help for that subcommand.
 * Unknown command ⇒ short error + hint, exit 1 (commander's usage-error code).
 */

import type { Command } from 'commander';
import { runAction } from './shared.js';

/** The full overview for `ductus help` (kept in sync with the command descriptions). */
const OVERVIEW = [
  'Ductus — generates end-user documentation from annotated source code.',
  '',
  'Ductus extracts a user-journey graph from annotations in your source code',
  '(Dart/Flutter, TypeScript/JavaScript) and turns it into end-user documentation',
  'with your own LLM key (BYOK), guarded by a faithfulness judge.',
  '',
  'Usage:',
  '  ductus [global options] <command> [command options]',
  '',
  'Typical workflow:',
  '  1. ductus init        Set up a ductus.config.yaml for your project',
  '  2. ductus extract     Build and validate the user-journey graph',
  '  3. ductus generate    Generate the documentation (MDX or website)',
  '  4. ductus check       Verify graph validity and faithfulness (CI)',
  '',
  'Commands:',
  '  init      Creates a ductus.config.yaml and detects the project.',
  '  extract   Builds and validates the user-journey graph (journey-graph.json).',
  '  generate  Generates end-user documentation (MDX or website) from the graph.',
  '  check     Checks graph validity and faithfulness without writing files (CI).',
  '  graph     Prints the graph as Mermaid; --open renders it as HTML in the browser.',
  '  help      Shows this overview or the help for a specific command.',
  '',
  'Exit codes:',
  '  0  Success',
  '  1  Validation error or merge conflict',
  '  2  Faithfulness violations above the configured threshold',
  '  3  LLM, configuration, or adapter error',
  '',
  'Configuration:',
  '  Ductus reads ./ductus.config.yaml by default; override the path with',
  '  -c, --config <path>.',
  '',
  'API key:',
  '  Provide your LLM API key via the DUCTUS_LLM_API_KEY environment variable.',
  '  API keys never appear in any Ductus output.',
  '',
  'Learn more:',
  '  Repository:  https://github.com/PlaxXOnline/ductus',
  '  Live demo:   https://plaxxonline.github.io/ductus/',
  '',
].join('\n');

export function registerHelp(program: Command): void {
  program
    .command('help [command]')
    .description('Shows this overview or the help for a specific command.')
    .action(async (commandName: string | undefined) => {
      await runAction(async () => {
        if (commandName === undefined) {
          process.stdout.write(OVERVIEW);
          return 0;
        }
        const target = program.commands.find(
          (subcommand) =>
            subcommand.name() === commandName || subcommand.aliases().includes(commandName),
        );
        if (target === undefined) {
          // Usage error, same convention as commander's unknown-command handling (exit 1).
          process.stderr.write(
            `Error: unknown command "${commandName}". Run "ductus help" for an overview.\n`,
          );
          return 1;
        }
        target.outputHelp();
        return 0;
      });
    });
}
