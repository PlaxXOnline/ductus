/**
 * Internal graph model of the TypeScript adapter + canonical serialization
 * into the journey graph JSON — semantic mirror of
 * dart/ductus/lib/src/adapter/graph_model.dart.
 */

import { createRequire } from 'node:module';
import { SCHEMA_VERSION } from '@ductus/schema';

/**
 * Adapter version from the package's own package.json — read at runtime so
 * that changesets version bumps cannot orphan a constant (the Dart adapter
 * needs a manually maintained constant plus a regression test for this;
 * here the test in test/cli.test.ts only guards the read path).
 */
export const adapterVersion: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

export const schemaVersion = SCHEMA_VERSION;

/** meta.adapters name of the adapter CLI. */
export const cliAdapterName = 'typescript';

/** Origin of a graph element: manually annotated or derived. */
export const SourceKind = {
  annotation: 'annotation',
  derived: 'derived',
} as const;

export type SourceKindValue = (typeof SourceKind)[keyof typeof SourceKind];

/** Valid trigger values of a transition (matches `TriggerType`). */
export const validTriggers = new Set(['tap', 'submit', 'auto', 'back', 'deeplink', 'system']);

/**
 * Back-reference into the source code. `file` is always project-relative
 * with '/' separators.
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
 * Screen or decision node (the adapter emits no action nodes; actions are
 * mapped directly to edges).
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

/** Transition (edge). `id` is optional until id generation in the merger. */
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
 * Named flow. `source`/`sourceRef` are only relevant internally for merge
 * precedence and are not serialized.
 */
export interface GraphFlow {
  id: string;
  title?: string;
  start?: string;
  description?: string;
  source: SourceKindValue;
  sourceRef: SourceRef;
}

/** Error that terminates the adapter with exit ≠0; `messages` go to stderr. */
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
 * Canonical, diff-stable graph JSON: recursively sorted keys, 2-space
 * indent, LF, trailing newline, no `generatedAt` — byte-stable across
 * repeated runs (NFR2).
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
