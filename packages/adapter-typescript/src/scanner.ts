/**
 * Dateisuche + Parsen der TS/JS-Quellen über die TypeScript-Compiler-API.
 *
 * Parse-only: keine Typauflösung, kein tsconfig, kein npm install im
 * Zielprojekt nötig. `relPath` ist projekt-relativ mit '/'-Separatoren und
 * überall der deterministische Sortierschlüssel.
 */

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { AdapterConfig } from './config.js';
import { AdapterException, type SourceRef } from './graph-model.js';

/** Quell-Endungen, die der Adapter versteht (TS und JS, jeweils mit JSX). */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Verzeichnisse, die nie gescannt werden — unabhängig von den include-Globs
 * (anders als im Dart-Adapter nötig, weil node_modules/Build-Ausgaben in
 * TS/JS-Projekten neben den Quellen liegen). Dot-Verzeichnisse (.git, .next,
 * …) werden generell übersprungen.
 */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

/** Eine gescannte Quelldatei mit geparster SourceFile. */
export class ScannedFile {
  #lineStarts: number[] | undefined;

  constructor(
    readonly relPath: string,
    readonly content: string,
    readonly sourceFile: ts.SourceFile,
  ) {}

  /** 1-basierte Zeile eines Zeichen-Offsets. */
  lineOf(pos: number): number {
    return this.sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  /**
   * Offset des Zeilenanfangs einer 1-basierten Zeile — zählt ausschließlich
   * '\n' (wie der zeilenbasierte Kommentar-Parser), NICHT TypeScripts
   * Line-Map: die zählt auch U+2028/U+2029/einsame '\r' als Umbrüche, was
   * die Zuordnung von @journey-Blöcken verschieben würde.
   */
  offsetOfLine(line: number): number {
    if (this.#lineStarts === undefined) {
      const starts = [0];
      for (let i = 0; i < this.content.length; i++) {
        if (this.content[i] === '\n') starts.push(i + 1);
      }
      this.#lineStarts = starts;
    }
    return this.#lineStarts[line - 1] ?? this.content.length;
  }

  refAt(pos: number, symbol?: string): SourceRef {
    return {
      file: this.relPath,
      line: this.lineOf(pos),
      ...(symbol !== undefined ? { symbol } : {}),
    };
  }
}

/**
 * Glob → RegExp über den posix-relativen Pfad: `**` matcht über
 * '/'-Grenzen, `*`/`?` innerhalb eines Segments (wie package:glob im
 * Dart-Adapter).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

function scriptKindOf(relPath: string): ts.ScriptKind {
  if (relPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (relPath.endsWith('.ts') || relPath.endsWith('.mts') || relPath.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  // .js/.jsx/.mjs/.cjs: als JSX parsen — JSX in .js ist im React-Ökosystem
  // üblich, und reines JS parst unter ScriptKind.JSX unverändert.
  return ts.ScriptKind.JSX;
}

/** Rekursive Dateiliste als posix-relative Pfade, deterministisch sortiert. */
function listFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string, relPrefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relPrefix === '' ? entry : `${relPrefix}/${entry}`;
      const abs = join(dir, entry);
      let stat;
      try {
        // lstat: Symlinks werden nicht verfolgt (wie im Dart-Scanner).
        stat = lstatSync(abs, { throwIfNoEntry: false });
        if (stat === undefined) continue;
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (entry.startsWith('.') || EXCLUDED_DIRS.has(entry)) continue;
        walk(abs, rel);
      } else if (stat.isFile()) {
        result.push(rel);
      }
    }
  };
  walk(root, '');
  result.sort();
  return result;
}

/**
 * Sammelt alle Quelldateien unter den include-Globs und parst sie.
 * Syntaxfehler sind kein Abbruch: die TypeScript-Compiler-API parst
 * fehlertolerant, die Analyse ist best effort.
 */
export function scanProject(
  projectDir: string,
  config: AdapterConfig,
  warn: (message: string) => void,
): ScannedFile[] {
  let rootStat;
  try {
    rootStat = statSync(projectDir, { throwIfNoEntry: false });
  } catch {
    rootStat = undefined;
  }
  if (rootStat === undefined || !rootStat.isDirectory()) {
    throw new AdapterException([`Projektverzeichnis nicht gefunden: ${projectDir}`]);
  }

  const includes = config.include.map(globToRegExp);
  const files: ScannedFile[] = [];
  for (const rel of listFiles(projectDir)) {
    if (!SOURCE_EXTENSIONS.some((ext) => rel.endsWith(ext))) continue;
    if (!includes.some((re) => re.test(rel))) continue;

    let content: string;
    try {
      content = readFileSync(join(projectDir, ...rel.split('/')), 'utf8');
    } catch {
      warn(`Warnung: ${rel} ist nicht lesbar — übersprungen.`);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      rel,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKindOf(rel),
    );
    // parseDiagnostics ist kein öffentliches API, aber der einzige Weg an die
    // Parse-Fehler ohne Program/TypeChecker — defensiv zugreifen.
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown[] })
      .parseDiagnostics;
    if (Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0) {
      warn(`Warnung: ${rel} enthält Syntaxfehler; Analyse ist best effort.`);
    }
    files.push(new ScannedFile(rel, content, sourceFile));
  }
  return files;
}
