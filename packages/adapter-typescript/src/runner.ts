/**
 * Orchestration of the adapter: scan → path A (comments) → path C
 * (derivations) → `from` inference → merge → canonical JSON. Mirror of
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
 * Executes the complete adapter run and returns the canonical graph JSON.
 * Fatal problems (required fields, unresolvable `from`, merge conflicts)
 * throw a bundled [AdapterException].
 */
export function runAdapter(opts: RunAdapterOptions): string {
  const { projectDir, config, warn } = opts;
  const files = scanProject(projectDir, config, warn);

  const errors: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const flows: GraphFlow[] = [];
  const actions: ActionCandidate[] = [];
  /** Component name → screen id across all files (first wins). */
  const manualScreenSymbols = new Map<string, string>();

  // Path A — comment convention.
  for (const file of files) {
    const extraction = parseComments(file, warn, errors);
    nodes.push(...extraction.nodes);
    flows.push(...extraction.flows);
    actions.push(...extraction.actions);
    for (const [symbol, id] of extraction.screenSymbols) {
      if (!manualScreenSymbols.has(symbol)) manualScreenSymbols.set(symbol, id);
    }
  }

  // Path C — derivations. Next first: its tables feed into the react-router
  // derivation (like auto_route → go_router in the Dart adapter).
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

  // `from` inference for actions without an explicit from: look up the
  // enclosing component in manual screens, then in the derivation tables.
  for (const action of actions) {
    let from = action.from;
    if (from === undefined) {
      const name = action.enclosingName;
      // react-router's element mapping is more precise than the Next heuristic.
      from =
        name === undefined
          ? undefined
          : (manualScreenSymbols.get(name) ??
            reactRouter?.componentToScreen.get(name) ??
            next?.componentToScreen.get(name));
      if (from === undefined) {
        errors.push(
          `${refToString(action.sourceRef)}: action "${action.label}" without "from" — ` +
            `enclosing component ${name ?? '(none)'} is not a known screen.`,
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
