import { describe, expect, it } from 'vitest';
import type { AdapterInfo, JourneyEdge, JourneyNode } from '@ductus/schema';
import type { GeneratedSegment, GenerateResult, GraphSegment } from '../../src/contracts.js';
import { buildJourneyData, serializeJourneyData } from '../../src/output/journey-data.js';
import type { BuildJourneyDataInput } from '../../src/output/journey-data.js';
import { segmentToJourney } from '../../src/output/mermaid.js';

// ─────────────────────────────── Fixtures ────────────────────────────────────

/** Flow segment with a decision: e1 login→check, after which z9 (without a
 *  condition) wins over a0 (with a condition) — exactly the edge-selection
 *  priority of deriveMainPath. */
const authNodes: JourneyNode[] = [
  {
    id: 'login',
    type: 'screen',
    title: 'Login',
    description: 'Bildschirm für die Anmeldung.',
    source: 'annotation',
    sourceRef: { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
  },
  { id: 'check', type: 'decision', title: 'Eingeloggt?', source: 'derived' },
  { id: 'happy', type: 'screen', title: 'Happy', source: 'derived' },
  { id: 'sad', type: 'screen', title: 'Sad', source: 'derived' },
];

const authEdges: JourneyEdge[] = [
  { id: 'e1', from: 'login', to: 'check', trigger: 'submit', source: 'annotation' },
  { id: 'a0', from: 'check', to: 'sad', label: 'Nein', condition: 'Fehler', source: 'derived' },
  { id: 'z9', from: 'check', to: 'happy', label: 'Ja', source: 'derived' },
];

function makeAuthSegment(): GraphSegment {
  return {
    id: 'auth',
    kind: 'flow',
    title: 'Anmeldung',
    order: 1,
    flow: { id: 'auth', title: 'Anmeldung', start: 'login', description: 'Der Anmeldeprozess.' },
    nodes: authNodes,
    edges: authEdges,
    exits: [],
  };
}

function makeGenerated(segment: GraphSegment, overrides: Partial<GeneratedSegment> = {}): GeneratedSegment {
  return {
    segment,
    markdown: `# ${segment.title}\n`,
    fromCache: false,
    violations: [],
    ...overrides,
  };
}

function makeResult(segments: GeneratedSegment[]): GenerateResult {
  return {
    segments,
    cache: { hits: 0, misses: segments.length },
    usage: { inputTokens: 0, outputTokens: 0 },
    estimated: { inputTokens: 0, outputTokens: 0 },
  };
}

const adapterInfos: AdapterInfo[] = [
  { name: 'zeta', version: '2.0.0' },
  { name: 'dart', version: '0.1.0' },
];

function makeInput(segments: GeneratedSegment[]): BuildJourneyDataInput {
  return {
    result: makeResult(segments),
    adapterInfos,
    appName: 'TestApp',
    locale: 'de',
    ductusVersion: '0.1.0',
  };
}

// ─────────────────────────────── Tests ───────────────────────────────────────

describe('buildJourneyData', () => {
  it('fills dataVersion and site metadata; adapters sorted by name (NFR2)', () => {
    const data = buildJourneyData(makeInput([makeGenerated(makeAuthSegment())]));
    expect(data.dataVersion).toBe('1');
    expect(data.site.title).toBe('TestApp');
    expect(data.site.locale).toBe('de');
    expect(data.site.ductusVersion).toBe('0.1.0');
    // Input is ['zeta', 'dart'] — the output sorts by name.
    expect(data.site.adapters).toEqual([
      { name: 'dart', version: '0.1.0' },
      { name: 'zeta', version: '2.0.0' },
    ]);
  });

  it('derives the main path with the same edge-selection priority as segmentToJourney', () => {
    const segment = makeAuthSegment();
    const data = buildJourneyData(makeInput([makeGenerated(segment)]));
    const entry = data.journeys[0]!;

    // z9 (without a condition) wins at the decision over a0 (with a condition).
    expect(entry.mainPath).toEqual(['login', 'check', 'happy']);

    // Cross-check against segmentToJourney: same nodes in the same order.
    const journey = segmentToJourney(segment);
    const taskLabels = journey!
      .split('\n')
      .filter((line) => line.endsWith(': 3'))
      .map((line) => line.trim().replace(/: 3$/, ''));
    const titleById = new Map(entry.nodes.map((node) => [node.id, node.title]));
    expect(entry.mainPath.map((id) => titleById.get(id))).toEqual(taskLabels);
  });

  it('sets main to the 0-based main-path index of the chosen edges, otherwise null', () => {
    const data = buildJourneyData(makeInput([makeGenerated(makeAuthSegment())]));
    const mainById = new Map(data.journeys[0]!.edges.map((edge) => [edge.id, edge.main]));
    expect(mainById.get('e1')).toBe(0); // login → check (step 0)
    expect(mainById.get('z9')).toBe(1); // check → happy (step 1)
    expect(mainById.get('a0')).toBeNull(); // not on the main path
  });

  it('sorts journeys by order (tie-break slug) and nodes and edges by id', () => {
    const flowB: GraphSegment = { ...makeAuthSegment(), id: 'b-flow', order: 2 };
    const flowA: GraphSegment = { ...makeAuthSegment(), id: 'a-flow', order: 2 };
    const first: GraphSegment = { ...makeAuthSegment(), id: 'auth', order: 1 };
    const data = buildJourneyData(
      makeInput([makeGenerated(flowB), makeGenerated(first), makeGenerated(flowA)]),
    );

    expect(data.journeys.map((entry) => entry.id)).toEqual(['auth', 'a-flow', 'b-flow']);
    // nodes/edges sorted by id regardless of input order.
    expect(data.journeys[0]!.nodes.map((node) => node.id)).toEqual(['check', 'happy', 'login', 'sad']);
    expect(data.journeys[0]!.edges.map((edge) => edge.id)).toEqual(['a0', 'e1', 'z9']);
  });

  it('carries violations per journey and sums violationsTotal across all segments', () => {
    const withTwo = makeGenerated(makeAuthSegment(), {
      violations: [
        { claim: 'Behauptung A', reason: 'nicht im Graphen' },
        { claim: 'Behauptung B', reason: 'erfunden' },
      ],
    });
    const misc: GraphSegment = {
      id: '_misc',
      kind: 'misc',
      title: 'Weitere Screens',
      order: 99,
      nodes: [{ id: 'about', type: 'screen', title: 'Über', source: 'derived' }],
      edges: [],
      exits: [],
    };
    const withOne = makeGenerated(misc, {
      violations: [{ claim: 'Behauptung C', reason: 'kein Beleg' }],
    });

    const data = buildJourneyData(makeInput([withTwo, withOne]));
    expect(data.journeys[0]!.violations).toEqual([
      { claim: 'Behauptung A', reason: 'nicht im Graphen' },
      { claim: 'Behauptung B', reason: 'erfunden' },
    ]);
    expect(data.journeys[1]!.violations).toHaveLength(1);
    expect(data.site.violationsTotal).toBe(3);
  });

  it('resolves node.title consistently with renderNode: action uses label, fallback is the id', () => {
    const segment: GraphSegment = {
      id: 'titles',
      kind: 'screen',
      title: 'Titel-Fälle',
      order: 5,
      nodes: [
        { id: 'a-action', type: 'action', label: 'Absenden', title: 'ignoriert', source: 'derived' },
        { id: 'b-action-no-label', type: 'action', title: 'Aktions-Titel', source: 'derived' },
        { id: 'c-screen', type: 'screen', title: 'Bildschirm', source: 'derived' },
        { id: 'd-untitled', type: 'screen', source: 'derived' },
      ],
      edges: [],
      exits: [],
    };
    const data = buildJourneyData(makeInput([makeGenerated(segment)]));
    const titleById = new Map(data.journeys[0]!.nodes.map((node) => [node.id, node.title]));
    expect(titleById.get('a-action')).toBe('Absenden'); // action: label over title
    expect(titleById.get('b-action-no-label')).toBe('Aktions-Titel'); // action without label: title
    expect(titleById.get('c-screen')).toBe('Bildschirm'); // screen: title
    expect(titleById.get('d-untitled')).toBe('d-untitled'); // fallback id
  });

  it('returns an empty mainPath, startNodeId null and main null for screen and misc segments', () => {
    const base = makeAuthSegment();
    const { flow: _flow, ...withoutFlow } = base;
    const screenSegment: GraphSegment = { ...withoutFlow, id: 'screen-seg', kind: 'screen', order: 2 };
    const miscSegment: GraphSegment = { ...withoutFlow, id: '_misc', kind: 'misc', order: 3 };

    const data = buildJourneyData(
      makeInput([makeGenerated(screenSegment), makeGenerated(miscSegment)]),
    );
    for (const entry of data.journeys) {
      expect(entry.mainPath).toEqual([]);
      expect(entry.startNodeId).toBeNull();
      expect(entry.description).toBe(''); // no flow ⇒ no description
      expect(entry.nodes.every((node) => node.start === false)).toBe(true);
      expect(entry.edges.every((edge) => edge.main === null)).toBe(true);
    }
  });

  it('carries segment fields: slug via toSlug, flow description, startNodeId and start flag', () => {
    const segment: GraphSegment = { ...makeAuthSegment(), id: 'Anmelde Flow' };
    segment.flow = { ...segment.flow!, id: 'Anmelde Flow' };
    const data = buildJourneyData(makeInput([makeGenerated(segment)]));
    const entry = data.journeys[0]!;

    expect(entry.slug).toBe('anmelde-flow'); // toSlug(segment.id)
    expect(entry.kind).toBe('flow');
    expect(entry.description).toBe('Der Anmeldeprozess.');
    expect(entry.startNodeId).toBe('login');
    expect(entry.markdown).toBe('# Anmeldung\n');
    const startFlags = new Map(entry.nodes.map((node) => [node.id, node.start]));
    expect(startFlags.get('login')).toBe(true);
    expect([...startFlags.entries()].filter(([, start]) => start)).toHaveLength(1);
  });

  it('resolves slug collisions deterministically with the suffixes -2, -3, …', () => {
    // "auth_flow" and "auth flow" both normalize to "auth-flow" (toSlug).
    const flowA: GraphSegment = { ...makeAuthSegment(), id: 'auth_flow', order: 1 };
    const flowB: GraphSegment = { ...makeAuthSegment(), id: 'auth flow', order: 2 };
    const flowC: GraphSegment = { ...makeAuthSegment(), id: 'auth-flow', order: 3 };

    const data = buildJourneyData(makeInput([makeGenerated(flowA), makeGenerated(flowB), makeGenerated(flowC)]));
    expect(data.journeys.map((entry) => entry.slug)).toEqual(['auth-flow', 'auth-flow-2', 'auth-flow-3']);

    // Regardless of input order (NFR2): identical assignment.
    const reversed = buildJourneyData(
      makeInput([makeGenerated(flowC), makeGenerated(flowB), makeGenerated(flowA)]),
    );
    expect(reversed.journeys.map((entry) => [entry.id, entry.slug])).toEqual(
      data.journeys.map((entry) => [entry.id, entry.slug]),
    );
  });

  it('sets sourceRef to null when missing, otherwise carries it in full', () => {
    const data = buildJourneyData(makeInput([makeGenerated(makeAuthSegment())]));
    const byId = new Map(data.journeys[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('login')!.sourceRef).toEqual({
      file: 'lib/screens/login.dart',
      line: 12,
      symbol: 'LoginScreen',
    });
    expect(byId.get('check')!.sourceRef).toBeNull();
  });

  it('normalizes edge fields: label ?? "", trigger/condition as null (JSON-stable)', () => {
    const data = buildJourneyData(makeInput([makeGenerated(makeAuthSegment())]));
    const byId = new Map(data.journeys[0]!.edges.map((edge) => [edge.id, edge]));
    expect(byId.get('e1')).toEqual({
      id: 'e1',
      from: 'login',
      to: 'check',
      label: '', // no label ⇒ empty string
      trigger: 'submit',
      condition: null,
      main: 0,
    });
    expect(byId.get('a0')).toMatchObject({ label: 'Nein', trigger: null, condition: 'Fehler' });
  });
});

describe('serializeJourneyData', () => {
  it('is byte-identical on a double run and independent of the input order (NFR2)', () => {
    const forward = serializeJourneyData(buildJourneyData(makeInput([makeGenerated(makeAuthSegment())])));

    // Nodes, edges and adapters in reverse order ⇒ identical bytes.
    const reversedSegment: GraphSegment = {
      ...makeAuthSegment(),
      nodes: [...authNodes].reverse(),
      edges: [...authEdges].reverse(),
    };
    const reversedInput: BuildJourneyDataInput = {
      ...makeInput([makeGenerated(reversedSegment)]),
      adapterInfos: [...adapterInfos].reverse(),
    };
    expect(serializeJourneyData(buildJourneyData(reversedInput))).toBe(forward);
    expect(serializeJourneyData(buildJourneyData(makeInput([makeGenerated(makeAuthSegment())])))).toBe(
      forward,
    );
  });

  it('serializes canonically: 2 spaces, LF, trailing newline, no timestamps', () => {
    const data = buildJourneyData(makeInput([makeGenerated(makeAuthSegment())]));
    const text = serializeJourneyData(data);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r'); // LF, no CRLF
    expect(text).toContain('  "dataVersion": "1"'); // 2-space indentation
    expect(text).not.toMatch(/generatedAt|timestamp/i);
    expect(JSON.parse(text)).toEqual(data); // roundtrip
  });
});
