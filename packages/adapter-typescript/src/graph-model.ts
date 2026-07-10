/**
 * Internes Graph-Modell des TypeScript-Adapters + kanonische Serialisierung
 * in das Journey-Graph-JSON — Semantik-Spiegel von
 * dart/ductus/lib/src/adapter/graph_model.dart.
 */

import { SCHEMA_VERSION } from '@ductus/schema';

/**
 * Muss mit "version" in package.json übereinstimmen — abgesichert durch
 * einen Regressionstest in test/cli.test.ts.
 */
export const adapterVersion = '0.1.0';

export const schemaVersion = SCHEMA_VERSION;

/** meta.adapters-Name des Adapter-CLI. */
export const cliAdapterName = 'typescript';

/** Herkunft eines Graph-Elements: manuell annotiert oder abgeleitet. */
export const SourceKind = {
  annotation: 'annotation',
  derived: 'derived',
} as const;

export type SourceKindValue = (typeof SourceKind)[keyof typeof SourceKind];

/** Gültige Trigger-Werte einer Transition (entspricht `TriggerType`). */
export const validTriggers = new Set(['tap', 'submit', 'auto', 'back', 'deeplink', 'system']);

/**
 * Rückverweis in den Quellcode. `file` ist immer projekt-relativ
 * mit '/'-Separatoren.
 */
export interface SourceRef {
  file: string;
  line: number;
  symbol?: string;
}

export function refToString(ref: SourceRef): string {
  return `${ref.file}:${ref.line}`;
}

/**
 * Screen- oder Decision-Node (der Adapter emittiert keine Action-Nodes;
 * Actions werden direkt als Edges abgebildet).
 */
export interface GraphNode {
  id: string;
  type: 'screen' | 'decision';
  title?: string;
  flow?: string;
  description?: string;
  tags: string[];
  source: SourceKindValue;
  sourceRef: SourceRef;
}

/** Transition (Edge). `id` ist bis zur Id-Generierung im Merger optional. */
export interface GraphEdge {
  id?: string;
  from: string;
  to: string;
  trigger?: string;
  label?: string;
  condition?: string;
  source: SourceKindValue;
  sourceRef: SourceRef;
}

/**
 * Benannter Flow. `source`/`sourceRef` sind nur intern für die
 * Merge-Präzedenz relevant und werden nicht serialisiert.
 */
export interface GraphFlow {
  id: string;
  title?: string;
  start?: string;
  description?: string;
  source: SourceKindValue;
  sourceRef: SourceRef;
}

/** Fehler, der den Adapter mit Exit ≠0 beendet; `messages` gehen auf stderr. */
export class AdapterException extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join('\n'));
    this.name = 'AdapterException';
    this.messages = messages;
  }
}

function nodeToJson(node: GraphNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    ...(node.title !== undefined ? { title: node.title } : {}),
    ...(node.flow !== undefined ? { flow: node.flow } : {}),
    ...(node.description !== undefined ? { description: node.description } : {}),
    ...(node.tags.length > 0 ? { tags: [...node.tags].sort() } : {}),
    source: node.source,
    sourceRef: refToJson(node.sourceRef),
  };
}

function edgeToJson(edge: GraphEdge): Record<string, unknown> {
  return {
    id: edge.id!,
    from: edge.from,
    to: edge.to,
    ...(edge.trigger !== undefined ? { trigger: edge.trigger } : {}),
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(edge.condition !== undefined ? { condition: edge.condition } : {}),
    source: edge.source,
    sourceRef: refToJson(edge.sourceRef),
  };
}

function flowToJson(flow: GraphFlow): Record<string, unknown> {
  return {
    id: flow.id,
    ...(flow.title !== undefined ? { title: flow.title } : {}),
    ...(flow.start !== undefined ? { start: flow.start } : {}),
    ...(flow.description !== undefined ? { description: flow.description } : {}),
  };
}

function refToJson(ref: SourceRef): Record<string, unknown> {
  return {
    file: ref.file,
    line: ref.line,
    ...(ref.symbol !== undefined ? { symbol: ref.symbol } : {}),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Kanonisches, diff-stabiles Graph-JSON: rekursiv sortierte Schlüssel,
 * 2-Space-Indent, LF, abschließender Zeilenumbruch, kein `generatedAt` —
 * byte-stabil über wiederholte Läufe (NFR2).
 */
export function encodeCanonicalGraph(input: {
  flows: GraphFlow[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}): string {
  const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const graph = {
    schemaVersion,
    flows: [...input.flows].sort((a, b) => byId(a.id, b.id)).map(flowToJson),
    nodes: [...input.nodes].sort((a, b) => byId(a.id, b.id)).map(nodeToJson),
    edges: [...input.edges].sort((a, b) => byId(a.id!, b.id!)).map(edgeToJson),
    meta: {
      adapters: [{ name: cliAdapterName, version: adapterVersion }],
    },
  };
  return `${JSON.stringify(canonicalize(graph), null, 2)}\n`;
}
