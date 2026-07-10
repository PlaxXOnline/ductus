/**
 * Weg C — Ableitung aus react-router-Konfigurationen (Datenrouter-Objekte
 * und `<Route>`-JSX). Architektur-Spiegel von derive_go_router.dart:
 *
 *   Route mit Pfad     → Screen-Node        (GoRoute)
 *   Pfadlose Layout-Route mit Kindern → Flow (ShellRoute)
 *   loader mit redirect('…') → Decision-Node (redirect:)
 *   <Link to>/<NavLink to>/navigate('…')    → Transition (context.go/push)
 *   <Navigate to>      → auto-Transition
 *
 * Alles best effort, `source: "derived"`; manuelle Annotationen überschreiben
 * abgeleitete Werte feldweise.
 */

import ts from 'typescript';
import { SourceKind, type GraphEdge, type GraphFlow, type GraphNode } from '../graph-model.js';
import type { ScannedFile } from '../scanner.js';
import {
  collectRedirectTargets,
  componentNameFromElement,
  enclosingComponentName,
  humanize,
  joinPaths,
  jsxBooleanAttribute,
  jsxAttributeExpression,
  jsxSingleTextChild,
  jsxTagName,
  slugFromPath,
  stringValue,
  visit,
} from './shared.js';

const ROUTER_FACTORIES = new Set([
  'createBrowserRouter',
  'createHashRouter',
  'createMemoryRouter',
  'useRoutes',
]);

export class ReactRouterDerivation {
  readonly nodes: GraphNode[] = [];
  readonly flows: GraphFlow[] = [];
  readonly edges: GraphEdge[] = [];

  /** Komponente (aus element:/Component:) → Screen-Id. */
  readonly componentToScreen = new Map<string, string>();
  readonly pathToScreen = new Map<string, string>();

  /** Mindestens eine Route gefunden? Sonst entfällt die Kanten-Analyse. */
  hasRoutes = false;
}

/** Einheitliche Sicht auf eine Route: Objekt-Literal oder `<Route>`-JSX. */
interface RouteView {
  node: ts.Node;
  path?: string;
  /** Explizite Routen-Id (`id:`-Property) — gewinnt über den Pfad-Slug. */
  routeId?: string;
  index: boolean;
  /** true, wenn path/id vorhanden, aber nicht statisch lesbar. */
  dynamic: boolean;
  elementExpr?: ts.Expression;
  loader?: ts.Node;
  children: RouteView[];
}

function objectProperty(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === name
    ) {
      return prop.initializer;
    }
  }
  return undefined;
}

/** Entfernt Klammern sowie `as`-/`satisfies`-Hüllen um einen Ausdruck. */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  let node = expr;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Löst das Routen-Argument einer Router-Factory auf: Inline-Array-Literal
 * oder eine in derselben Datei deklarierte Konstante mit Array-Initializer
 * (`const routes = […]; createBrowserRouter(routes)`).
 */
function resolveRouteArray(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.ArrayLiteralExpression | undefined {
  const node = unwrapExpression(expr);
  if (ts.isArrayLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === node.text &&
        decl.initializer !== undefined
      ) {
        const initializer = unwrapExpression(decl.initializer);
        if (ts.isArrayLiteralExpression(initializer)) return initializer;
      }
    }
  }
  return undefined;
}

/** Löst einen loader-Ausdruck auf: Inline-Funktion oder Funktion derselben Datei. */
function resolveLoader(expr: ts.Expression, sourceFile: ts.SourceFile): ts.Node | undefined {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr;
  if (!ts.isIdentifier(expr)) return undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === expr.text) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === expr.text &&
          decl.initializer !== undefined &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          return decl.initializer;
        }
      }
    }
  }
  return undefined;
}

function routeViewFromObject(obj: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): RouteView {
  const pathExpr = objectProperty(obj, 'path');
  const idExpr = objectProperty(obj, 'id');
  const path = stringValue(pathExpr);
  const routeId = stringValue(idExpr);
  const indexExpr = objectProperty(obj, 'index');
  const loaderExpr = objectProperty(obj, 'loader');
  const children: RouteView[] = [];
  const childrenExpr = objectProperty(obj, 'children');
  if (childrenExpr !== undefined && ts.isArrayLiteralExpression(childrenExpr)) {
    for (const element of childrenExpr.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        children.push(routeViewFromObject(element, sourceFile));
      }
    }
  }
  const loader = loaderExpr !== undefined ? resolveLoader(loaderExpr, sourceFile) : undefined;
  const elementExpr = objectProperty(obj, 'element') ?? objectProperty(obj, 'Component');
  return {
    node: obj,
    ...(path !== undefined ? { path } : {}),
    ...(routeId !== undefined ? { routeId } : {}),
    index: indexExpr !== undefined && indexExpr.kind === ts.SyntaxKind.TrueKeyword,
    dynamic:
      (pathExpr !== undefined && path === undefined) ||
      (idExpr !== undefined && routeId === undefined),
    ...(elementExpr !== undefined ? { elementExpr } : {}),
    ...(loader !== undefined ? { loader } : {}),
    children,
  };
}

function routeViewFromJsx(
  el: ts.JsxElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): RouteView {
  const pathExpr = jsxAttributeExpression(el, 'path');
  const idExpr = jsxAttributeExpression(el, 'id');
  const path = stringValue(pathExpr);
  const routeId = stringValue(idExpr);
  const loaderExpr = jsxAttributeExpression(el, 'loader');
  const children: RouteView[] = [];
  if (ts.isJsxElement(el)) {
    for (const child of el.children) {
      if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && jsxTagName(child) === 'Route') {
        children.push(routeViewFromJsx(child, sourceFile));
      }
    }
  }
  const elementExpr = jsxAttributeExpression(el, 'element') ?? jsxAttributeExpression(el, 'Component');
  const loader = loaderExpr !== undefined ? resolveLoader(loaderExpr, sourceFile) : undefined;
  return {
    node: el,
    ...(path !== undefined ? { path } : {}),
    ...(routeId !== undefined ? { routeId } : {}),
    index: jsxBooleanAttribute(el, 'index'),
    dynamic:
      (pathExpr !== undefined && path === undefined) ||
      (idExpr !== undefined && routeId === undefined),
    ...(elementExpr !== undefined ? { elementExpr } : {}),
    ...(loader !== undefined ? { loader } : {}),
    children,
  };
}

interface PendingRedirect {
  screenId: string;
  screenTitle: string;
  body: ts.Node;
  file: ScannedFile;
}

/**
 * Leitet Screens, Flows (pfadlose Layout-Routen), Redirect-Decisions und
 * Navigations-Kanten aus react-router-Konfigurationen ab.
 *
 * [manualScreenSymbols] (Weg A) und [extraComponentToScreen] (z. B. Next-
 * Ableitung) fließen in die from-Zuordnung der Nav-Kanten ein,
 * [extraPathToScreen] in die Pfad-Zuordnung.
 */
export function deriveReactRouter(
  files: readonly ScannedFile[],
  warn: (message: string) => void,
  opts: {
    manualScreenSymbols?: ReadonlyMap<string, string>;
    extraComponentToScreen?: ReadonlyMap<string, string>;
    extraPathToScreen?: ReadonlyMap<string, string>;
  } = {},
): ReactRouterDerivation {
  const result = new ReactRouterDerivation();
  for (const [path, id] of opts.extraPathToScreen ?? []) result.pathToScreen.set(path, id);
  const pendingRedirects: PendingRedirect[] = [];
  let shellIndex = 0;

  // Pass 1 — Routenbäume: Screens, Flows, element-Zuordnung, Pfadtabelle.
  // Dateien sind nach Pfad sortiert, im Dokument nach Offset.
  for (const file of files) {
    const visited = new Set<ts.Node>();

    const processRoute = (
      route: RouteView,
      parentPath: string,
      flowId: string | undefined,
      flowStart: { value: string | undefined } | undefined,
    ): void => {
      visited.add(route.node);
      result.hasRoutes = true;

      let childFlowId = flowId;
      let childFlowStart = flowStart;
      let childParentPath = parentPath;

      const isShell =
        route.path === undefined && route.routeId === undefined && !route.index &&
        !route.dynamic && route.children.length > 0;

      if (isShell) {
        // Pfadlose Layout-Route mit Kindern ≙ ShellRoute ⇒ Flow.
        childFlowId = `shell-${shellIndex}`;
        shellIndex++;
        childFlowStart = { value: undefined };
      } else if (route.path === undefined && route.routeId === undefined && !route.index) {
        warn(
          `Hinweis: ${file.relPath}:${file.lineOf(route.node.getStart(file.sourceFile))}: ` +
            'Route ohne literalen path — übersprungen.',
        );
      } else {
        // Id aus dem gejointen Vollpfad bilden — der relative Pfad allein
        // würde verschachtelte Routen mit gleichem Segment (z. B. 'detail'
        // unter '/user' und '/admin') stillschweigend kollabieren lassen.
        const fullPath = route.index
          ? (parentPath === '' ? '/' : parentPath)
          : route.path !== undefined
            ? joinPaths(parentPath, route.path)
            : undefined;
        const id = route.routeId ?? slugFromPath(fullPath!);
        result.nodes.push({
          id,
          type: 'screen',
          title: humanize(id),
          ...(flowId !== undefined ? { flow: flowId } : {}),
          tags: [],
          source: SourceKind.derived,
          sourceRef: file.refAt(route.node.getStart(file.sourceFile), route.routeId ?? route.path ?? fullPath),
        });
        if (flowStart !== undefined && flowStart.value === undefined) flowStart.value = id;
        if (fullPath !== undefined) {
          childParentPath = fullPath;
          if (!result.pathToScreen.has(fullPath)) result.pathToScreen.set(fullPath, id);
        }

        const componentName = componentNameFromElement(route.elementExpr);
        if (componentName !== undefined && !result.componentToScreen.has(componentName)) {
          result.componentToScreen.set(componentName, id);
        }

        if (route.loader !== undefined) {
          pendingRedirects.push({ screenId: id, screenTitle: humanize(id), body: route.loader, file });
        }
      }

      for (const child of route.children) {
        processRoute(child, childParentPath, childFlowId, childFlowStart);
      }

      if (isShell) {
        const start = childFlowStart!.value;
        if (start === undefined) {
          warn(
            `Hinweis: ${file.relPath}:${file.lineOf(route.node.getStart(file.sourceFile))}: ` +
              `Layout-Route ohne Kind-Screens — Flow "${childFlowId}" entfällt.`,
          );
        } else {
          result.flows.push({
            id: childFlowId!,
            title: humanize(childFlowId!),
            start,
            source: SourceKind.derived,
            sourceRef: file.refAt(route.node.getStart(file.sourceFile)),
          });
        }
      }
    };

    // Datenrouter: createBrowserRouter([...]) / useRoutes([...]) u. Ä. —
    // auch mit Routen-Konstante derselben Datei (createBrowserRouter(routes)).
    visit(file.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = node.expression;
      if (!ts.isIdentifier(callee) || !ROUTER_FACTORIES.has(callee.text)) return;
      const first = node.arguments[0];
      if (first === undefined) return;
      const routeArray = resolveRouteArray(first, file.sourceFile);
      if (routeArray === undefined) return;
      for (const element of routeArray.elements) {
        const route = unwrapExpression(element as ts.Expression);
        if (ts.isObjectLiteralExpression(route) && !visited.has(route)) {
          processRoute(routeViewFromObject(route, file.sourceFile), '', undefined, undefined);
        }
      }
    });

    // JSX-Routen: <Route …> überall (deckt auch createRoutesFromElements ab).
    visit(file.sourceFile, (node) => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return;
      if (jsxTagName(node) !== 'Route' || visited.has(node)) return;
      processRoute(routeViewFromJsx(node, file.sourceFile), '', undefined, undefined);
    });
  }

  // Pass 2a — Redirect-Decisions (jetzt sind alle Routen-Pfade bekannt).
  // Anders als go_routers dediziertes redirect: ist ein react-router-loader
  // meist Datenbeschaffung — eine Decision entsteht nur, wenn er nachweislich
  // redirect(...) aufruft.
  for (const pending of pendingRedirects) {
    const { hasRedirectCall, targets } = collectRedirectTargets(pending.body);
    if (!hasRedirectCall) continue;
    const decisionId = `${pending.screenId}_redirect`;
    const ref = pending.file.refAt(pending.body.getStart(pending.file.sourceFile));
    result.nodes.push({
      id: decisionId,
      type: 'decision',
      title: `Weiterleitung: ${pending.screenTitle}`,
      tags: [],
      source: SourceKind.derived,
      sourceRef: ref,
    });
    result.edges.push({
      from: decisionId,
      to: pending.screenId,
      trigger: 'auto',
      source: SourceKind.derived,
      sourceRef: ref,
    });

    const seenTargets = new Set<string>();
    for (const value of targets) {
      const target = result.pathToScreen.get(value.split('?')[0]!.split('#')[0]!);
      if (target === undefined || target === pending.screenId) continue;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      result.edges.push({
        from: decisionId,
        to: target,
        trigger: 'auto',
        condition: 'redirect',
        source: SourceKind.derived,
        sourceRef: ref,
      });
    }
  }

  // Pass 2b — Navigation: <Link to>/<NavLink to>/<Navigate to>/navigate('…').
  // Ohne gefundene Routen entfällt die Analyse (nichts zuzuordnen).
  if (!result.hasRoutes) return result;

  // Die eigene element-Zuordnung ist präziser als die heuristische
  // extra-Tabelle (Next-Dateilayout) und gewinnt deshalb vor ihr.
  const componentToScreen = (name: string): string | undefined =>
    opts.manualScreenSymbols?.get(name) ??
    result.componentToScreen.get(name) ??
    opts.extraComponentToScreen?.get(name);

  const addNavEdge = (
    file: ScannedFile,
    node: ts.Node,
    what: string,
    literal: string,
    trigger: 'tap' | 'auto',
    label: string | undefined,
  ): void => {
    const where = `${file.relPath}:${file.lineOf(node.getStart(file.sourceFile))}`;
    const to = result.pathToScreen.get(literal.split('?')[0]!.split('#')[0]!);
    if (to === undefined) {
      warn(`Hinweis: ${where}: ${what}("${literal}") entspricht keiner bekannten Route — Kante verworfen.`);
      return;
    }
    const enclosing = enclosingComponentName(file, node);
    const from = enclosing === undefined ? undefined : componentToScreen(enclosing);
    if (from === undefined) {
      warn(
        `Hinweis: ${where}: ${what}("${literal}") keinem Screen zuordenbar ` +
          '(umschließende Komponente unbekannt) — Kante verworfen.',
      );
      return;
    }
    result.edges.push({
      from,
      to,
      trigger,
      ...(label !== undefined ? { label } : {}),
      source: SourceKind.derived,
      sourceRef: file.refAt(node.getStart(file.sourceFile), enclosing),
    });
  };

  for (const file of files) {
    const usesNavigateHook = file.content.includes('useNavigate');
    visit(file.sourceFile, (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node);
        if (tag === 'Link' || tag === 'NavLink') {
          const to = stringValue(jsxAttributeExpression(node, 'to'));
          if (to !== undefined) addNavEdge(file, node, `<${tag} to>`, to, 'tap', jsxSingleTextChild(node));
        } else if (tag === 'Navigate') {
          const to = stringValue(jsxAttributeExpression(node, 'to'));
          if (to !== undefined) addNavEdge(file, node, '<Navigate to>', to, 'auto', undefined);
        }
        return;
      }
      // navigate('/pfad') — nur wenn die Datei useNavigate verwendet, um
      // freie Funktionen gleichen Namens nicht fälschlich zu erfassen.
      if (usesNavigateHook && ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === 'navigate') {
          const literal = stringValue(node.arguments[0]);
          if (literal !== undefined) addNavEdge(file, node, 'navigate', literal, 'tap', undefined);
        }
      }
    });
  }

  return result;
}
