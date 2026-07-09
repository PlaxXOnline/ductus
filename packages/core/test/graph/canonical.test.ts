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
  it('sortiert Objekt-Schlüssel rekursiv lexikographisch', () => {
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

  it('endet mit genau einem LF und nutzt 2-Space-Indent', () => {
    const result = canonicalStringify({ a: 1 });
    expect(result.endsWith('}\n')).toBe(true);
    expect(result.endsWith('}\n\n')).toBe(false);
    expect(result).toContain('\n  "a": 1\n');
    expect(result).not.toContain('\r');
  });

  it('behandelt Umlaute und Unicode stabil', () => {
    const result = canonicalStringify({ ü: 'Grüße', a: 'Straße 😀' });
    // "a" (0x61) < "ü" (0xFC) in Code-Unit-Ordnung
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"ü"'));
    expect(result).toContain('Grüße');
    expect(result).toContain('😀');
    expect(JSON.parse(result)).toEqual({ a: 'Straße 😀', ü: 'Grüße' });
  });

  it('sortiert Arrays NICHT um (Reihenfolge ist Sache der Kanonisierung)', () => {
    expect(canonicalStringify(['b', 'a'])).toBe('[\n  "b",\n  "a"\n]\n');
  });
});

describe('canonicalizeGraph', () => {
  it('sortiert flows/nodes/edges nach id, tags und platforms, adapters nach name', () => {
    const canonical = canonicalizeGraph(sampleGraph());
    expect(canonical.flows.map((f) => f.id)).toEqual(['auth', 'zeta']);
    expect(canonical.nodes.map((n) => n.id)).toEqual(['login', 'settings']);
    expect(canonical.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(canonical.nodes[1]?.tags).toEqual(['alpha', 'zulu']);
    expect(canonical.app?.platforms).toEqual(['android', 'ios', 'web']);
    expect(canonical.meta?.adapters?.map((a) => a.name)).toEqual(['dart', 'typescript']);
  });

  it('entfernt meta.generatedAt (DD §B.1)', () => {
    const canonical = canonicalizeGraph(sampleGraph());
    expect(canonical.meta?.generatedAt).toBeUndefined();
    expect('generatedAt' in (canonical.meta ?? {})).toBe(false);
    expect(serializeGraph(sampleGraph())).not.toContain('generatedAt');
  });

  it('mutiert die Eingabe nicht', () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    canonicalizeGraph(graph);
    serializeGraph(graph);
    expect(graph).toEqual(before);
  });

  it('lässt optionale Abschnitte weg, statt undefined zu setzen', () => {
    const minimal: JourneyGraph = { schemaVersion: '1.0', flows: [], nodes: [], edges: [] };
    const canonical = canonicalizeGraph(minimal);
    expect('app' in canonical).toBe(false);
    expect('meta' in canonical).toBe(false);
  });
});

describe('serializeGraph', () => {
  it('ist idempotent: doppelte Serialisierung ist byte-identisch', () => {
    const once = serializeGraph(sampleGraph());
    const twice = serializeGraph(JSON.parse(once) as JourneyGraph);
    expect(twice).toBe(once);
  });

  it('liefert für gleich bedeutende, anders geordnete Eingaben dasselbe Ergebnis', () => {
    const shuffled = sampleGraph();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    shuffled.flows.reverse();
    expect(serializeGraph(shuffled)).toBe(serializeGraph(sampleGraph()));
  });
});
