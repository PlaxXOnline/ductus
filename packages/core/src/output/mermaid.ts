/**
 * Mermaid rendering of graph segments and whole graphs (MDX diagrams, `ductus graph`):
 * flowchart for the structure, journey for the main path of a flow.
 * Output is deterministically sorted (NFR2).
 */

import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import type { GraphSegment } from '../contracts.js';

/** Locale-independent string comparison (NFR2 — localeCompare would depend on the environment). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Escape quotes — Mermaid has no backslash escapes in labels. */
function escapeQuotes(text: string): string {
  return text.replace(/"/g, '#quot;');
}

/**
 * Maps graph ids to Mermaid-safe ids ([A-Za-z0-9_]).
 * Collisions (e.g. "a-b" and "a_b") are resolved with suffixes "_2", "_3", … —
 * deterministic because ids are requested in stable order.
 */
class IdSanitizer {
  private readonly map = new Map<string, string>();
  private readonly used = new Set<string>();

  get(id: string): string {
    const existing = this.map.get(id);
    if (existing !== undefined) return existing;
    let base = id.replace(/[^A-Za-z0-9_]/g, '_');
    if (base === '') base = 'n';
    let candidate = base;
    let n = 2;
    while (this.used.has(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    this.map.set(id, candidate);
    this.used.add(candidate);
    return candidate;
  }
}

function renderNode(node: JourneyNode, mermaidId: string): string {
  switch (node.type) {
    case 'decision':
      return `  ${mermaidId}{"${escapeQuotes(node.title ?? node.id)}"}`;
    case 'action':
      return `  ${mermaidId}(["${escapeQuotes(node.label ?? node.title ?? node.id)}"])`;
    default:
      return `  ${mermaidId}["${escapeQuotes(node.title ?? node.id)}"]`;
  }
}

/** Uniform condition semantics: an empty string counts as no condition (cf. V5c in validate.ts). */
function hasCondition(edge: JourneyEdge): edge is JourneyEdge & { condition: string } {
  return edge.condition !== undefined && edge.condition !== '';
}

/** Edge caption: label or trigger, condition appended with " / ". */
function edgeText(edge: JourneyEdge): string {
  let text = edge.label ?? edge.trigger ?? '';
  if (hasCondition(edge)) {
    text = text === '' ? edge.condition : `${text} / ${edge.condition}`;
  }
  return text;
}

function renderEdge(fromId: string, toPart: string, edge: JourneyEdge, dashed: boolean): string {
  const arrow = dashed ? '-.->' : '-->';
  const text = edgeText(edge);
  return text === ''
    ? `  ${fromId} ${arrow} ${toPart}`
    : `  ${fromId} ${arrow}|${escapeQuotes(text)}| ${toPart}`;
}

/** Renders a segment as 'flowchart TD'; exits appear as dashed edges. */
export function segmentToMermaid(segment: GraphSegment): string {
  const san = new IdSanitizer();
  const lines: string[] = ['flowchart TD'];

  const nodes = [...segment.nodes].sort((a, b) => cmp(a.id, b.id));
  for (const node of nodes) {
    lines.push(renderNode(node, san.get(node.id)));
  }

  const edges = [...segment.edges].sort((a, b) => cmp(a.id, b.id));
  for (const edge of edges) {
    lines.push(renderEdge(san.get(edge.from), san.get(edge.to), edge, false));
  }

  // Edges leaving the segment: define the target node inline with its title.
  const exits = [...segment.exits].sort((a, b) => cmp(a.edge.id, b.edge.id));
  for (const exit of exits) {
    const target = `${san.get(exit.edge.to)}["${escapeQuotes(exit.toTitle)}"]`;
    lines.push(renderEdge(san.get(exit.edge.from), target, exit.edge, true));
  }

  return lines.join('\n');
}

// ─────────────────────────────── journey (main path) ─────────────────────────

/** Safety limit for the main-path derivation — guards against pathological graphs. */
const MAX_JOURNEY_STEPS = 100;

/** Mermaid entities for characters with special meaning in journey lines. */
const JOURNEY_ENTITIES: Record<string, string> = { '#': '#35;', ':': '#58;', ';': '#59;' };

/**
 * Escaping for the journey title and task labels: line breaks become a single
 * space; '#', ':' and ';' become Mermaid entities. The replacement runs in a
 * single pass over the original characters ('#' conceptually before ':'/';') —
 * sequential replacement would corrupt the '#' or ';' of entities already
 * produced.
 */
function escapeJourneyText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ').replace(/[#:;]/g, (ch) => JOURNEY_ENTITIES[ch] ?? ch);
}

/**
 * Keywords that Mermaid's journey lexer recognizes at the start of a line
 * (case-insensitive). A task label starting like that would be parsed as a
 * statement — 'journey' and 'section ' cause parse errors, 'title ' silently
 * overwrites the diagram title.
 */
const JOURNEY_LINE_KEYWORDS = ['journey', 'section', 'title'];

/**
 * Task-label escaping: like escapeJourneyText; if the result starts with a
 * journey keyword or with '%%' (Mermaid comment, silently swallows the line),
 * the first character is additionally written as a Mermaid entity (#<code>;) —
 * the lexer then no longer sees a keyword, while the original character is
 * still rendered.
 */
function escapeJourneyTaskLabel(text: string): string {
  const escaped = escapeJourneyText(text);
  const lower = escaped.toLowerCase();
  const collides =
    JOURNEY_LINE_KEYWORDS.some((keyword) => lower.startsWith(keyword)) || escaped.startsWith('%%');
  return collides ? `#${escaped.charCodeAt(0)};${escaped.slice(1)}` : escaped;
}

/**
 * Priority comparison for the main path's edge choice (deterministic, NFR2):
 * (1) trigger !== 'back' before trigger === 'back',
 * (2) without condition before with condition (empty string counts as none, see hasCondition),
 * (3) smallest edge.id.
 */
function compareMainPathEdges(a: JourneyEdge, b: JourneyEdge): number {
  const backDelta = (a.trigger === 'back' ? 1 : 0) - (b.trigger === 'back' ? 1 : 0);
  if (backDelta !== 0) return backDelta;
  const conditionDelta = (hasCondition(a) ? 1 : 0) - (hasCondition(b) ? 1 : 0);
  if (conditionDelta !== 0) return conditionDelta;
  return cmp(a.id, b.id);
}

/**
 * Task caption consistent with renderNode: action uses label, otherwise title (fallback id).
 * An empty or whitespace-only label does not fall back to the id via ??, yet
 * would produce an invalid task line (": 3") — hence the additional id fallback.
 */
function journeyTaskLabel(node: JourneyNode): string {
  const label =
    node.type === 'action' ? node.label ?? node.title ?? node.id : node.title ?? node.id;
  return label.trim() === '' ? node.id : label;
}

/** Result of the main-path derivation: nodes in path order + chosen edges. */
export interface MainPath {
  /** Path nodes starting at flow.start; empty if no main path can be derived. */
  nodes: JourneyNode[];
  /** Chosen edges; edges[i] connects nodes[i] with nodes[i+1]. */
  edges: JourneyEdge[];
}

const EMPTY_MAIN_PATH: MainPath = { nodes: [], edges: [] };

/**
 * Deterministic main-path derivation of a flow segment (NFR2):
 * starting at flow.start, exactly one outgoing edge within the segment is
 * chosen per step (compareMainPathEdges); visited nodes are never repeated,
 * so cycles terminate. Returns an empty path for screen/misc segments and
 * for paths with fewer than 2 nodes — consumers (segmentToJourney,
 * buildJourneyData) do not have to distinguish that case themselves.
 */
export function deriveMainPath(segment: GraphSegment): MainPath {
  if (segment.kind !== 'flow' || segment.flow === undefined) return EMPTY_MAIN_PATH;
  const nodesById = new Map(segment.nodes.map((node) => [node.id, node]));
  const start = nodesById.get(segment.flow.start);
  if (start === undefined) return EMPTY_MAIN_PATH;

  const path: JourneyNode[] = [start];
  const chosen: JourneyEdge[] = [];
  const visited = new Set<string>([start.id]);
  let current = start;
  for (let step = 0; step < MAX_JOURNEY_STEPS; step += 1) {
    const candidates = segment.edges.filter(
      (edge) => edge.from === current.id && nodesById.has(edge.to) && !visited.has(edge.to),
    );
    const [first] = candidates;
    if (first === undefined) break;
    let best = first;
    for (const candidate of candidates) {
      if (compareMainPathEdges(candidate, best) < 0) best = candidate;
    }
    const next = nodesById.get(best.to);
    if (next === undefined) break; // already ruled out by nodesById.has
    visited.add(next.id);
    path.push(next);
    chosen.push(best);
    current = next;
  }
  if (path.length < 2) return EMPTY_MAIN_PATH;
  return { nodes: path, edges: chosen };
}

/**
 * Renders the deterministically derived main path (deriveMainPath) of a flow
 * segment as a Mermaid 'journey'. journey is strictly linear (no branches).
 * Score constant 3 (neutral) — the graph contains no sentiment, nothing is
 * invented; likewise no actors and no edge labels (that is what the flowchart
 * is for). Returns undefined for screen/misc segments and for paths with
 * fewer than 2 nodes.
 */
export function segmentToJourney(segment: GraphSegment, sectionTitle = 'Main path'): string | undefined {
  if (segment.kind !== 'flow' || segment.flow === undefined) return undefined;
  const path = deriveMainPath(segment).nodes;
  if (path.length < 2) return undefined;

  const lines = [
    'journey',
    `  title ${escapeJourneyText(segment.flow.title)}`,
    `  section ${escapeJourneyText(sectionTitle)}`,
  ];
  for (const node of path) {
    lines.push(`    ${escapeJourneyTaskLabel(journeyTaskLabel(node))}: 3`);
  }
  return lines.join('\n');
}

/** Renders the whole graph as 'flowchart TD'. */
export function graphToMermaid(graph: JourneyGraph): string {
  const san = new IdSanitizer();
  const lines: string[] = ['flowchart TD'];

  const nodes = [...graph.nodes].sort((a, b) => cmp(a.id, b.id));
  for (const node of nodes) {
    lines.push(renderNode(node, san.get(node.id)));
  }

  const edges = [...graph.edges].sort((a, b) => cmp(a.id, b.id));
  for (const edge of edges) {
    lines.push(renderEdge(san.get(edge.from), san.get(edge.to), edge, false));
  }

  return lines.join('\n');
}
