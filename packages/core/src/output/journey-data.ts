/**
 * Data contract ductus.data.json for the "journey" website generator.
 *
 * Builds the complete data object from a GenerateResult; in journey mode,
 * scaffoldWebsite writes it as the single data file into the site root and the
 * template reads it at build time. Everything is deterministic (NFR2): stable
 * sorting, LF, trailing newline, NO timestamps.
 */

import type { AdapterInfo, JourneyEdge, JourneyNode, SourceRef } from '@ductus/schema';
import type {
  GeneratedSegment,
  GenerateResult,
  JourneyWebsiteData,
  JourneyWebsiteEdge,
  JourneyWebsiteEntry,
  JourneyWebsiteNode,
} from '../contracts.js';
import { deriveMainPath } from './mermaid.js';
import { toSlug } from './slug.js';

/** Locale-independent string comparison (NFR2 — localeCompare would depend on the environment). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sourceRef with stable key order; missing values as null (JSON-stable). */
function toDataSourceRef(ref: SourceRef | undefined): SourceRef | null {
  if (ref === undefined) return null;
  return {
    file: ref.file,
    ...(ref.line !== undefined ? { line: ref.line } : {}),
    ...(ref.symbol !== undefined ? { symbol: ref.symbol } : {}),
  };
}

/**
 * Display title consistent with renderNode/journeyTaskLabel in mermaid.ts:
 * for type=action label ?? title ?? id, otherwise title ?? id.
 */
function nodeTitle(node: JourneyNode): string {
  return node.type === 'action'
    ? node.label ?? node.title ?? node.id
    : node.title ?? node.id;
}

function toDataNode(node: JourneyNode, startNodeId: string | null): JourneyWebsiteNode {
  return {
    id: node.id,
    type: node.type,
    title: nodeTitle(node),
    description: node.description ?? '',
    start: node.id === startNodeId,
    sourceRef: toDataSourceRef(node.sourceRef),
  };
}

/**
 * Edge entry; `main` is the 0-based index of the main-path edge (the edge
 * between mainPath[i] and mainPath[i+1], chosen with exactly the same
 * priority as deriveMainPath/segmentToJourney), otherwise null.
 */
function toDataEdge(edge: JourneyEdge, mainIndexByEdgeId: Map<string, number>): JourneyWebsiteEdge {
  const main = mainIndexByEdgeId.get(edge.id);
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    label: edge.label ?? '',
    trigger: edge.trigger ?? null,
    condition: edge.condition ?? null,
    main: main ?? null,
  };
}

/** Builds the data-contract entry of a generated segment. */
function toDataEntry(generated: GeneratedSegment): JourneyWebsiteEntry {
  const segment = generated.segment;
  const startNodeId = segment.flow?.start ?? null;

  // Derive the main path once: node ids for mainPath, edge indices for `main`.
  const mainPath = deriveMainPath(segment);
  const mainIndexByEdgeId = new Map(mainPath.edges.map((edge, index) => [edge.id, index]));

  return {
    id: segment.id,
    slug: toSlug(segment.id),
    kind: segment.kind,
    order: segment.order,
    title: segment.title,
    description: segment.flow?.description ?? '',
    startNodeId,
    nodes: [...segment.nodes]
      .sort((a, b) => cmp(a.id, b.id))
      .map((node) => toDataNode(node, startNodeId)),
    edges: [...segment.edges]
      .sort((a, b) => cmp(a.id, b.id))
      .map((edge) => toDataEdge(edge, mainIndexByEdgeId)),
    mainPath: mainPath.nodes.map((node) => node.id),
    markdown: generated.markdown,
    violations: generated.violations.map((v) => ({ claim: v.claim, reason: v.reason })),
  };
}

export interface BuildJourneyDataInput {
  result: GenerateResult;
  /** Adapter provenance from the extract (extract.adapterInfos). */
  adapterInfos: AdapterInfo[];
  /** config.app.name. */
  appName: string;
  /** config.app.locale. */
  locale: string;
  /** Version of @ductus/core (determined deterministically, not hardcoded). */
  ductusVersion: string;
}

/**
 * Resolve slug collisions deterministically (pattern: IdSanitizer in mermaid.ts):
 * different segment ids can normalize to the same slug (e.g. "auth_flow" and
 * "auth-flow") — in the journey template that would be a duplicate route,
 * leaving one of the journeys unreachable. Duplicate slugs receive the
 * suffixes -2, -3, … in stable order (following the order/slug sort).
 */
function dedupeSlugs(journeys: JourneyWebsiteEntry[]): void {
  const used = new Set<string>();
  for (const journey of journeys) {
    let candidate = journey.slug;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${journey.slug}-${n}`;
      n += 1;
    }
    journey.slug = candidate;
    used.add(candidate);
  }
}

/**
 * Builds the ductus.data.json object deterministically (NFR2): journeys by
 * order (tie-break slug), nodes/edges by id, adapters by name.
 */
export function buildJourneyData(input: BuildJourneyDataInput): JourneyWebsiteData {
  // Tie-break slug; on slug collision the id decides (NFR2 — otherwise the
  // suffix assignment of dedupeSlugs would depend on the input order).
  const journeys = input.result.segments
    .map((generated) => toDataEntry(generated))
    .sort((a, b) => a.order - b.order || cmp(a.slug, b.slug) || cmp(a.id, b.id));
  dedupeSlugs(journeys);

  const violationsTotal = input.result.segments.reduce(
    (sum, generated) => sum + generated.violations.length,
    0,
  );

  return {
    dataVersion: '1',
    site: {
      title: input.appName,
      locale: input.locale,
      ductusVersion: input.ductusVersion,
      adapters: [...input.adapterInfos]
        .sort((a, b) => cmp(a.name, b.name))
        .map((adapter) => ({ name: adapter.name, version: adapter.version })),
      violationsTotal,
    },
    journeys,
  };
}

/** Canonical serialization (NFR2): 2 spaces, LF, trailing newline. */
export function serializeJourneyData(data: JourneyWebsiteData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
