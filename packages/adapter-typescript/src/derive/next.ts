/**
 * Weg C — Ableitung aus Next.js-Projekten (dateibasiertes Routing).
 *
 *   app/…/page.*   bzw. pages/**       → Screen-Node
 *   Routen-Gruppe (name)/ im App-Router   → Flow (analog ShellRoute)
 *   redirect('…') in einer page-Datei     → Decision-Node
 *   <Link href>/router.push('…')          → Transition
 *
 * Alles best effort, `source: "derived"`; manuelle Annotationen überschreiben
 * abgeleitete Werte feldweise.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { SourceKind, type GraphEdge, type GraphFlow, type GraphNode } from '../graph-model.js';
import type { ScannedFile } from '../scanner.js';
import {
  collectRedirectTargets,
  enclosingComponentName,
  humanize,
  isComponentName,
  jsxAttributeExpression,
  jsxSingleTextChild,
  jsxTagName,
  slugFromPath,
  stringValue,
  visit,
} from './shared.js';

const EXT = String.raw`\.(?:tsx|ts|jsx|js|mjs|cjs|mts|cts)$`;
const APP_PAGE = new RegExp(String.raw`^(?:src/)?app/(?:(.+)/)?page${EXT}`);
const PAGES_FILE = new RegExp(String.raw`^(?:src/)?pages/(.+)${EXT}`);

/** Importiert eine Datei aus `next` oder `next/…`? */
function importsNext(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    const specifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (specifier !== undefined && ts.isStringLiteral(specifier)) {
      if (specifier.text === 'next' || specifier.text.startsWith('next/')) return true;
    }
  }
  return false;
}

/**
 * Next-Evidenz des Projekts: `next`-Dependency in der package.json, eine
 * next.config.*, oder ein Import aus `next`/`next/…` in den gescannten
 * Quellen. Ohne Evidenz werden KEINE Pages-Router-Screens abgeleitet —
 * `(src/)pages/` ist auch in react-router-Projekten eine verbreitete
 * Ordner-Konvention und würde sonst Phantom-Screens erzeugen. Der App-Router
 * (`app/…/page.*`) ist als Konvention eindeutig und braucht keine Evidenz.
 */
function hasNextEvidence(projectDir: string | undefined, files: readonly ScannedFile[]): boolean {
  if (projectDir !== undefined) {
    for (const config of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
      if (existsSync(join(projectDir, config))) return true;
    }
    try {
      const pkg: unknown = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
      if (pkg !== null && typeof pkg === 'object') {
        for (const key of ['dependencies', 'devDependencies']) {
          const section = (pkg as Record<string, unknown>)[key];
          if (section !== null && typeof section === 'object' && 'next' in section) return true;
        }
      }
    } catch {
      // Keine/kaputte package.json ⇒ zählt nicht als Evidenz.
    }
  }
  return files.some((file) => importsNext(file.sourceFile));
}

export class NextDerivation {
  readonly nodes: GraphNode[] = [];
  readonly flows: GraphFlow[] = [];
  readonly edges: GraphEdge[] = [];

  /** Default-Export-Komponente einer page-Datei → Screen-Id. */
  readonly componentToScreen = new Map<string, string>();
  readonly pathToScreen = new Map<string, string>();
  /** page-Datei (relPath) → Screen-Id, für die from-Zuordnung innerhalb der Datei. */
  readonly pageFileToScreen = new Map<string, string>();

  /** Mindestens eine page-Datei gefunden? Sonst entfällt die Kanten-Analyse. */
  hasRoutes = false;
}

interface PageRoute {
  file: ScannedFile;
  /** URL-Pfad, Parameter-Segmente ([id]) bleiben im Schlüssel erhalten. */
  urlPath: string;
  /** Innerste Routen-Gruppe `(name)` — wird zum Flow. */
  group?: string;
}

/** App-Router: Segmente zwischen app/ und page.* → URL-Pfad + Gruppe. */
function appRoute(file: ScannedFile): PageRoute | undefined {
  const match = APP_PAGE.exec(file.relPath);
  if (match === null) return undefined;
  const rawSegments = match[1] === undefined ? [] : match[1].split('/');
  const segments: string[] = [];
  let group: string | undefined;
  for (const segment of rawSegments) {
    if (segment.startsWith('(') && segment.endsWith(')')) {
      // Routen-Gruppe: unsichtbar in der URL, innerste Gruppe wird zum Flow.
      group = segment.slice(1, -1);
      continue;
    }
    // Intercepting Routes ((.)foo), Parallel Routes (@slot) und private
    // Ordner (_name) sind keine eigenständigen Ziele — Datei überspringen.
    if (segment.startsWith('(') || segment.startsWith('@') || segment.startsWith('_')) {
      return undefined;
    }
    segments.push(segment);
  }
  const urlPath = `/${segments.join('/')}`;
  return { file, urlPath: urlPath === '/' ? '/' : urlPath, ...(group !== undefined ? { group } : {}) };
}

/** Pages-Router: Dateipfad → URL-Pfad; _app/_document/_error und api/ entfallen. */
function pagesRoute(file: ScannedFile): PageRoute | undefined {
  const match = PAGES_FILE.exec(file.relPath);
  if (match === null) return undefined;
  let rest = match[1]!;
  if (rest === 'api' || rest.startsWith('api/')) return undefined;
  const lastSegment = rest.split('/').at(-1)!;
  if (lastSegment.startsWith('_')) return undefined;
  if (rest === 'index') rest = '';
  else if (rest.endsWith('/index')) rest = rest.slice(0, -'/index'.length);
  return { file, urlPath: `/${rest}` };
}

/** Name der Default-Export-Komponente einer Datei (best effort). */
function defaultExportName(sourceFile: ts.SourceFile): string | undefined {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true
    ) {
      return statement.name.text;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expr = statement.expression;
      if (ts.isIdentifier(expr) && isComponentName(expr.text)) return expr.text;
      // export default memo(Home) — erstes Komponenten-Argument.
      if (ts.isCallExpression(expr)) {
        for (const arg of expr.arguments) {
          if (ts.isIdentifier(arg) && isComponentName(arg.text)) return arg.text;
        }
      }
    }
  }
  return undefined;
}

/**
 * Leitet Screens (page-Dateien), Flows (Routen-Gruppen), Redirect-Decisions
 * und Navigations-Kanten aus einem Next.js-Projekt ab.
 */
export function deriveNext(
  files: readonly ScannedFile[],
  warn: (message: string) => void,
  opts: {
    manualScreenSymbols?: ReadonlyMap<string, string>;
    extraComponentToScreen?: ReadonlyMap<string, string>;
    /** Projektverzeichnis für die Next-Evidenz (package.json, next.config.*). */
    projectDir?: string;
  } = {},
): NextDerivation {
  const result = new NextDerivation();

  // Pass 1 — Screens aus page-Dateien; Dateien sind nach Pfad sortiert.
  // Pages-Router nur mit Next-Evidenz (siehe hasNextEvidence).
  const pagesRouterActive = hasNextEvidence(opts.projectDir, files);
  const routes: PageRoute[] = [];
  for (const file of files) {
    const route = appRoute(file) ?? (pagesRouterActive ? pagesRoute(file) : undefined);
    if (route !== undefined) routes.push(route);
  }

  const flowStart = new Map<string, string>();
  const flowRef = new Map<string, PageRoute>();
  for (const route of routes) {
    result.hasRoutes = true;
    const id = slugFromPath(route.urlPath);
    result.nodes.push({
      id,
      type: 'screen',
      title: humanize(id),
      ...(route.group !== undefined ? { flow: route.group } : {}),
      tags: [],
      source: SourceKind.derived,
      sourceRef: route.file.refAt(0, route.urlPath),
    });
    if (!result.pathToScreen.has(route.urlPath)) result.pathToScreen.set(route.urlPath, id);
    result.pageFileToScreen.set(route.file.relPath, id);

    const componentName = defaultExportName(route.file.sourceFile);
    if (componentName !== undefined && !result.componentToScreen.has(componentName)) {
      result.componentToScreen.set(componentName, id);
    }

    if (route.group !== undefined) {
      if (!flowStart.has(route.group)) {
        flowStart.set(route.group, id);
        flowRef.set(route.group, route);
      }
    }
  }
  for (const [group, start] of flowStart) {
    result.flows.push({
      id: group,
      title: humanize(group),
      start,
      source: SourceKind.derived,
      sourceRef: flowRef.get(group)!.file.refAt(0),
    });
  }

  if (!result.hasRoutes) return result;

  const componentToScreen = (name: string): string | undefined =>
    opts.manualScreenSymbols?.get(name) ??
    opts.extraComponentToScreen?.get(name) ??
    result.componentToScreen.get(name);

  const lookupPath = (literal: string): string | undefined =>
    result.pathToScreen.get(literal.split('?')[0]!.split('#')[0]!);

  // Pass 2a — Redirect-Decisions: redirect('…') innerhalb einer page-Datei.
  for (const route of routes) {
    if (!route.file.content.includes('next/navigation')) continue;
    const { hasRedirectCall, targets } = collectRedirectTargets(route.file.sourceFile);
    if (!hasRedirectCall) continue;
    const screenId = result.pageFileToScreen.get(route.file.relPath)!;
    const decisionId = `${screenId}_redirect`;
    const ref = route.file.refAt(0);
    result.nodes.push({
      id: decisionId,
      type: 'decision',
      title: `Weiterleitung: ${humanize(screenId)}`,
      tags: [],
      source: SourceKind.derived,
      sourceRef: ref,
    });
    result.edges.push({
      from: decisionId,
      to: screenId,
      trigger: 'auto',
      source: SourceKind.derived,
      sourceRef: ref,
    });
    const seenTargets = new Set<string>();
    for (const value of targets) {
      const target = lookupPath(value);
      if (target === undefined || target === screenId) continue;
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

  // Pass 2b — Navigation: <Link href> und router.push/replace('…').
  const addNavEdge = (
    file: ScannedFile,
    node: ts.Node,
    what: string,
    literal: string,
    label: string | undefined,
  ): void => {
    const where = `${file.relPath}:${file.lineOf(node.getStart(file.sourceFile))}`;
    const to = lookupPath(literal);
    if (to === undefined) {
      warn(`Hinweis: ${where}: ${what}("${literal}") entspricht keiner bekannten Route — Kante verworfen.`);
      return;
    }
    const enclosing = enclosingComponentName(file, node);
    const from =
      (enclosing !== undefined ? componentToScreen(enclosing) : undefined) ??
      result.pageFileToScreen.get(file.relPath);
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
      trigger: 'tap',
      ...(label !== undefined ? { label } : {}),
      source: SourceKind.derived,
      sourceRef: file.refAt(node.getStart(file.sourceFile), enclosing),
    });
  };

  for (const file of files) {
    const usesRouterHook = file.content.includes('useRouter');
    visit(file.sourceFile, (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (jsxTagName(node) !== 'Link') return;
        const href = stringValue(jsxAttributeExpression(node, 'href'));
        if (href !== undefined) addNavEdge(file, node, '<Link href>', href, jsxSingleTextChild(node));
        return;
      }
      // router.push('/pfad') — nur wenn die Datei useRouter verwendet.
      if (usesRouterHook && ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'router' &&
          ts.isIdentifier(callee.name) &&
          (callee.name.text === 'push' || callee.name.text === 'replace')
        ) {
          const literal = stringValue(node.arguments[0]);
          if (literal !== undefined) {
            addNavEdge(file, node, `router.${callee.name.text}`, literal, undefined);
          }
        }
      }
    });
  }

  return result;
}
