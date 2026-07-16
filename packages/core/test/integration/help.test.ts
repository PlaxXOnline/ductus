/**
 * End-to-end tests for `ductus help` against the built dist output.
 * The build runs once per test file in beforeAll (generous timeout).
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLI = join(ROOT, 'packages', 'core', 'dist', 'cli.js');

const tmpRoots: string[] = [];

/** `ductus help` needs no config — an empty temp directory is enough as cwd. */
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-help-test-'));
  tmpRoots.push(dir);
  return dir;
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  // Build once per test file — the CLI tests run against dist/ (bin contract).
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 300_000 });
  expect(existsSync(CLI)).toBe(true);
}, 360_000);

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('ductus help', () => {
  it('prints the overview with all commands, exit codes, config and key notes (exit 0)', () => {
    const result = runCli(['help'], makeDir());
    expect(result.status, result.stderr).toBe(0);

    // All commands appear with a one-liner each.
    for (const name of ['init', 'extract', 'generate', 'check', 'graph', 'help']) {
      expect(result.stdout).toMatch(new RegExp(`^  ${name} {2,}\\S`, 'm'));
    }

    // Typical workflow in order init → extract → generate → check.
    expect(result.stdout).toMatch(
      /1\. ductus init[\s\S]*2\. ductus extract[\s\S]*3\. ductus generate[\s\S]*4\. ductus check/,
    );

    // Exit-code table covers all four codes.
    expect(result.stdout).toContain('Exit codes:');
    expect(result.stdout).toMatch(/^ {2}0 {2}Success$/m);
    expect(result.stdout).toMatch(/^ {2}1 {2}Validation error or merge conflict$/m);
    expect(result.stdout).toMatch(/^ {2}2 {2}Faithfulness violations above the configured threshold$/m);
    expect(result.stdout).toMatch(/^ {2}3 {2}LLM, configuration, or adapter error$/m);

    // Config file, API-key note, and links.
    expect(result.stdout).toContain('./ductus.config.yaml');
    expect(result.stdout).toContain('-c, --config <path>');
    expect(result.stdout).toContain('DUCTUS_LLM_API_KEY');
    expect(result.stdout).toContain('never appear in any Ductus output');
    expect(result.stdout).toContain('https://github.com/PlaxXOnline/ductus');
    expect(result.stdout).toContain('https://plaxxonline.github.io/ductus/');
  });

  it('help generate shows the generate help including its options (exit 0)', () => {
    const result = runCli(['help', 'generate'], makeDir());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('generate');
    expect(result.stdout).toContain('--build');
    expect(result.stdout).toContain('Generates end-user documentation');
  });

  it('help with an unknown command prints a short error plus hint and exits 1', () => {
    const result = runCli(['help', 'does-not-exist'], makeDir());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command "does-not-exist"');
    expect(result.stderr).toContain('ductus help');
    expect(result.stdout).toBe('');
  });

  it('--help still works and lists exactly one help command', () => {
    const result = runCli(['--help'], makeDir());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage:');
    // Exactly one "help" entry in the command list (no implicit duplicate).
    const helpEntries = result.stdout.match(/^ {2}help\b/gm) ?? [];
    expect(helpEntries).toHaveLength(1);
  });
});
