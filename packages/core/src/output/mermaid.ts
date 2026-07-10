/**
 * Mermaid-Rendering von Graph-Segmenten und ganzen Graphen (§9.1, §10.1 `ductus graph`):
 * flowchart für die Struktur, journey für den Hauptpfad eines Flows.
 * Ausgabe ist deterministisch sortiert (NFR2).
 */

import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import type { GraphSegment } from '../contracts.js';

/** Locale-unabhängiger String-Vergleich (NFR2 — localeCompare wäre umgebungsabhängig). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Anführungszeichen escapen — Mermaid kennt keine Backslash-Escapes in Labels. */
function escapeQuotes(text: string): string {
  return text.replace(/"/g, '#quot;');
}

/**
 * Bildet Graph-ids auf Mermaid-sichere ids ([A-Za-z0-9_]) ab.
 * Kollisionen (z. B. "a-b" und "a_b") werden per Suffix "_2", "_3", … aufgelöst —
 * deterministisch, weil ids in stabiler Reihenfolge angefragt werden.
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

/** Einheitliche condition-Semantik: Leerstring zählt wie keine condition (vgl. V5c in validate.ts). */
function hasCondition(edge: JourneyEdge): edge is JourneyEdge & { condition: string } {
  return edge.condition !== undefined && edge.condition !== '';
}

/** Kanten-Beschriftung: label bzw. trigger, condition mit " / " angehängt. */
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

/** Rendert ein Segment als 'flowchart TD'; exits erscheinen als gestrichelte Kanten. */
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

  // Segment-verlassende Kanten: Ziel-Node inline mit seinem Titel definieren.
  const exits = [...segment.exits].sort((a, b) => cmp(a.edge.id, b.edge.id));
  for (const exit of exits) {
    const target = `${san.get(exit.edge.to)}["${escapeQuotes(exit.toTitle)}"]`;
    lines.push(renderEdge(san.get(exit.edge.from), target, exit.edge, true));
  }

  return lines.join('\n');
}

// ─────────────────────────────── journey (Hauptpfad) ─────────────────────────

/** Sicherheitslimit der Hauptpfad-Ableitung — schützt vor pathologischen Graphen. */
const MAX_JOURNEY_STEPS = 100;

/** Mermaid-Entities für Zeichen mit Sonderbedeutung in journey-Zeilen. */
const JOURNEY_ENTITIES: Record<string, string> = { '#': '#35;', ':': '#58;', ';': '#59;' };

/**
 * Escaping für journey-title und Task-Labels: Zeilenumbrüche werden zu einem
 * Leerzeichen; '#', ':' und ';' werden zu Mermaid-Entities. Die Ersetzung läuft
 * in einem einzigen Durchlauf über die Original-Zeichen ('#' gedanklich vor
 * ':'/';') — sequenzielles Ersetzen würde '#' bzw. ';' der bereits erzeugten
 * Entities zerstören.
 */
function escapeJourneyText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ').replace(/[#:;]/g, (ch) => JOURNEY_ENTITIES[ch] ?? ch);
}

/**
 * Schlüsselwörter, die Mermaids journey-Lexer am Zeilenanfang (case-insensitive)
 * erkennt. Ein Task-Label, das so beginnt, würde als Statement geparst — 'journey'
 * und 'section ' erzeugen Parse-Fehler, 'title ' überschreibt still den Diagramm-Titel.
 */
const JOURNEY_LINE_KEYWORDS = ['journey', 'section', 'title'];

/**
 * Task-Label-Escaping: wie escapeJourneyText; beginnt das Ergebnis mit einem
 * journey-Schlüsselwort oder mit '%%' (Mermaid-Kommentar, verschluckt die Zeile
 * still), wird zusätzlich das erste Zeichen als Mermaid-Entity (#<code>;)
 * geschrieben — der Lexer sieht dann kein Schlüsselwort mehr, gerendert wird
 * das Original-Zeichen.
 */
function escapeJourneyTaskLabel(text: string): string {
  const escaped = escapeJourneyText(text);
  const lower = escaped.toLowerCase();
  const collides =
    JOURNEY_LINE_KEYWORDS.some((keyword) => lower.startsWith(keyword)) || escaped.startsWith('%%');
  return collides ? `#${escaped.charCodeAt(0)};${escaped.slice(1)}` : escaped;
}

/**
 * Prioritätsvergleich für die Kantenwahl des Hauptpfads (deterministisch, NFR2):
 * (1) trigger !== 'back' vor trigger === 'back',
 * (2) ohne condition vor mit condition (Leerstring zählt wie keine, s. hasCondition),
 * (3) kleinste edge.id.
 */
function compareMainPathEdges(a: JourneyEdge, b: JourneyEdge): number {
  const backDelta = (a.trigger === 'back' ? 1 : 0) - (b.trigger === 'back' ? 1 : 0);
  if (backDelta !== 0) return backDelta;
  const conditionDelta = (hasCondition(a) ? 1 : 0) - (hasCondition(b) ? 1 : 0);
  if (conditionDelta !== 0) return conditionDelta;
  return cmp(a.id, b.id);
}

/**
 * Task-Beschriftung konsistent zu renderNode: action nutzt label, sonst title (Fallback id).
 * Ein leeres bzw. nur aus Whitespace bestehendes Label fällt per ?? nicht auf die id
 * zurück, ergäbe aber eine invalide Task-Zeile („: 3") — deshalb zusätzlich id-Fallback.
 */
function journeyTaskLabel(node: JourneyNode): string {
  const label =
    node.type === 'action' ? node.label ?? node.title ?? node.id : node.title ?? node.id;
  return label.trim() === '' ? node.id : label;
}

/** Ergebnis der Hauptpfad-Ableitung: Nodes in Pfad-Reihenfolge + gewählte Kanten. */
export interface MainPath {
  /** Pfad-Nodes ab flow.start; leer, wenn kein Hauptpfad ableitbar ist. */
  nodes: JourneyNode[];
  /** Gewählte Kanten; edges[i] verbindet nodes[i] mit nodes[i+1]. */
  edges: JourneyEdge[];
}

const EMPTY_MAIN_PATH: MainPath = { nodes: [], edges: [] };

/**
 * Deterministische Hauptpfad-Ableitung eines Flow-Segments (NFR2, DD §L):
 * ab flow.start wird pro Schritt genau eine ausgehende Kante innerhalb des
 * Segments gewählt (compareMainPathEdges); besuchte Nodes werden nie wiederholt,
 * Zyklen terminieren also. Liefert einen leeren Pfad für screen-/misc-Segmente
 * und für Pfade mit weniger als 2 Nodes — Konsumenten (segmentToJourney,
 * buildJourneyData) müssen den Fall nicht selbst unterscheiden.
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
    if (next === undefined) break; // durch nodesById.has bereits ausgeschlossen
    visited.add(next.id);
    path.push(next);
    chosen.push(best);
    current = next;
  }
  if (path.length < 2) return EMPTY_MAIN_PATH;
  return { nodes: path, edges: chosen };
}

/**
 * Rendert für ein Flow-Segment den deterministisch abgeleiteten Hauptpfad
 * (deriveMainPath) als Mermaid-'journey'. journey ist strikt linear (keine
 * Verzweigungen). Score konstant 3 (neutral) — der Graph enthält kein
 * Sentiment, es wird nichts erfunden; ebenso keine Akteure und keine Kantenlabels
 * (dafür gibt es das flowchart). Liefert undefined für screen-/misc-Segmente und
 * für Pfade mit weniger als 2 Nodes.
 */
export function segmentToJourney(segment: GraphSegment): string | undefined {
  if (segment.kind !== 'flow' || segment.flow === undefined) return undefined;
  const path = deriveMainPath(segment).nodes;
  if (path.length < 2) return undefined;

  const lines = [
    'journey',
    `  title ${escapeJourneyText(segment.flow.title)}`,
    '  section Hauptpfad',
  ];
  for (const node of path) {
    lines.push(`    ${escapeJourneyTaskLabel(journeyTaskLabel(node))}: 3`);
  }
  return lines.join('\n');
}

/** Rendert den gesamten Graphen als 'flowchart TD'. */
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
