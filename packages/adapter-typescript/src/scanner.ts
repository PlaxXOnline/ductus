/**
 * File discovery + parsing of the TS/JS sources via the TypeScript
 * compiler API.
 *
 * Parse-only: no type resolution, no tsconfig, no npm install needed in the
 * target project. `relPath` is project-relative with '/' separators and the
 * deterministic sort key everywhere.
 */

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { AdapterConfig } from './config.js';
import { AdapterException, type SourceRef } from './graph-model.js';

/** Source extensions the adapter understands (TS and JS, each with JSX). */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Directories that are never scanned — regardless of the include globs
 * (necessary here unlike in the Dart adapter because node_modules/build
 * output sit next to the sources in TS/JS projects). Dot directories (.git,
 * .next, …) are always skipped.
 */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

/** A scanned source file with its parsed SourceFile. */
export class ScannedFile {
  #lineStarts: number[] | undefined;

  constructor(
    readonly relPath: string,
    readonly content: string,
    readonly sourceFile: ts.SourceFile,
  ) {}

  /** 1-based line of a character offset. */
  lineOf(pos: number): number {
    return this.sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  /**
   * Offset of the line start of a 1-based line — counts only '\n' (like the
   * line-based comment parser), NOT TypeScript's line map: that one also
   * counts U+2028/U+2029/lone '\r' as line breaks, which would shift the
   * mapping of @journey blocks.
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
 * Glob → RegExp over the posix-relative path: `**` matches across '/'
 * boundaries, `*`/`?` within a segment (like package:glob in the
 * Dart adapter).
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
  // .js/.jsx/.mjs/.cjs: parse as JSX — JSX in .js is common in the React
  // ecosystem, and plain JS parses unchanged under ScriptKind.JSX.
  return ts.ScriptKind.JSX;
}

/** Recursive file list as posix-relative paths, deterministically sorted. */
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
        // lstat: symlinks are not followed (as in the Dart scanner).
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
 * Collects all source files under the include globs and parses them.
 * Syntax errors do not abort: the TypeScript compiler API parses fault
 * tolerantly, the analysis is best effort.
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
    throw new AdapterException([`Project directory not found: ${projectDir}`]);
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
      warn(`Warning: ${rel} is not readable — skipped.`);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      rel,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKindOf(rel),
    );
    // parseDiagnostics is not a public API, but it is the only way to get at
    // the parse errors without a Program/TypeChecker — access defensively.
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown[] })
      .parseDiagnostics;
    if (Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0) {
      warn(`Warning: ${rel} contains syntax errors; analysis is best effort.`);
    }
    files.push(new ScannedFile(rel, content, sourceFile));
  }
  return files;
}
