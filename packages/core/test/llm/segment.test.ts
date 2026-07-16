import { describe, expect, it } from 'vitest';
import type { JourneyGraph } from '@ductus/schema';
import { segmentGraph } from '../../src/llm/segment.js';

const graph: JourneyGraph = {
  schemaVersion: '1.0',
  flows: [
    { id: 'billing', title: 'Abrechnung', start: 'invoices' },
    { id: 'auth', title: 'Anmeldung', start: 'login' },
  ],
  nodes: [
    { id: 'register', type: 'screen', title: 'Registrieren', flow: 'auth', source: 'derived' },
    { id: 'login', type: 'screen', title: 'Login', flow: 'auth', source: 'derived' },
    { id: 'gate', type: 'decision', title: 'Eingeloggt?', flow: 'auth', source: 'derived' },
    { id: 'invoices', type: 'screen', title: 'Rechnungen', flow: 'billing', source: 'derived' },
    { id: 'settings', type: 'screen', title: 'Einstellungen', source: 'derived' },
    { id: 'dashboard', type: 'screen', title: 'Dashboard', source: 'derived' },
  ],
  edges: [
    { id: 'e_login_register', from: 'login', to: 'register', trigger: 'tap', source: 'derived' },
    { id: 'e_login_gate', from: 'login', to: 'gate', trigger: 'submit', source: 'derived' },
    { id: 'e_gate_dashboard', from: 'gate', to: 'dashboard', condition: 'eingeloggt', source: 'derived' },
    { id: 'e_dashboard_settings', from: 'dashboard', to: 'settings', trigger: 'tap', source: 'derived' },
    { id: 'e_settings_invoices', from: 'settings', to: 'invoices', trigger: 'tap', source: 'derived' },
  ],
};

describe('segmentGraph — flow granularity', () => {
  it('creates one segment per flow (sorted by id) plus _misc with a stable order', () => {
    const segments = segmentGraph(graph, 'flow');
    expect(segments.map((s) => s.id)).toEqual(['auth', 'billing', '_misc']);
    expect(segments.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(segments.map((s) => s.kind)).toEqual(['flow', 'flow', 'misc']);
    expect(segments[2]!.title).toBe('Other areas');
  });

  it('uses the provided miscTitle for the "_misc" segment (locale-dependent)', () => {
    const segments = segmentGraph(graph, 'flow', { miscTitle: 'Weitere Bereiche' });
    expect(segments[2]!.title).toBe('Weitere Bereiche');
  });

  it('includes only edges with both ends in the segment and sorts nodes/edges by id', () => {
    const auth = segmentGraph(graph, 'flow')[0]!;
    expect(auth.nodes.map((n) => n.id)).toEqual(['gate', 'login', 'register']);
    expect(auth.edges.map((e) => e.id)).toEqual(['e_login_gate', 'e_login_register']);
    expect(auth.flow).toEqual({ id: 'auth', title: 'Anmeldung', start: 'login' });
  });

  it('lists segment-leaving edges as exits with the target node’s toTitle', () => {
    const segments = segmentGraph(graph, 'flow');
    const auth = segments[0]!;
    expect(auth.exits).toEqual([
      { edge: graph.edges[2], toTitle: 'Dashboard' },
    ]);
    const misc = segments[2]!;
    expect(misc.nodes.map((n) => n.id)).toEqual(['dashboard', 'settings']);
    expect(misc.edges.map((e) => e.id)).toEqual(['e_dashboard_settings']);
    expect(misc.exits).toEqual([{ edge: graph.edges[4], toTitle: 'Rechnungen' }]);
  });

  it('includes the start node in the flow segment even without its own flow assignment', () => {
    const small: JourneyGraph = {
      schemaVersion: '1.0',
      flows: [{ id: 'main', title: 'Haupt', start: 'home' }],
      nodes: [
        { id: 'home', type: 'screen', title: 'Start', source: 'derived' },
        { id: 'about', type: 'screen', title: 'Über', flow: 'main', source: 'derived' },
      ],
      edges: [],
    };
    const segments = segmentGraph(small, 'flow');
    // The start node counts towards the flow ⇒ no _misc segment.
    expect(segments.map((s) => s.id)).toEqual(['main']);
    expect(segments[0]!.nodes.map((n) => n.id)).toEqual(['about', 'home']);
  });

  it('omits _misc when all nodes are assigned to a flow', () => {
    const covered: JourneyGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => ({ ...n, flow: n.flow ?? 'auth' })),
    };
    expect(segmentGraph(covered, 'flow').map((s) => s.id)).toEqual(['auth', 'billing']);
  });
});

describe('segmentGraph — screen granularity', () => {
  it('creates one segment per screen node in id order; non-screens only as exit targets', () => {
    const segments = segmentGraph(graph, 'screen');
    expect(segments.map((s) => s.id)).toEqual([
      'dashboard',
      'invoices',
      'login',
      'register',
      'settings',
    ]);
    expect(segments.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
    expect(segments.every((s) => s.kind === 'screen')).toBe(true);
    // The decision node "gate" has no segment of its own.
    expect(segments.find((s) => s.id === 'gate')).toBeUndefined();
  });

  it('contains exactly the screen as its node; outgoing edges only end up in exits (no duplicates)', () => {
    const login = segmentGraph(graph, 'screen').find((s) => s.id === 'login')!;
    expect(login.title).toBe('Login');
    expect(login.nodes.map((n) => n.id)).toEqual(['login']);
    // Regression: edges and exits must be disjoint (contracts.ts: exits = edges
    // leaving the segment) — otherwise duplicate edges in the Mermaid diagram and prompt.
    expect(login.edges).toEqual([]);
    expect(login.exits).toEqual([
      { edge: graph.edges[1], toTitle: 'Eingeloggt?' },
      { edge: graph.edges[0], toTitle: 'Registrieren' },
    ]);
  });

  it('keeps self-loops in edges and does not list them as exits', () => {
    const loop: JourneyGraph = {
      schemaVersion: '1.0',
      flows: [],
      nodes: [
        { id: 'home', type: 'screen', title: 'Start', source: 'derived' },
        { id: 'about', type: 'screen', title: 'Über', source: 'derived' },
      ],
      edges: [
        { id: 'e_home_home', from: 'home', to: 'home', trigger: 'refresh', source: 'derived' },
        { id: 'e_home_about', from: 'home', to: 'about', trigger: 'tap', source: 'derived' },
      ],
    };
    const home = segmentGraph(loop, 'screen').find((s) => s.id === 'home')!;
    expect(home.edges.map((e) => e.id)).toEqual(['e_home_home']);
    expect(home.exits).toEqual([{ edge: loop.edges[1], toTitle: 'Über' }]);
  });

  it('returns segments without outgoing edges with empty edges/exits', () => {
    const invoices = segmentGraph(graph, 'screen').find((s) => s.id === 'invoices')!;
    expect(invoices.edges).toEqual([]);
    expect(invoices.exits).toEqual([]);
  });
});
