/**
 * Segmentation of the graph into generation units instead of one monolithic prompt.
 * Shorter, grounded segments reduce hallucination and cost.
 */

import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import type { Granularity, GraphSegment } from '../contracts.js';

const MISC_SEGMENT_ID = '_misc';
const DEFAULT_MISC_TITLE = 'Other areas';

/** Codepoint comparison (no localeCompare — NFR2 requires platform-stable sorting). */
function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function displayTitle(node: JourneyNode | undefined, fallbackId: string): string {
  return node?.title ?? node?.label ?? fallbackId;
}

function edgesWithin(graph: JourneyGraph, ids: ReadonlySet<string>): JourneyEdge[] {
  return graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).sort(compareById);
}

function exitsFrom(
  graph: JourneyGraph,
  ids: ReadonlySet<string>,
): Array<{ edge: JourneyEdge; toTitle: string }> {
  return graph.edges
    .filter((e) => ids.has(e.from) && !ids.has(e.to))
    .sort(compareById)
    .map((edge) => ({
      edge,
      toTitle: displayTitle(graph.nodes.find((n) => n.id === edge.to), edge.to),
    }));
}

export function segmentGraph(
  graph: JourneyGraph,
  granularity: Granularity,
  opts?: { miscTitle?: string },
): GraphSegment[] {
  return granularity === 'flow'
    ? segmentByFlow(graph, opts?.miscTitle ?? DEFAULT_MISC_TITLE)
    : segmentByScreen(graph);
}

function segmentByFlow(graph: JourneyGraph, miscTitle: string): GraphSegment[] {
  const flows = [...graph.flows].sort(compareById);
  const segments: GraphSegment[] = [];
  const assigned = new Set<string>();

  flows.forEach((flow, index) => {
    // Flow members plus the start node (which need not carry a flow assignment itself).
    const nodes = graph.nodes
      .filter((n) => n.flow === flow.id || n.id === flow.start)
      .sort(compareById);
    for (const node of nodes) assigned.add(node.id);
    const ids = new Set(nodes.map((n) => n.id));
    segments.push({
      id: flow.id,
      kind: 'flow',
      title: flow.title,
      order: index + 1,
      flow,
      nodes,
      edges: edgesWithin(graph, ids),
      exits: exitsFrom(graph, ids),
    });
  });

  // Nodes without a flow assignment collect in a "_misc" segment (only when non-empty).
  const miscNodes = graph.nodes.filter((n) => !assigned.has(n.id)).sort(compareById);
  if (miscNodes.length > 0) {
    const ids = new Set(miscNodes.map((n) => n.id));
    segments.push({
      id: MISC_SEGMENT_ID,
      kind: 'misc',
      title: miscTitle,
      order: flows.length + 1,
      nodes: miscNodes,
      edges: edgesWithin(graph, ids),
      exits: exitsFrom(graph, ids),
    });
  }

  return segments;
}

function segmentByScreen(graph: JourneyGraph): GraphSegment[] {
  // Non-screen nodes get no segment of their own — they appear only as exit targets.
  const screens = graph.nodes.filter((n) => n.type === 'screen').sort(compareById);
  return screens.map((screen, index) => {
    const outgoing = graph.edges.filter((e) => e.from === screen.id).sort(compareById);
    const exits = outgoing
      .filter((e) => e.to !== screen.id)
      .map((edge) => ({
        edge,
        toTitle: displayTitle(graph.nodes.find((n) => n.id === edge.to), edge.to),
      }));
    const flow = screen.flow ? graph.flows.find((f) => f.id === screen.flow) : undefined;
    return {
      id: screen.id,
      kind: 'screen' as const,
      title: screen.title ?? screen.id,
      order: index + 1,
      ...(flow ? { flow } : {}),
      nodes: [screen],
      // edges only within the segment (here: self-loops) — everything else is an exit,
      // otherwise every transition would appear twice (diagram + prompt).
      edges: outgoing.filter((e) => e.to === screen.id),
      exits,
    };
  });
}
