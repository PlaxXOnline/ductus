#!/usr/bin/env node
/**
 * ductus-CLI: init | extract | generate | check | graph.
 * Exit-Codes: 0 ok, 1 Validierungsfehler/Merge-Konflikt, 2 Faithfulness über
 * Schwellwert, 3 LLM-/Konfigurations-/Adapterfehler; API-Keys erscheinen in
 * keiner Ausgabe (NFR4).
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
