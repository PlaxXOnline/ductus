#!/usr/bin/env node
/**
 * Fake npm for integration tests of `ductus generate --build`: logs every
 * call as "<cwd>\t<arguments>" to the file given in $DUCTUS_FAKE_NPM_LOG and
 * fails with exit 1 when $DUCTUS_FAKE_NPM_FAIL matches the first argument
 * (e.g. "ci", "install" or "run"). No network access, no real npm — the
 * tests stay offline.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);

const logFile = process.env.DUCTUS_FAKE_NPM_LOG;
if (logFile !== undefined && logFile !== '') {
  appendFileSync(logFile, `${process.cwd()}\t${args.join(' ')}\n`, 'utf8');
}

if (process.env.DUCTUS_FAKE_NPM_FAIL === args[0]) {
  process.stderr.write(`fake-npm: intentional failure for "npm ${args.join(' ')}"\n`);
  process.exit(1);
}

// `npm run build` leaves a dist/ directory behind, like a real SSG build.
if (args[0] === 'run' && args[1] === 'build') {
  mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
  writeFileSync(join(process.cwd(), 'dist', 'index.html'), '<!doctype html>\n', 'utf8');
}
