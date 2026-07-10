/**
 * Komponenten-Deklarationen einer Datei: das TS/JS-Gegenstück zu den
 * Klassendeklarationen, an die der Dart-Adapter Blöcke und Actions bindet.
 *
 * "Komponente" heißt hier: Top-Level-Klasse, -Funktionsdeklaration oder
 * -`const`/`let`/`var` mit Funktions-Initializer (auch `memo(...)`/
 * `forwardRef(...)`-umschlossen) — das deckt Klassen- und
 * Funktionskomponenten ab.
 */

import ts from 'typescript';

export interface ComponentDeclaration {
  name: string;
  /** Beginn der Deklaration ohne führende Trivia. */
  start: number;
  end: number;
}

function isFunctionLike(expr: ts.Expression): boolean {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return true;
  // memo(() => …), forwardRef(function …) — irgendein Funktions-Argument genügt.
  if (ts.isCallExpression(expr)) {
    return expr.arguments.some((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
  }
  return false;
}

/** Alle Top-Level-Komponenten-Deklarationen in Dokumentreihenfolge. */
export function componentDeclarations(sourceFile: ts.SourceFile): ComponentDeclaration[] {
  const result: ComponentDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      result.push({
        name: statement.name.text,
        start: statement.getStart(sourceFile),
        end: statement.end,
      });
    } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      result.push({
        name: statement.name.text,
        start: statement.getStart(sourceFile),
        end: statement.end,
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer !== undefined &&
          isFunctionLike(decl.initializer)
        ) {
          result.push({
            name: decl.name.text,
            start: statement.getStart(sourceFile),
            end: statement.end,
          });
        }
      }
    }
  }
  return result;
}

/** Kleinste umschließende Komponente für einen Offset (Top-Level ⇒ eindeutig). */
export function enclosingComponent(
  declarations: readonly ComponentDeclaration[],
  offset: number,
): ComponentDeclaration | undefined {
  return declarations.find((decl) => decl.start <= offset && offset < decl.end);
}

/**
 * Nächste Komponente ab einem Offset — für Blöcke, die OBERHALB einer
 * Deklaration stehen (wie [_nextClassAfter] im Dart-Adapter).
 */
export function nextComponentAfter(
  declarations: readonly ComponentDeclaration[],
  offset: number,
): ComponentDeclaration | undefined {
  let best: ComponentDeclaration | undefined;
  for (const decl of declarations) {
    if (decl.end > offset && (best === undefined || decl.start < best.start)) {
      best = decl;
    }
  }
  return best;
}
