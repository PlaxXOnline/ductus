/**
 * Gemeinsame Test-Helfer — Gegenstück zu dart/ductus/test/test_util.dart.
 */

import ts from 'typescript';
import { ScannedFile } from '../src/scanner.js';

/** ScriptKind passend zur Endung — wie scriptKindOf im Scanner. */
function scriptKindOf(relPath: string): ts.ScriptKind {
  if (relPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (relPath.endsWith('.ts') || relPath.endsWith('.mts') || relPath.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}

/** Parst Quelltext zu einer [ScannedFile] (parse-only, wie der Scanner). */
export function scanSource(content: string, relPath = 'src/test.tsx'): ScannedFile {
  const sourceFile = ts.createSourceFile(
    relPath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindOf(relPath),
  );
  return new ScannedFile(relPath, content, sourceFile);
}

/** Sammelt Warnungen statt stderr. */
export class WarnLog {
  readonly messages: string[] = [];

  readonly call = (message: string): void => {
    this.messages.push(message);
  };
}
