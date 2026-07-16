/**
 * Tests for buildWebsite (`ductus generate --build`) with an injected
 * spawn — a real npm is never started (offline, NFR-compliant).
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

/** Prescribed outcome per call: regular exit code or spawn error (e.g. ENOENT). */
interface FakeOutcome {
  code?: number;
  errorCode?: string;
}

/** Builds a spawn double that records calls and emits close/error asynchronously. */
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
  it('runs npm install and npm run build one after the other in the site directory', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    const distDir = await buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ code: 0 })) });

    expect(calls.map((c) => c.command)).toEqual(['npm', 'npm']);
    expect(calls.map((c) => c.args)).toEqual([['install'], ['run', 'build']]);
    expect(calls.map((c) => c.cwd)).toEqual([siteDir, siteDir]);
    expect(distDir).toBe(join(siteDir, 'dist'));
  });

  it('picks npm ci instead of install when a package-lock.json exists', async () => {
    const siteDir = makeSiteDir();
    writeFileSync(join(siteDir, 'package-lock.json'), '{}\n', 'utf8');
    const calls: RecordedCall[] = [];
    await buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ code: 0 })) });

    expect(calls.map((c) => c.args)).toEqual([['ci'], ['run', 'build']]);
  });

  it('reports npm not found (ENOENT) with a clear message', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    await expect(
      buildWebsite({ siteDir, spawn: fakeSpawn(calls, () => ({ errorCode: 'ENOENT' })) }),
    ).rejects.toThrow(/command "npm" not found.*install Node\.js\/npm/);
    // No further call follows the failed first step.
    expect(calls.length).toBe(1);
  });

  it('reports the failed step when npm run build exits with 1', async () => {
    const siteDir = makeSiteDir();
    const calls: RecordedCall[] = [];
    const spawn = fakeSpawn(calls, (call) => (call.args[0] === 'run' ? { code: 1 } : { code: 0 }));
    const promise = buildWebsite({ siteDir, spawn });

    await expect(promise).rejects.toBeInstanceOf(WebsiteBuildError);
    await expect(promise).rejects.toThrow('"npm run build" failed with exit code 1');
    expect(calls.map((c) => c.args)).toEqual([['install'], ['run', 'build']]);
  });
});
