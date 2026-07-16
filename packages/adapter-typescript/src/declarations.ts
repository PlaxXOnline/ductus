/**
 * Component declarations of a file: the TS/JS counterpart to the class
 * declarations that the Dart adapter binds blocks and actions to.
 *
 * "Component" here means: top-level class, function declaration, or
 * `const`/`let`/`var` with a function initializer (including `memo(...)`/
 * `forwardRef(...)` wrappers) — this covers class and function components.
 */

import ts from 'typescript';

export interface ComponentDeclaration {
  name: string;
  /** Start of the declaration without leading trivia. */
  start: number;
  end: number;
}

function isFunctionLike(expr: ts.Expression): boolean {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return true;
  // memo(() => …), forwardRef(function …) — any function argument suffices.
  if (ts.isCallExpression(expr)) {
    return expr.arguments.some((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
  }
  return false;
}

/** All top-level component declarations in document order. */
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

/** Smallest enclosing component for an offset (top-level ⇒ unambiguous). */
export function enclosingComponent(
  declarations: readonly ComponentDeclaration[],
  offset: number,
): ComponentDeclaration | undefined {
  return declarations.find((decl) => decl.start <= offset && offset < decl.end);
}

/**
 * Next component from an offset onwards — for blocks that sit ABOVE a
 * declaration (like [_nextClassAfter] in the Dart adapter).
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
