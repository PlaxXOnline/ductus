/**
 * Shared building blocks of the derivations (path C) — path slugs, JSX
 * helpers, `from` mapping. Everything is best effort and `source: "derived"`.
 */

import ts from 'typescript';
import { componentDeclarations, enclosingComponent } from '../declarations.js';
import type { ScannedFile } from '../scanner.js';

/**
 * Path slug for derived screen ids: leading '/' removed, '/'→'-',
 * ':param'/'[param]' segments dropped, empty → 'root' (as in the Dart adapter).
 */
export function slugFromPath(path: string): string {
  const slug = path
    .split('/')
    .filter((s) => s !== '' && !s.startsWith(':') && !s.startsWith('['))
    .join('-');
  return slug === '' ? 'root' : slug;
}

/** Humanized id: '-'→' ', first letter uppercased. */
export function humanize(id: string): string {
  const text = id.replaceAll('-', ' ');
  if (text === '') return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

export function joinPaths(parent: string, child: string): string {
  if (child.startsWith('/')) return child;
  if (parent === '' || parent === '/') return `/${child}`;
  return `${parent}/${child}`;
}

/** Value of a static string expression ('…', "…", `…` without interpolation). */
export function stringValue(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) return undefined;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return undefined;
}

/** Simple tag name of a JSX element (identifiers only, no `Foo.Bar`). */
export function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string | undefined {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return ts.isIdentifier(tag) ? tag.text : undefined;
}

/** Attribute expression of a JSX element: `name="…"` or `name={…}`. */
export function jsxAttributeExpression(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string,
): ts.Expression | undefined {
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
  for (const attr of attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (!ts.isIdentifier(attr.name) || attr.name.text !== name) continue;
    if (attr.initializer === undefined) return undefined;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer;
    if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression;
    return undefined;
  }
  return undefined;
}

/**
 * Boolean JSX attribute: `name` (without a value) and `name={true}` ⇒ true;
 * `name={false}`, other expressions, or a missing attribute ⇒ false.
 */
export function jsxBooleanAttribute(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string,
): boolean {
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
  for (const attr of attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name) || attr.name.text !== name) {
      continue;
    }
    if (attr.initializer === undefined) return true;
    return (
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword
    );
  }
  return false;
}

/**
 * Visible text of a JSX element when it is statically unambiguous:
 * exactly one non-empty JsxText child — the edge `label` candidate.
 */
export function jsxSingleTextChild(node: ts.JsxElement | ts.JsxSelfClosingElement): string | undefined {
  if (!ts.isJsxElement(node)) return undefined;
  const texts: string[] = [];
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      const trimmed = child.text.trim();
      if (trimmed !== '') texts.push(trimmed);
    } else {
      // Expression/element children ⇒ text is not statically unambiguous.
      return undefined;
    }
  }
  return texts.length === 1 ? texts[0] : undefined;
}

/**
 * Component name from an `element={…}` expression: tag of the JSX element;
 * if the element has exactly one JSX element child (wrappers like
 * `<Suspense>`), the child is preferred (analogous to the `child:`
 * preference in the Dart adapter).
 */
export function componentNameFromElement(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) return undefined;
  let node: ts.Expression = expr;
  if (ts.isParenthesizedExpression(node)) node = node.expression;
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
    // `Component={X}` — direct reference to the component.
    return ts.isIdentifier(node) && isComponentName(node.text) ? node.text : undefined;
  }
  const top = jsxTagName(node);
  if (top === undefined || !isComponentName(top)) return undefined;
  if (ts.isJsxElement(node)) {
    const elementChildren = node.children.filter(
      (c): c is ts.JsxElement | ts.JsxSelfClosingElement =>
        ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
    );
    if (elementChildren.length === 1) {
      const childName = jsxTagName(elementChildren[0]!);
      if (childName !== undefined && isComponentName(childName)) return childName;
    }
  }
  return top;
}

/** Components are capitalized by convention. */
export function isComponentName(name: string): boolean {
  return name.length > 0 && name[0] === name[0]!.toUpperCase();
}

/** Recursive visit of all nodes of a file. */
export function visit(root: ts.Node, callback: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    callback(node);
    node.forEachChild(walk);
  };
  walk(root);
}

/** Name of a node's enclosing top-level component (best effort). */
export function enclosingComponentName(file: ScannedFile, node: ts.Node): string | undefined {
  const declarations = componentDeclarations(file.sourceFile);
  return enclosingComponent(declarations, node.getStart(file.sourceFile))?.name;
}

export interface RedirectScan {
  /** Does the subtree contain any redirect(...) call at all? */
  hasRedirectCall: boolean;
  /** String literals of the first arguments of all redirect(...) calls. */
  targets: string[];
}

/** Finds `redirect(...)`/`permanentRedirect(...)` calls and their literal targets. */
export function collectRedirectTargets(root: ts.Node): RedirectScan {
  const scan: RedirectScan = { hasRedirectCall: false, targets: [] };
  visit(root, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
        ? callee.name.text
        : undefined;
    if (name !== 'redirect' && name !== 'permanentRedirect') return;
    scan.hasRedirectCall = true;
    const value = stringValue(node.arguments[0]);
    if (value !== undefined) scan.targets.push(value);
  });
  return scan;
}
