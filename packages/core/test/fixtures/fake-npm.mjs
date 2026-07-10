#!/usr/bin/env node
/**
 * Fake-npm für Integrationstests von `ductus generate --build`:
 * protokolliert jeden Aufruf als "<cwd>\t<argumente>" in die Datei aus
 * $DUCTUS_FAKE_NPM_LOG und scheitert mit Exit 1, wenn $DUCTUS_FAKE_NPM_FAIL
 * dem ersten Argument entspricht (z. B. "ci", "install" oder "run").
 * Kein Netzzugriff, kein echtes npm — die Tests bleiben offline.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);

const logFile = process.env.DUCTUS_FAKE_NPM_LOG;
if (logFile !== undefined && logFile !== '') {
  appendFileSync(logFile, `${process.cwd()}\t${args.join(' ')}\n`, 'utf8');
}

if (process.env.DUCTUS_FAKE_NPM_FAIL === args[0]) {
  process.stderr.write(`fake-npm: absichtlicher Fehler für "npm ${args.join(' ')}"\n`);
  process.exit(1);
}

// `npm run build` hinterlässt wie ein echter SSG-Build ein dist/-Verzeichnis.
if (args[0] === 'run' && args[1] === 'build') {
  mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
  writeFileSync(join(process.cwd(), 'dist', 'index.html'), '<!doctype html>\n', 'utf8');
}
