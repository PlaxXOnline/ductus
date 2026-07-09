/**
 * Segmentierung des Graphen in Generierungseinheiten (SPEC §8.3 Schritt 1).
 * Kürzere, geerdete Segmente reduzieren Halluzination und Kosten.
 */

import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import type { Granularity, GraphSegment } from '../contracts.js';

const MISC_SEGMENT_ID = '_misc';
const MISC_SEGMENT_TITLE = 'Weitere Bereiche';

/** Codepoint-Vergleich (kein localeCompare — NFR2 verlangt plattformstabile Sortierung). */
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

export function segmentGraph(graph: JourneyGraph, granularity: Granularity): GraphSegment[] {
  return granularity === 'flow' ? segmentByFlow(graph) : segmentByScreen(graph);
}

function segmentByFlow(graph: JourneyGraph): GraphSegment[] {
  const flows = [...graph.flows].sort(compareById);
  const segments: GraphSegment[] = [];
  const assigned = new Set<string>();

  flows.forEach((flow, index) => {
    // Flow-Mitglieder plus Start-Node (der selbst keine flow-Zuordnung tragen muss).
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

  // Nodes ohne Flow-Zuordnung sammeln sich in einem "_misc"-Segment (nur wenn nicht leer).
  const miscNodes = graph.nodes.filter((n) => !assigned.has(n.id)).sort(compareById);
  if (miscNodes.length > 0) {
    const ids = new Set(miscNodes.map((n) => n.id));
    segments.push({
      id: MISC_SEGMENT_ID,
      kind: 'misc',
      title: MISC_SEGMENT_TITLE,
      order: flows.length + 1,
      nodes: miscNodes,
      edges: edgesWithin(graph, ids),
      exits: exitsFrom(graph, ids),
    });
  }

  return segments;
}

function segmentByScreen(graph: JourneyGraph): GraphSegment[] {
  // Nicht-Screen-Nodes erhalten kein eigenes Segment — sie erscheinen nur als exits-Ziele.
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
      // edges nur innerhalb des Segments (hier: Self-Loops) — alles andere sind exits,
      // sonst erschiene jede Transition doppelt (Diagramm + Prompt).
      edges: outgoing.filter((e) => e.to === screen.id),
      exits,
    };
  });
}
