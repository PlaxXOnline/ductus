/**
 * Datenvertrag ductus.data.json für den Website-Generator "journey" (§9.2, DD §O).
 *
 * Baut aus einem GenerateResult das vollständige Datenobjekt, das scaffoldWebsite
 * im journey-Modus als einzige Daten-Datei in die Site-Wurzel schreibt; das
 * Template liest sie zur Buildzeit. Alles deterministisch (NFR2): stabile
 * Sortierung, LF, abschließender Zeilenumbruch, KEINE Zeitstempel.
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

/** Locale-unabhängiger String-Vergleich (NFR2 — localeCompare wäre umgebungsabhängig). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sourceRef mit stabiler Schlüsselreihenfolge; fehlende Werte als null (JSON-stabil). */
function toDataSourceRef(ref: SourceRef | undefined): SourceRef | null {
  if (ref === undefined) return null;
  return {
    file: ref.file,
    ...(ref.line !== undefined ? { line: ref.line } : {}),
    ...(ref.symbol !== undefined ? { symbol: ref.symbol } : {}),
  };
}

/**
 * Anzeige-Titel konsistent zu renderNode/journeyTaskLabel in mermaid.ts:
 * für type=action label ?? title ?? id, sonst title ?? id.
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
 * Kanten-Eintrag; `main` ist der 0-basierte Index der Hauptpfad-Kante (die
 * Kante zwischen mainPath[i] und mainPath[i+1], gewählt mit exakt derselben
 * Priorität wie deriveMainPath/segmentToJourney), sonst null.
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

/** Baut den Datenvertrags-Eintrag eines generierten Segments. */
function toDataEntry(generated: GeneratedSegment): JourneyWebsiteEntry {
  const segment = generated.segment;
  const startNodeId = segment.flow?.start ?? null;

  // Hauptpfad einmal ableiten: Node-IDs für mainPath, Kanten-Indizes für `main`.
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
  /** Adapter-Provenance aus dem Extract (extract.adapterInfos). */
  adapterInfos: AdapterInfo[];
  /** config.app.name. */
  appName: string;
  /** config.app.locale. */
  locale: string;
  /** Version von @ductus/core (deterministisch ermittelt, kein Hardcoding). */
  ductusVersion: string;
}

/**
 * Slug-Kollisionen deterministisch auflösen (Muster: IdSanitizer in mermaid.ts):
 * verschiedene Segment-ids können auf denselben Slug normalisieren (z. B.
 * "auth_flow" und "auth-flow") — im journey-Template wäre das eine doppelte
 * Route, eine der Journeys unerreichbar. Doppelte Slugs erhalten in stabiler
 * Reihenfolge (nach der order/slug-Sortierung) die Suffixe -2, -3, ….
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
 * Baut das ductus.data.json-Objekt deterministisch (NFR2): journeys nach
 * order (Tie-Break slug), nodes/edges nach id, adapters nach name.
 */
export function buildJourneyData(input: BuildJourneyDataInput): JourneyWebsiteData {
  // Tie-Break slug; bei Slug-Kollision entscheidet die id (NFR2 — sonst hinge
  // die Suffix-Vergabe von dedupeSlugs an der Eingabereihenfolge).
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

/** Kanonische Serialisierung (NFR2): 2 Spaces, LF, abschließender Zeilenumbruch. */
export function serializeJourneyData(data: JourneyWebsiteData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
