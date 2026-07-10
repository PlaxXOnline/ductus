/**
 * Merge- & Präzedenzregeln — Semantik-Spiegel von
 * dart/ductus/test/merger_test.dart.
 */

import { describe, expect, it } from 'vitest';
import {
  AdapterException,
  SourceKind,
  type GraphEdge,
  type GraphFlow,
  type GraphNode,
  type SourceKindValue,
  type SourceRef,
} from '../src/graph-model.js';
import { mergeGraph } from '../src/merger.js';

const ref = (file: string, line: number): SourceRef => ({ file, line });

function screen(
  id: string,
  opts: {
    title?: string;
    description?: string;
    source?: SourceKindValue;
    at?: SourceRef;
  } = {},
): GraphNode {
  return {
    id,
    type: 'screen',
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    tags: [],
    source: opts.source ?? SourceKind.annotation,
    sourceRef: opts.at ?? ref('src/a.tsx', 1),
  };
}

function edge(
  from: string,
  to: string,
  opts: {
    id?: string;
    label?: string;
    trigger?: string;
    condition?: string;
    source?: SourceKindValue;
    at?: SourceRef;
  } = {},
): GraphEdge {
  return {
    ...(opts.id !== undefined ? { id: opts.id } : {}),
    from,
    to,
    ...(opts.trigger !== undefined ? { trigger: opts.trigger } : {}),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.condition !== undefined ? { condition: opts.condition } : {}),
    source: opts.source ?? SourceKind.annotation,
    sourceRef: opts.at ?? ref('src/a.tsx', 1),
  };
}

function flow(
  id: string,
  opts: {
    title?: string;
    start?: string;
    source?: SourceKindValue;
    at?: SourceRef;
  } = {},
): GraphFlow {
  return {
    id,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.start !== undefined ? { start: opts.start } : {}),
    source: opts.source ?? SourceKind.annotation,
    sourceRef: opts.at ?? ref('src/a.tsx', 1),
  };
}

/** Führt mergeGraph aus und liefert die erwartete AdapterException. */
function expectAdapterException(input: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  flows: GraphFlow[];
}): AdapterException {
  let caught: unknown;
  try {
    mergeGraph(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AdapterException);
  return caught as AdapterException;
}

describe('mergeGraph — Nodes', () => {
  it('annotation überschreibt derived feldweise', () => {
    const result = mergeGraph({
      nodes: [
        screen('login', {
          title: 'Login',
          description: 'Abgeleitet.',
          source: SourceKind.derived,
          at: ref('src/router.tsx', 3),
        }),
        screen('login', { title: 'Anmeldung', at: ref('src/screens.tsx', 10) }),
      ],
      edges: [],
      flows: [],
    });

    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.title).toBe('Anmeldung'); // manuell gewinnt
    expect(node.description).toBe('Abgeleitet.'); // derived füllt Lücke
    expect(node.source).toBe('annotation');
    expect(node.sourceRef.file).toBe('src/screens.tsx');
  });

  it('zwei manuelle Quellen mit gleichem Wert sind ok', () => {
    const result = mergeGraph({
      nodes: [
        screen('login', { title: 'Anmeldung', at: ref('src/a.tsx', 1) }),
        screen('login', { title: 'Anmeldung', at: ref('src/b.tsx', 2) }),
      ],
      edges: [],
      flows: [],
    });
    expect(result.nodes).toHaveLength(1);
  });

  it('zwei manuelle Quellen mit verschiedenen Werten sind ein Fehler mit beiden Quellen', () => {
    const exception = expectAdapterException({
      nodes: [
        screen('login', { title: 'A', at: ref('src/a.tsx', 2) }),
        screen('login', { title: 'B', at: ref('src/b.tsx', 5) }),
      ],
      edges: [],
      flows: [],
    });

    expect(exception.messages).toHaveLength(1);
    expect(exception.messages[0]).toContain('src/a.tsx:2');
    expect(exception.messages[0]).toContain('src/b.tsx:5');
    expect(exception.messages[0]).toContain('title');
  });

  it('tags-Konflikt formatiert Listen wie der Dart-Adapter: [a, b]', () => {
    const withTags = (tags: string[], at: SourceRef): GraphNode => ({
      ...screen('login', { title: 'Anmeldung', at }),
      tags,
    });
    const exception = expectAdapterException({
      nodes: [withTags(['a', 'b'], ref('src/a.tsx', 1)), withTags(['c'], ref('src/b.tsx', 4))],
      edges: [],
      flows: [],
    });

    expect(exception.messages[0]).toContain('"[a, b]" (src/a.tsx:1)');
    expect(exception.messages[0]).toContain('"[c]" (src/b.tsx:4)');
  });
});

describe('mergeGraph — Flows', () => {
  it('manueller Flow überschreibt abgeleiteten feldweise', () => {
    const result = mergeGraph({
      nodes: [],
      edges: [],
      flows: [
        flow('auth', {
          title: 'Shell 0',
          start: 'home',
          source: SourceKind.derived,
          at: ref('src/router.tsx', 1),
        }),
        flow('auth', { title: 'Anmeldung', at: ref('src/screens.tsx', 1) }),
      ],
    });

    expect(result.flows).toHaveLength(1);
    const merged = result.flows[0]!;
    expect(merged.title).toBe('Anmeldung');
    expect(merged.start).toBe('home');
  });
});

describe('mergeGraph — Edges', () => {
  it('generierte Ids e_<from>_<to> mit Kollisions-Suffix in (Datei, Zeile)-Reihenfolge', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { label: 'Zwei', at: ref('src/b.tsx', 1) }),
        edge('a', 'b', { label: 'Eins', at: ref('src/a.tsx', 1) }),
        edge('a', 'b', { label: 'Drei', at: ref('src/b.tsx', 9) }),
      ],
    });

    const idOf = (label: string): string | undefined =>
      result.edges.find((e) => e.label === label)?.id;
    expect(idOf('Eins')).toBe('e_a_b');
    expect(idOf('Zwei')).toBe('e_a_b_2');
    expect(idOf('Drei')).toBe('e_a_b_3');
  });

  it('derived-Edge mit gleichem (from, to): manuelle absorbiert trigger/label/condition', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('login', 'dashboard', { label: 'Anmelden', at: ref('src/screens.tsx', 4) }),
        edge('login', 'dashboard', {
          trigger: 'tap',
          condition: 'eingeloggt',
          source: SourceKind.derived,
          at: ref('src/router.tsx', 8),
        }),
      ],
    });

    expect(result.edges).toHaveLength(1);
    const merged = result.edges[0]!;
    expect(merged.label).toBe('Anmelden');
    expect(merged.trigger).toBe('tap'); // derived füllt fehlendes Feld
    expect(merged.condition).toBe('eingeloggt');
    expect(merged.source).toBe('annotation');
    expect(merged.sourceRef.file).toBe('src/screens.tsx');
  });

  it('zwei manuelle Edges mit gleichem (from, to) bleiben beide', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { label: 'X', at: ref('src/a.tsx', 1) }),
        edge('a', 'b', { label: 'Y', at: ref('src/a.tsx', 5) }),
      ],
    });
    expect(result.edges).toHaveLength(2);
  });

  it('Edges mit expliziter Id werden feldweise über die Id gemerged', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { id: 'e1', label: 'X', at: ref('src/a.tsx', 1) }),
        edge('a', 'b', { id: 'e1', trigger: 'submit', at: ref('src/b.tsx', 7) }),
      ],
    });

    expect(result.edges).toHaveLength(1);
    const merged = result.edges[0]!;
    expect(merged.id).toBe('e1');
    expect(merged.label).toBe('X');
    expect(merged.trigger).toBe('submit');
  });

  it('gleiche explizite Id mit verschiedenen Werten ist ein Fehler mit beiden Quellen', () => {
    const exception = expectAdapterException({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { id: 'e1', label: 'X', at: ref('src/a.tsx', 1) }),
        edge('a', 'c', { id: 'e1', label: 'X', at: ref('src/b.tsx', 7) }),
      ],
    });

    expect(exception.messages).toHaveLength(1);
    expect(exception.messages[0]).toContain('src/a.tsx:1');
    expect(exception.messages[0]).toContain('src/b.tsx:7');
  });

  it('exakt gleiche derived-Edges werden dedupliziert', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { trigger: 'tap', source: SourceKind.derived, at: ref('src/x.tsx', 1) }),
        edge('a', 'b', { trigger: 'tap', source: SourceKind.derived, at: ref('src/x.tsx', 9) }),
      ],
    });
    expect(result.edges).toHaveLength(1);
  });

  it('generierte Id weicht bestehender expliziter Id aus', () => {
    const result = mergeGraph({
      nodes: [],
      flows: [],
      edges: [
        edge('a', 'b', { id: 'e_a_b', label: 'X', at: ref('src/a.tsx', 1) }),
        edge('a', 'b', { label: 'Y', at: ref('src/a.tsx', 5) }),
      ],
    });

    const generated = result.edges.find((e) => e.label === 'Y');
    expect(generated?.id).toBe('e_a_b_2');
  });
});
