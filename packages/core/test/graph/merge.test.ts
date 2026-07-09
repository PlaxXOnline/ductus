import { describe, expect, it } from 'vitest';
import type { JourneyEdge, JourneyGraph, JourneyNode } from '@ductus/schema';
import { SCHEMA_VERSION } from '@ductus/schema';
import { MergeError, mergeGraphs } from '../../src/graph/merge.js';

function graph(partial: Partial<JourneyGraph>): JourneyGraph {
  return { schemaVersion: '1.0', flows: [], nodes: [], edges: [], ...partial };
}

function node(id: string, partial: Partial<JourneyNode> = {}): JourneyNode {
  return { id, type: 'screen', title: id, source: 'annotation', ...partial };
}

function edge(id: string, from: string, to: string, partial: Partial<JourneyEdge> = {}): JourneyEdge {
  return { id, from, to, source: 'annotation', ...partial };
}

function expectMergeError(fn: () => unknown): MergeError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MergeError);
    return error as MergeError;
  }
  throw new Error('MergeError erwartet, aber nichts geworfen');
}

describe('mergeGraphs — Nodes', () => {
  it('annotation überschreibt derived feldweise; Lücken bleiben von derived gefüllt', () => {
    const derived = graph({
      nodes: [
        node('login', {
          source: 'derived',
          title: 'Login',
          description: 'Aus dem Router abgeleitet.',
          sourceRef: { file: 'lib/router.dart', line: 3 },
        }),
      ],
    });
    const annotated = graph({
      nodes: [
        node('login', {
          title: 'Anmeldung',
          sourceRef: { file: 'lib/login.dart', line: 12, symbol: 'LoginScreen' },
        }),
      ],
    });

    const merged = mergeGraphs([derived, annotated]);
    expect(merged.nodes).toHaveLength(1);
    const login = merged.nodes[0]!;
    expect(login.title).toBe('Anmeldung'); // annotation gewinnt
    expect(login.description).toBe('Aus dem Router abgeleitet.'); // Lücke aus derived
    expect(login.source).toBe('annotation'); // höchstpräzedente Quelle
    expect(login.sourceRef).toEqual({ file: 'lib/login.dart', line: 12, symbol: 'LoginScreen' });
  });

  it('zwei manuelle Quellen mit unterschiedlichen Werten werfen MergeError mit beiden sourceRefs', () => {
    const a = graph({
      nodes: [node('login', { title: 'Anmeldung', sourceRef: { file: 'lib/a.dart', line: 1 } })],
    });
    const b = graph({
      nodes: [node('login', { title: 'Einloggen', sourceRef: { file: 'lib/b.dart', line: 8 } })],
    });

    const error = expectMergeError(() => mergeGraphs([a, b]));
    expect(error.conflicts).toHaveLength(1);
    const conflict = error.conflicts[0]!;
    expect(conflict).toMatchObject({ kind: 'node', id: 'login', field: 'title' });
    expect(conflict.a.sourceRef).toEqual({ file: 'lib/a.dart', line: 1 });
    expect(conflict.b.sourceRef).toEqual({ file: 'lib/b.dart', line: 8 });
    // Message nennt beide Quellen menschenlesbar (file:line)
    expect(error.message).toContain('lib/a.dart:1');
    expect(error.message).toContain('lib/b.dart:8');
    expect(error.message).toContain('"login"');
  });

  it('sammelt ALLE Konflikte, bevor geworfen wird', () => {
    const a = graph({
      nodes: [node('login', { title: 'A' }), node('home', { title: 'H1' })],
    });
    const b = graph({
      nodes: [node('login', { title: 'B' }), node('home', { title: 'H2' })],
    });
    const error = expectMergeError(() => mergeGraphs([a, b]));
    expect(error.conflicts.map((c) => c.id).sort()).toEqual(['home', 'login']);
  });

  it('gleicher Wert aus zwei manuellen Quellen ist kein Konflikt', () => {
    const a = graph({ nodes: [node('login', { title: 'Anmeldung', tags: ['auth'] })] });
    const b = graph({ nodes: [node('login', { title: 'Anmeldung', tags: ['auth'] })] });
    const merged = mergeGraphs([a, b]);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.title).toBe('Anmeldung');
  });

  it('derived+derived: erster gewinnt pro Feld, Lücken werden aufgefüllt, kein Fehler', () => {
    const a = graph({
      nodes: [node('login', { source: 'derived', title: 'Login (go_router)' })],
    });
    const b = graph({
      nodes: [
        node('login', { source: 'derived', title: 'Login (auto_route)', description: 'Zweiter.' }),
      ],
    });
    const merged = mergeGraphs([a, b]);
    expect(merged.nodes[0]?.title).toBe('Login (go_router)');
    expect(merged.nodes[0]?.description).toBe('Zweiter.');
    expect(merged.nodes[0]?.source).toBe('derived');
  });

  it('dedupliziert auch Duplikate innerhalb EINES Graphen', () => {
    const single = graph({
      nodes: [
        node('login', { source: 'derived', title: 'Login' }),
        node('login', { title: 'Anmeldung' }),
      ],
    });
    const merged = mergeGraphs([single]);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.title).toBe('Anmeldung');
  });
});

describe('mergeGraphs — Edges', () => {
  it('merged Edges mit gleicher id wie Nodes (annotation > derived)', () => {
    const a = graph({
      nodes: [node('login'), node('dash')],
      edges: [edge('e1', 'login', 'dash', { source: 'derived', trigger: 'auto' })],
    });
    const b = graph({
      edges: [edge('e1', 'login', 'dash', { label: 'Anmelden' })],
    });
    const merged = mergeGraphs([a, b]);
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({
      id: 'e1',
      label: 'Anmelden',
      trigger: 'auto',
      source: 'annotation',
    });
  });

  it('derived-Edge mit gleichem (from, to) wie annotation-Edge entfällt; annotation erbt fehlende Felder', () => {
    const derived = graph({
      nodes: [node('login', { source: 'derived' }), node('dash', { source: 'derived' })],
      edges: [edge('e_login_dash', 'login', 'dash', { source: 'derived', trigger: 'auto' })],
    });
    const annotated = graph({
      edges: [edge('submit-login', 'login', 'dash', { label: 'Anmelden' })],
    });

    const merged = mergeGraphs([derived, annotated]);
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({
      id: 'submit-login',
      from: 'login',
      to: 'dash',
      label: 'Anmelden',
      trigger: 'auto', // geerbt von der verdrängten derived-Edge
      source: 'annotation',
    });
  });

  it('zwei manuelle Edges mit gleichem (from, to) und verschiedenen ids bleiben beide (parallel)', () => {
    const merged = mergeGraphs([
      graph({
        nodes: [node('login'), node('dash')],
        edges: [
          edge('via-button', 'login', 'dash', { trigger: 'tap' }),
          edge('via-enter', 'login', 'dash', { trigger: 'submit' }),
        ],
      }),
    ]);
    expect(merged.edges.map((e) => e.id).sort()).toEqual(['via-button', 'via-enter']);
  });

  it('manueller Konflikt auf einer Edge (gleiche id, verschiedene labels) wirft', () => {
    const a = graph({ edges: [edge('e1', 'login', 'dash', { label: 'Weiter' })] });
    const b = graph({ edges: [edge('e1', 'login', 'dash', { label: 'Los' })] });
    const error = expectMergeError(() => mergeGraphs([a, b]));
    expect(error.conflicts[0]).toMatchObject({ kind: 'edge', id: 'e1', field: 'label' });
  });
});

describe('mergeGraphs — Flows, app, meta', () => {
  it('merged Flows wie Nodes: Lücken auffüllen, Widerspruch wirft', () => {
    const a = graph({ flows: [{ id: 'auth', title: 'Anmeldung', start: 'login' }] });
    const b = graph({
      flows: [{ id: 'auth', title: 'Anmeldung', start: 'login', description: 'Alles rund ums Konto.' }],
    });
    const merged = mergeGraphs([a, b]);
    expect(merged.flows).toHaveLength(1);
    expect(merged.flows[0]?.description).toBe('Alles rund ums Konto.');

    const c = graph({ flows: [{ id: 'auth', title: 'Anmeldung', start: 'welcome' }] });
    const error = expectMergeError(() => mergeGraphs([a, c]));
    expect(error.conflicts[0]).toMatchObject({ kind: 'flow', id: 'auth', field: 'start' });
  });

  it('vereinigt meta.adapters mit Dedupe über name+version, sortiert nach name', () => {
    const a = graph({ meta: { adapters: [{ name: 'dart', version: '0.1.0' }] } });
    const b = graph({
      meta: {
        adapters: [
          { name: 'typescript', version: '0.2.0' },
          { name: 'dart', version: '0.1.0' },
        ],
      },
    });
    const merged = mergeGraphs([a, b]);
    expect(merged.meta?.adapters).toEqual([
      { name: 'dart', version: '0.1.0' },
      { name: 'typescript', version: '0.2.0' },
    ]);
  });

  it('setzt schemaVersion auf SCHEMA_VERSION und lässt options.app gewinnen', () => {
    const a = graph({ app: { name: 'AusGraph' } });
    expect(mergeGraphs([a]).schemaVersion).toBe(SCHEMA_VERSION);
    expect(mergeGraphs([a]).app).toEqual({ name: 'AusGraph' });
    expect(mergeGraphs([a], { app: { name: 'AusOptions' } }).app).toEqual({ name: 'AusOptions' });
    expect('app' in mergeGraphs([graph({})])).toBe(false);
  });

  it('liefert deterministisch nach id sortierte Sammlungen', () => {
    const merged = mergeGraphs([
      graph({
        nodes: [node('zeta'), node('alpha')],
        edges: [edge('e2', 'zeta', 'alpha'), edge('e1', 'alpha', 'zeta')],
        flows: [
          { id: 'z', title: 'Z', start: 'zeta' },
          { id: 'a', title: 'A', start: 'alpha' },
        ],
      }),
    ]);
    expect(merged.nodes.map((n) => n.id)).toEqual(['alpha', 'zeta']);
    expect(merged.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(merged.flows.map((f) => f.id)).toEqual(['a', 'z']);
  });
});
