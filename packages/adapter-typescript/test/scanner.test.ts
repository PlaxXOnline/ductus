/**
 * File discovery + glob semantics of the scanner.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AdapterConfig } from '../src/config.js';
import { AdapterException } from '../src/graph-model.js';
import { globToRegExp, scanProject } from '../src/scanner.js';
import { WarnLog } from './test-util.js';

const tmpRoots: string[] = [];

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-scanner-test-'));
  tmpRoots.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('** matches across segment boundaries', () => {
    const re = globToRegExp('src/**');
    expect(re.test('src/a/b.ts')).toBe(true);
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('lib/x.ts')).toBe(false);
  });

  it('* stays within a segment', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/a/b.ts')).toBe(false);
  });

  it('? matches exactly one character, but not /', () => {
    const re = globToRegExp('src/?.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/ab.ts')).toBe(false);
    expect(re.test('src/.ts')).toBe(false);
    expect(globToRegExp('a?b').test('a/b')).toBe(false);
  });

  it('regex special characters like . are escaped', () => {
    const re = globToRegExp('*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('a-ts')).toBe(false);
  });
});

describe('scanProject', () => {
  it('never scans node_modules/dist/dot directories — not even with include **', () => {
    const dir = makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'node_modules/pkg/index.ts': 'export const x = 1;\n',
      'dist/out.ts': 'export const y = 1;\n',
      'build/b.ts': 'export const z = 1;\n',
      'coverage/c.ts': 'export const c = 1;\n',
      '.next/page.ts': 'export const p = 1;\n',
    });

    const files = scanProject(dir, new AdapterConfig({ include: ['**'] }), new WarnLog().call);
    expect(files.map((f) => f.relPath)).toEqual(['src/a.ts']);
  });

  it('include globs filter; paths are posix-relative and sorted', () => {
    const dir = makeProject({
      'src/z.ts': 'export const z = 1;\n',
      'src/a/b.tsx': 'export const b = () => null;\n',
      'lib/x.ts': 'export const x = 1;\n',
      'docs/readme.ts': 'export const d = 1;\n',
      'src/notes.md': '# Notes\n',
    });

    // Default includes: src/**, app/**, pages/**, lib/** — docs/ is dropped,
    // .md is not a source extension.
    const files = scanProject(dir, new AdapterConfig(), new WarnLog().call);
    expect(files.map((f) => f.relPath)).toEqual(['lib/x.ts', 'src/a/b.tsx', 'src/z.ts']);
    expect(files.every((f) => !f.relPath.includes('\\'))).toBe(true);
    // The files are parsed (SourceFile present).
    expect(files[0]!.sourceFile.statements.length).toBeGreaterThan(0);
  });

  it('only matching include globs remain', () => {
    const dir = makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'lib/x.ts': 'export const x = 1;\n',
    });

    const files = scanProject(dir, new AdapterConfig({ include: ['src/**'] }), new WarnLog().call);
    expect(files.map((f) => f.relPath)).toEqual(['src/a.ts']);
  });

  it('files with syntax errors are used best effort and reported with a warning', () => {
    const dir = makeProject({
      'src/kaputt.tsx': 'export function Broken( {\n',
      'src/ok.ts': 'export const ok = 1;\n',
    });

    const warnings = new WarnLog();
    const files = scanProject(dir, new AdapterConfig(), warnings.call);
    expect(files.map((f) => f.relPath)).toEqual(['src/kaputt.tsx', 'src/ok.ts']);
    expect(warnings.messages).toEqual([
      'Warning: src/kaputt.tsx contains syntax errors; analysis is best effort.',
    ]);
  });

  it('a non-existent project directory throws AdapterException', () => {
    const dir = makeProject({});
    expect(() =>
      scanProject(join(dir, 'gibt-es-nicht'), new AdapterConfig(), new WarnLog().call),
    ).toThrowError(AdapterException);
    expect(() =>
      scanProject(join(dir, 'gibt-es-nicht'), new AdapterConfig(), new WarnLog().call),
    ).toThrowError(/Project directory not found/);
  });
});
