#!/usr/bin/env node
/**
 * ductus CLI: init | extract | generate | check | graph | help.
 * Exit codes: 0 ok, 1 validation error/merge conflict, 2 faithfulness above
 * threshold, 3 LLM/configuration/adapter error; API keys never appear in any
 * output (NFR4).
 */

import { Command } from 'commander';
import {
  registerCheck,
  registerExtract,
  registerGenerate,
  registerGraph,
  registerHelp,
  registerInit,
} from './commands/index.js';

const program = new Command('ductus');

program
  .description('Ductus — generates end-user documentation from annotated source code.')
  .option('-c, --config <path>', 'Path to the ductus.config.yaml', './ductus.config.yaml')
  .option('--offline', 'No network access: extract/check/graph run freely, generate only with provider "mock"');

// Suppress commander's implicit help command — `ductus help` is registered
// below as an explicit command (rich overview); `ductus --help` still works.
program.helpCommand(false);

registerInit(program);
registerExtract(program);
registerGenerate(program);
registerCheck(program);
registerGraph(program);
registerHelp(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  // Should not happen (actions catch their own errors) — report briefly, exit 3.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 3;
});
