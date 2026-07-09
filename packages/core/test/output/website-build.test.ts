/**
 * Tests für buildWebsite (`ductus generate --build`, DD §M) mit injiziertem
 * spawn — es wird nie ein echtes npm gestartet (offline, NFR-tauglich).
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWebsite, WebsiteBuildError, type WebsiteBuildSpawn } from '../../src/output/website.js';

interface RecordedCall {
  command: string;
  args: string[];
  cwd: string;
}

/** Ergebnisvorgabe je Aufruf: normaler Exit-Code oder spawn-Fehler (z. B. ENOENT). */
interface FakeOutcome {
  code?: number;
  errorCode?: string;
}

/** Baut ein spawn-Double, das Aufrufe protokolliert und asynchron close/error emittiert. */
function fakeSpawn(calls: RecordedCall[], behavior: (call: RecordedCall) => FakeOutcome): WebsiteBuildSpawn {
  return (command, args, options) => {
    const call: RecordedCall = { command, args: [...args], cwd: options.cwd };
    calls.push(call);
    const child = new EventEmitter();
    const outcome = behavior(call);
    queueMicrotask(() => {
      if (outcome.errorCode !== undefined) {
        const error: NodeJS.ErrnoException = new Error(`spawn ${command} ${outcome.errorCode}`);
        error.code = outcome.errorCode;
        child.emit('error', error);
        return;
      }
      child.emit('close', outcome.code ?? 0, null);
    });
    return child;
  };
}

function makeSiteDir(): string {
  return mkdtempSync(join(tmpdir(), 'ductus-build-'));
}

describe('buildWebsite', () => {
  it('führt npm install und npm run build nacheinander im Site-Verzeichnis aus', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    const distDir = await buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ code: 0 })) });

    expect(calls.map((c) => c.command)).toEqual(['npm', 'npm']);
    expect(calls.map((c) => c.args)).toEqual([['install'], ['run', 'build']]);
    expect(calls.map((c) => c.cwd)).toEqual([siteDir, siteDir]);
    expect(distDir).toBe(join(siteDir, 'dist'));
  });

  it('wählt npm ci statt install, wenn eine package-lock.json existiert', async () => {
    const siteDir = makeSiteDir();
    writeFileSync(join(siteDir, 'package-lock.json'), '{}\n', 'utf8');
    const calls: RecordedCall[] = [];
    await buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ code: 0 })) });

    expect(calls.map((c) => c.args)).toEqual([['ci'], ['run', 'build']]);
  });

  it('meldet nicht gefundenes npm (ENOENT) mit klarer deutscher Meldung', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    await expect(
      buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ errorCode: 'ENOENT' })) }),
    ).rejects.toThrow(/Befehl "npm" nicht gefunden.*Node\.js\/npm installieren/);
    // Nach dem gescheiterten ersten Schritt folgt kein weiterer Aufruf.
    expect(calls.length).toBe(1);
  });

  it('meldet den gescheiterten Schritt, wenn npm run build mit Exit 1 endet', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    const spawn = fakeSpawn(calls, (call) => (call.args[0] === 'run' ? { code: 1 } : { code: 0 }));
    const promise = buildWebsite({ siteDir, spawn });

    await expect(promise).rejects.toBeInstanceOf(WebsiteBuildError);
    await expect(promise).rejects.toThrow('"npm run build" scheiterte mit Exit-Code 1');
    expect(calls.map((c) => c.args)).toEqual([['install'], ['run', 'build']]);
  });
});
