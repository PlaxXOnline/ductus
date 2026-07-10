/**
 * Orchestrierung des Adapters: Scan → Weg A (Kommentare) → Weg C
 * (Ableitungen) → from-Inferenz → Merge → kanonisches JSON. Spiegel von
 * dart/ductus/lib/src/adapter/runner.dart.
 */

import type { ActionCandidate } from './candidates.js';
import { parseComments } from './comment-parser.js';
import type { AdapterConfig } from './config.js';
import { deriveNext, type NextDerivation } from './derive/next.js';
import { deriveReactRouter, type ReactRouterDerivation } from './derive/react-router.js';
import {
  AdapterException,
  encodeCanonicalGraph,
  refToString,
  SourceKind,
  type GraphEdge,
  type GraphFlow,
  type GraphNode,
} from './graph-model.js';
import { mergeGraph } from './merger.js';
import { scanProject } from './scanner.js';

export interface RunAdapterOptions {
  projectDir: string;
  config: AdapterConfig;
  warn: (message: string) => void;
}

/**
 * Führt den kompletten Adapter-Lauf aus und liefert das kanonische
 * Graph-JSON. Fatale Probleme (Pflichtfelder, nicht auflösbares `from`,
 * Merge-Konflikte) werfen gebündelt eine [AdapterException].
 */
export function runAdapter(opts: RunAdapterOptions): string {
  const { projectDir, config, warn } = opts;
  const files = scanProject(projectDir, config, warn);

  const errors: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const flows: GraphFlow[] = [];
  const actions: ActionCandidate[] = [];
  /** Komponenten-Name → Screen-Id über alle Dateien (first-wins). */
  const manualScreenSymbols = new Map<string, string>();

  // Weg A — Kommentar-Konvention.
  for (const file of files) {
    const extraction = parseComments(file, warn, errors);
    nodes.push(...extraction.nodes);
    flows.push(...extraction.flows);
    actions.push(...extraction.actions);
    for (const [symbol, id] of extraction.screenSymbols) {
      if (!manualScreenSymbols.has(symbol)) manualScreenSymbols.set(symbol, id);
    }
  }

  // Weg C — Ableitungen. Next zuerst: seine Tabellen fließen in die
  // react-router-Ableitung ein (wie auto_route → go_router im Dart-Adapter).
  let next: NextDerivation | undefined;
  if (config.deriveNext) {
    next = deriveNext(files, warn, { manualScreenSymbols, projectDir });
    nodes.push(...next.nodes);
    flows.push(...next.flows);
    edges.push(...next.edges);
  }
  let reactRouter: ReactRouterDerivation | undefined;
  if (config.deriveReactRouter) {
    reactRouter = deriveReactRouter(files, warn, {
      manualScreenSymbols,
      ...(next !== undefined
        ? { extraComponentToScreen: next.componentToScreen, extraPathToScreen: next.pathToScreen }
        : {}),
    });
    nodes.push(...reactRouter.nodes);
    flows.push(...reactRouter.flows);
    edges.push(...reactRouter.edges);
  }

  // from-Inferenz für Actions ohne explizites from: umschließende Komponente
  // in manuellen Screens, dann in den Ableitungs-Tabellen suchen.
  for (const action of actions) {
    let from = action.from;
    if (from === undefined) {
      const name = action.enclosingName;
      // react-routers element-Zuordnung ist präziser als die Next-Heuristik.
      from =
        name === undefined
          ? undefined
          : (manualScreenSymbols.get(name) ??
            reactRouter?.componentToScreen.get(name) ??
            next?.componentToScreen.get(name));
      if (from === undefined) {
        errors.push(
          `${refToString(action.sourceRef)}: Action "${action.label}" ohne "from" — ` +
            `umschließende Komponente ${name ?? '(keine)'} ist kein bekannter Screen.`,
        );
        continue;
      }
    }
    edges.push({
      ...(action.id !== undefined ? { id: action.id } : {}),
      from,
      to: action.to,
      trigger: action.trigger,
      label: action.label,
      ...(action.condition !== undefined ? { condition: action.condition } : {}),
      source: SourceKind.annotation,
      sourceRef: action.sourceRef,
    });
  }

  if (errors.length > 0) {
    throw new AdapterException(errors);
  }

  const merged = mergeGraph({ nodes, edges, flows });
  return encodeCanonicalGraph(merged);
}
