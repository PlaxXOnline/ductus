import { describe, expect, it } from 'vitest';
import type { JourneyGraph } from '@ductus/schema';
import {
  canonicalStringify,
  canonicalizeGraph,
  serializeGraph,
} from '../../src/graph/canonical-json.js';

function sampleGraph(): JourneyGraph {
  return {
    schemaVersion: '1.0',
    app: { name: 'MyApp', platforms: ['web', 'android', 'ios'], locale: 'de' },
    flows: [
      { id: 'zeta', title: 'Zeta', start: 'login' },
      { id: 'auth', title: 'Auth', start: 'login' },
    ],
    nodes: [
      {
        id: 'settings',
        type: 'screen',
        title: 'Einstellungen',
        source: 'derived',
        tags: ['zulu', 'alpha'],
      },
      { id: 'login', type: 'screen', title: 'Anmeldung', source: 'annotation' },
    ],
    edges: [
      { id: 'e2', from: 'login', to: 'settings', source: 'derived' },
      { id: 'e1', from: 'settings', to: 'login', source: 'annotation' },
    ],
    meta: {
      generatedAt: '2026-07-08T00:00:00Z',
      adapters: [
        { name: 'typescript', version: '0.2.0' },
        { name: 'dart', version: '0.1.0' },
      ],
    },
  };
}

describe('canonicalStringify', () => {
  it('sorts object keys recursively and lexicographically', () => {
    const result = canonicalStringify({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } });
    expect(result).toBe(
      '{\n' +
        '  "a": {\n' +
        '    "c": [\n' +
        '      {\n' +
        '        "y": 2,\n' +
        '        "z": 1\n' +
        '      }\n' +
        '    ],\n' +
        '    "d": 2\n' +
        '  },\n' +
        '  "b": 1\n' +
        '}\n',
    );
  });

  it('ends with exactly one LF and uses 2-space indentation', () => {
    const result = canonicalStringify({ a: 1 });
    expect(result.endsWith('}\n')).toBe(true);
    expect(result.endsWith('}\n\n')).toBe(false);
    expect(result).toContain('\n  "a": 1\n');
    expect(result).not.toContain('\r');
  });

  it('handles umlauts and Unicode stably', () => {
    const result = canonicalStringify({ ü: 'Grüße', a: 'Straße 😀' });
    // "a" (0x61) < "ü" (0xFC) in code-unit order
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"ü"'));
    expect(result).toContain('Grüße');
    expect(result).toContain('😀');
    expect(JSON.parse(result)).toEqual({ a: 'Straße 😀', ü: 'Grüße' });
  });

  it('does NOT reorder arrays (ordering is the canonicalization step’s job)', () => {
    expect(canonicalStringify(['b', 'a'])).toBe('[\n  "b",\n  "a"\n]\n');
  });
});

describe('canonicalizeGraph', () => {
  it('sorts flows/nodes/edges by id, tags and platforms, adapters by name', () => {
    const canonical = canonicalizeGraph(sampleGraph());
    expect(canonical.flows.map((f) => f.id)).toEqual(['auth', 'zeta']);
    expect(canonical.nodes.map((n) => n.id)).toEqual(['login', 'settings']);
    expect(canonical.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(canonical.nodes[1]?.tags).toEqual(['alpha', 'zulu']);
    expect(canonical.app?.platforms).toEqual(['android', 'ios', 'web']);
    expect(canonical.meta?.adapters?.map((a) => a.name)).toEqual(['dart', 'typescript']);
  });

  it('removes meta.generatedAt (byte stability: no timestamp in the graph)', () => {
    const canonical = canonicalizeGraph(sampleGraph());
    expect(canonical.meta?.generatedAt).toBeUndefined();
    expect('generatedAt' in (canonical.meta ?? {})).toBe(false);
    expect(serializeGraph(sampleGraph())).not.toContain('generatedAt');
  });

  it('does not mutate the input', () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    canonicalizeGraph(graph);
    serializeGraph(graph);
    expect(graph).toEqual(before);
  });

  it('omits optional sections instead of setting undefined', () => {
    const minimal: JourneyGraph = { schemaVersion: '1.0', flows: [], nodes: [], edges: [] };
    const canonical = canonicalizeGraph(minimal);
    expect('app' in canonical).toBe(false);
    expect('meta' in canonical).toBe(false);
  });
});

describe('serializeGraph', () => {
  it('is idempotent: serializing twice is byte-identical', () => {
    const once = serializeGraph(sampleGraph());
    const twice = serializeGraph(JSON.parse(once) as JourneyGraph);
    expect(twice).toBe(once);
  });

  it('yields the same result for equivalent but differently ordered inputs', () => {
    const shuffled = sampleGraph();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    shuffled.flows.reverse();
    expect(serializeGraph(shuffled)).toBe(serializeGraph(sampleGraph()));
  });
});
