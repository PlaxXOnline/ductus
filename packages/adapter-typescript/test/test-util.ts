/**
 * Shared test helpers — counterpart of dart/ductus/test/test_util.dart.
 */

import ts from 'typescript';
import { ScannedFile } from '../src/scanner.js';

/** ScriptKind matching the extension — like scriptKindOf in the scanner. */
function scriptKindOf(relPath: string): ts.ScriptKind {
  if (relPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (relPath.endsWith('.ts') || relPath.endsWith('.mts') || relPath.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}

/** Parses source text into a [ScannedFile] (parse-only, like the scanner). */
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

/** Collects warnings instead of stderr. */
export class WarnLog {
  readonly messages: string[] = [];

  readonly call = (message: string): void => {
    this.messages.push(message);
  };
}
