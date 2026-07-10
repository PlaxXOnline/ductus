/**
 * Dateisuche + Glob-Semantik des Scanners.
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
  it('** matcht über Segmentgrenzen', () => {
    const re = globToRegExp('src/**');
    expect(re.test('src/a/b.ts')).toBe(true);
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('lib/x.ts')).toBe(false);
  });

  it('* bleibt innerhalb eines Segments', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/a/b.ts')).toBe(false);
  });

  it('? matcht genau ein Zeichen, aber kein /', () => {
    const re = globToRegExp('src/?.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/ab.ts')).toBe(false);
    expect(re.test('src/.ts')).toBe(false);
    expect(globToRegExp('a?b').test('a/b')).toBe(false);
  });

  it('Regex-Sonderzeichen wie . werden escaped', () => {
    const re = globToRegExp('*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('a-ts')).toBe(false);
  });
});

describe('scanProject', () => {
  it('scannt node_modules/dist/dot-Verzeichnisse nie — auch nicht bei include **', () => {
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

  it('include-Globs filtern; Pfade sind posix-relativ und sortiert', () => {
    const dir = makeProject({
      'src/z.ts': 'export const z = 1;\n',
      'src/a/b.tsx': 'export const b = () => null;\n',
      'lib/x.ts': 'export const x = 1;\n',
      'docs/readme.ts': 'export const d = 1;\n',
      'src/notes.md': '# Notizen\n',
    });

    // Default-Includes: src/**, app/**, pages/**, lib/** — docs/ fällt raus,
    // .md ist keine Quell-Endung.
    const files = scanProject(dir, new AdapterConfig(), new WarnLog().call);
    expect(files.map((f) => f.relPath)).toEqual(['lib/x.ts', 'src/a/b.tsx', 'src/z.ts']);
    expect(files.every((f) => !f.relPath.includes('\\'))).toBe(true);
    // Die Dateien sind geparst (SourceFile vorhanden).
    expect(files[0]!.sourceFile.statements.length).toBeGreaterThan(0);
  });

  it('nur passende include-Globs bleiben übrig', () => {
    const dir = makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'lib/x.ts': 'export const x = 1;\n',
    });

    const files = scanProject(dir, new AdapterConfig({ include: ['src/**'] }), new WarnLog().call);
    expect(files.map((f) => f.relPath)).toEqual(['src/a.ts']);
  });

  it('Dateien mit Syntaxfehlern werden best effort verwendet und mit Warnung gemeldet', () => {
    const dir = makeProject({
      'src/kaputt.tsx': 'export function Broken( {\n',
      'src/ok.ts': 'export const ok = 1;\n',
    });

    const warnings = new WarnLog();
    const files = scanProject(dir, new AdapterConfig(), warnings.call);
    expect(files.map((f) => f.relPath)).toEqual(['src/kaputt.tsx', 'src/ok.ts']);
    expect(warnings.messages).toEqual([
      'Warnung: src/kaputt.tsx enthält Syntaxfehler; Analyse ist best effort.',
    ]);
  });

  it('nicht existierendes Projektverzeichnis wirft AdapterException', () => {
    const dir = makeProject({});
    expect(() =>
      scanProject(join(dir, 'gibt-es-nicht'), new AdapterConfig(), new WarnLog().call),
    ).toThrowError(AdapterException);
    expect(() =>
      scanProject(join(dir, 'gibt-es-nicht'), new AdapterConfig(), new WarnLog().call),
    ).toThrowError(/Projektverzeichnis nicht gefunden/);
  });
});
