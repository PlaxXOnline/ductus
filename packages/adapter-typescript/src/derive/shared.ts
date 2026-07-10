/**
 * Gemeinsame Bausteine der Ableitungen (Weg C) — Pfad-Slugs, JSX-Helfer,
 * from-Zuordnung. Alles best effort und `source: "derived"`.
 */

import ts from 'typescript';
import { componentDeclarations, enclosingComponent } from '../declarations.js';
import type { ScannedFile } from '../scanner.js';

/**
 * Pfad-Slug für abgeleitete Screen-Ids: führendes '/' weg, '/'→'-',
 * ':param'/'[param]'-Segmente entfallen, leer → 'root' (wie im Dart-Adapter).
 */
export function slugFromPath(path: string): string {
  const slug = path
    .split('/')
    .filter((s) => s !== '' && !s.startsWith(':') && !s.startsWith('['))
    .join('-');
  return slug === '' ? 'root' : slug;
}

/** Humanisierte Id: '-'→' ', erster Buchstabe groß. */
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

/** Wert eines statischen String-Ausdrucks ('…', "…", `…` ohne Interpolation). */
export function stringValue(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) return undefined;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return undefined;
}

/** Einfacher Tag-Name eines JSX-Elements (nur Identifier, kein `Foo.Bar`). */
export function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string | undefined {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return ts.isIdentifier(tag) ? tag.text : undefined;
}

/** Attribut-Ausdruck eines JSX-Elements: `name="…"` oder `name={…}`. */
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
 * Boolesches JSX-Attribut: `name` (ohne Wert) und `name={true}` ⇒ true;
 * `name={false}`, andere Ausdrücke oder fehlendes Attribut ⇒ false.
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
 * Sichtbarer Text eines JSX-Elements, wenn er statisch eindeutig ist:
 * genau ein nicht-leeres JsxText-Kind — der Kanten-`label`-Kandidat.
 */
export function jsxSingleTextChild(node: ts.JsxElement | ts.JsxSelfClosingElement): string | undefined {
  if (!ts.isJsxElement(node)) return undefined;
  const texts: string[] = [];
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      const trimmed = child.text.trim();
      if (trimmed !== '') texts.push(trimmed);
    } else {
      // Ausdrucks-/Element-Kinder ⇒ Text nicht statisch eindeutig.
      return undefined;
    }
  }
  return texts.length === 1 ? texts[0] : undefined;
}

/**
 * Komponenten-Name aus einem `element={…}`-Ausdruck: Tag des JSX-Elements;
 * hat das Element genau ein JSX-Element-Kind (Wrapper wie `<Suspense>`),
 * wird das Kind bevorzugt (analog zur `child:`-Präferenz im Dart-Adapter).
 */
export function componentNameFromElement(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) return undefined;
  let node: ts.Expression = expr;
  if (ts.isParenthesizedExpression(node)) node = node.expression;
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
    // `Component={X}` — direkte Referenz auf die Komponente.
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

/** Komponenten heißen per Konvention mit Großbuchstaben. */
export function isComponentName(name: string): boolean {
  return name.length > 0 && name[0] === name[0]!.toUpperCase();
}

/** Rekursiver Besuch aller Knoten einer Datei. */
export function visit(root: ts.Node, callback: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    callback(node);
    node.forEachChild(walk);
  };
  walk(root);
}

/** Name der umschließenden Top-Level-Komponente eines Knotens (best effort). */
export function enclosingComponentName(file: ScannedFile, node: ts.Node): string | undefined {
  const declarations = componentDeclarations(file.sourceFile);
  return enclosingComponent(declarations, node.getStart(file.sourceFile))?.name;
}

export interface RedirectScan {
  /** Enthält der Teilbaum überhaupt einen redirect(...)-Aufruf? */
  hasRedirectCall: boolean;
  /** String-Literale der ersten Argumente aller redirect(...)-Aufrufe. */
  targets: string[];
}

/** Sucht `redirect(...)`/`permanentRedirect(...)`-Aufrufe und deren literale Ziele. */
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
