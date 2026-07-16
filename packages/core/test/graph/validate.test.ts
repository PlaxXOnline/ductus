import { describe, expect, it } from 'vitest';
import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import { validateGraph } from '../../src/graph/validate.js';

function node(id: string, partial: Partial<JourneyNode> = {}): JourneyNode {
  return { id, type: 'screen', title: id, description: `Beschreibung ${id}`, source: 'annotation', ...partial };
}

function edge(id: string, from: string, to: string, partial: Partial<JourneyEdge> = {}): JourneyEdge {
  return { id, from, to, source: 'annotation', ...partial };
}

function graph(partial: Partial<JourneyGraph> = {}): JourneyGraph {
  return {
    schemaVersion: '1.0',
    flows: [{ id: 'auth', title: 'Auth', start: 'login' }],
    nodes: [node('login'), node('dashboard')],
    edges: [edge('e1', 'login', 'dashboard')],
    ...partial,
  };
}

describe('validateGraph — V6 (schema version)', () => {
  it('accepts major 1 (including higher minors)', () => {
    expect(validateGraph(graph()).errors).toEqual([]);
    expect(validateGraph(graph({ schemaVersion: '1.7' })).errors).toEqual([]);
  });

  it('rejects major 2 with exactly one V6 error and checks nothing else', () => {
    // Deliberately broken further (dangling edge) — must NOT be reported
    const result = validateGraph(graph({ schemaVersion: '2.0', edges: [edge('e1', 'login', 'nirgendwo')] }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rule).toBe('V6');
    expect(result.warnings).toEqual([]);
  });
});

describe('validateGraph — structure (SCHEMA/V4)', () => {
  it('reports a missing title on screen/decision as V4 with nodeId', () => {
    const broken = graph({ nodes: [node('login'), { id: 'x', type: 'decision', source: 'derived' }] });
    const result = validateGraph(broken);
    const v4 = result.errors.filter((e) => e.rule === 'V4');
    expect(v4).toHaveLength(1);
    expect(v4[0]).toMatchObject({ severity: 'error', nodeId: 'x' });
    expect(v4[0]?.message).toContain('title');
  });

  it('reports a missing label on action as V4', () => {
    const broken = graph({
      nodes: [node('login'), node('dashboard'), { id: 'a', type: 'action', source: 'annotation' }],
    });
    const v4 = validateGraph(broken).errors.filter((e) => e.rule === 'V4');
    expect(v4).toHaveLength(1);
    expect(v4[0]).toMatchObject({ nodeId: 'a' });
    expect(v4[0]?.message).toContain('label');
  });

  it('reports remaining structural errors as SCHEMA and aborts before integrity checks', () => {
    const broken = graph({
      // trigger outside the enum AND dangling from — only SCHEMA may appear
      edges: [{ id: 'e1', from: 'weg', to: 'dashboard', source: 'annotation', trigger: 'wink' } as unknown as JourneyEdge],
    });
    const result = validateGraph(broken);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => e.rule === 'SCHEMA')).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('a valid structure produces no SCHEMA/V4 errors', () => {
    const result = validateGraph(graph());
    expect(result.errors).toEqual([]);
  });
});

describe('validateGraph — V1 (dangling edges)', () => {
  it('reports from/to pointing at non-existent nodes as an error per edge', () => {
    const result = validateGraph(graph({ edges: [edge('e1', 'login', 'geist')] }));
    const v1 = result.errors.filter((e) => e.rule === 'V1');
    expect(v1).toHaveLength(1);
    expect(v1[0]).toMatchObject({ edgeId: 'e1', severity: 'error' });
    expect(v1[0]?.message).toContain('geist');
  });

  it('reports nothing when both endpoints exist', () => {
    expect(validateGraph(graph()).errors.filter((e) => e.rule === 'V1')).toEqual([]);
  });
});

describe('validateGraph — V2 (unique ids)', () => {
  it('reports duplicate node/edge/flow ids', () => {
    const result = validateGraph(
      graph({
        nodes: [node('login'), node('login'), node('dashboard')],
        edges: [edge('e1', 'login', 'dashboard'), edge('e1', 'dashboard', 'login')],
        flows: [
          { id: 'auth', title: 'A', start: 'login' },
          { id: 'auth', title: 'A', start: 'login' },
        ],
      }),
    );
    const v2 = result.errors.filter((e) => e.rule === 'V2');
    expect(v2).toHaveLength(3);
    expect(v2.map((e) => e.nodeId ?? e.edgeId ?? e.flowId)).toEqual(
      expect.arrayContaining(['login', 'e1', 'auth']),
    );
  });

  it('reports nothing when ids are unique', () => {
    expect(validateGraph(graph()).errors.filter((e) => e.rule === 'V2')).toEqual([]);
  });
});

describe('validateGraph — V3 (flow.start)', () => {
  it('reports a non-existent start', () => {
    const result = validateGraph(graph({ flows: [{ id: 'auth', title: 'A', start: 'geist' }] }));
    const v3 = result.errors.filter((e) => e.rule === 'V3');
    expect(v3).toHaveLength(1);
    expect(v3[0]).toMatchObject({ flowId: 'auth' });
  });

  it('reports a start that is not a screen', () => {
    const result = validateGraph(
      graph({
        nodes: [node('login'), node('dashboard'), node('act', { type: 'action', label: 'Los' })],
        flows: [{ id: 'auth', title: 'A', start: 'act' }],
      }),
    );
    const v3 = result.errors.filter((e) => e.rule === 'V3');
    expect(v3).toHaveLength(1);
    expect(v3[0]?.message).toContain('action');
  });

  it('accepts a screen start', () => {
    expect(validateGraph(graph()).errors.filter((e) => e.rule === 'V3')).toEqual([]);
  });
});

describe('validateGraph — V5 (warnings)', () => {
  it('warns about unreachable nodes (no incoming edge, no flow start)', () => {
    const result = validateGraph(graph({ nodes: [node('login'), node('dashboard'), node('waise')] }));
    const unreachable = result.warnings.filter((w) => w.nodeId === 'waise');
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0]?.message).toContain('unreachable');
    // login is a flow start, dashboard has an incoming edge — no warning for those
    expect(result.warnings.some((w) => w.message.includes('unreachable') && w.nodeId !== 'waise')).toBe(false);
  });

  it('warns about nodes without a description', () => {
    const stripped: JourneyNode = { id: 'login', type: 'screen', title: 'Login', source: 'derived' };
    const result = validateGraph(graph({ nodes: [stripped, node('dashboard')] }));
    const noDesc = result.warnings.filter((w) => w.message.includes('description'));
    expect(noDesc).toHaveLength(1);
    expect(noDesc[0]?.nodeId).toBe('login');
  });

  it('warns about cycles without a condition on any cycle edge', () => {
    const result = validateGraph(
      graph({
        flows: [],
        edges: [edge('e1', 'login', 'dashboard'), edge('e2', 'dashboard', 'login')],
      }),
    );
    const cycles = result.warnings.filter((w) => w.message.includes('Cycle'));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.message).toContain('"dashboard"');
    expect(cycles[0]?.message).toContain('"login"');
  });

  it('does NOT warn when one cycle edge carries a condition', () => {
    const result = validateGraph(
      graph({
        flows: [],
        edges: [
          edge('e1', 'login', 'dashboard'),
          edge('e2', 'dashboard', 'login', { condition: 'Sitzung abgelaufen' }),
        ],
      }),
    );
    expect(result.warnings.filter((w) => w.message.includes('Cycle'))).toEqual([]);
  });

  it('detects self-loops as a cycle', () => {
    const result = validateGraph(
      graph({ edges: [edge('e1', 'login', 'dashboard'), edge('e2', 'dashboard', 'dashboard')] }),
    );
    const cycles = result.warnings.filter((w) => w.message.includes('Cycle'));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodeId).toBe('dashboard');
  });

  it('a complete graph produces no warnings', () => {
    expect(validateGraph(graph()).warnings).toEqual([]);
  });
});

describe('validateGraph — deterministic sorting', () => {
  it('sorts issues by rule, then affected id — stable across input orders', () => {
    const build = (reversed: boolean): JourneyGraph => {
      const nodes = [node('b-screen'), node('a-screen'), node('login'), node('dashboard')];
      const edges = [edge('e9', 'login', 'geist'), edge('e1', 'login', 'phantom')];
      return graph({
        nodes: reversed ? [...nodes].reverse() : nodes,
        edges: reversed ? [...edges].reverse() : edges,
        flows: [
          { id: 'auth', title: 'A', start: 'login' },
          { id: 'zz', title: 'Z', start: 'geist' },
        ],
      });
    };

    const a = validateGraph(build(false));
    const b = validateGraph(build(true));
    expect(a).toEqual(b);

    // errors: V1 before V3, within V1 sorted by edgeId
    expect(a.errors.map((e) => [e.rule, e.nodeId ?? e.edgeId ?? e.flowId])).toEqual([
      ['V1', 'e1'],
      ['V1', 'e9'],
      ['V3', 'zz'],
    ]);
    // warnings sorted by nodeId
    const unreachable = a.warnings.filter((w) => w.message.includes('unreachable'));
    expect(unreachable.map((w) => w.nodeId)).toEqual(['a-screen', 'b-screen', 'dashboard']);
  });
});
