#!/usr/bin/env node
/**
 * ductus-CLI (SPEC §10.1): init | extract | generate | check | graph.
 * Exit-Codes nach §10.3/DD §I; API-Keys erscheinen in keiner Ausgabe (NFR4).
 */

import { Command } from 'commander';
import {
  registerCheck,
  registerExtract,
  registerGenerate,
  registerGraph,
  registerInit,
} from './commands/index.js';

const program = new Command('ductus');

program
  .description('Ductus — generiert Endnutzer-Dokumentation aus annotiertem Quellcode.')
  .option('-c, --config <pfad>', 'Pfad zur ductus.config.yaml', './ductus.config.yaml')
  .option('--offline', 'Kein Netzzugriff: extract/check/graph frei, generate nur mit provider "mock"');

registerInit(program);
registerExtract(program);
registerGenerate(program);
registerCheck(program);
registerGraph(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  // Sollte nicht eintreten (Aktionen fangen selbst) — kompakt melden, Exit 3.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fehler: ${message}\n`);
  process.exitCode = 3;
});
