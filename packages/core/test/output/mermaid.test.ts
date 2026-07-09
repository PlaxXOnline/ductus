import { describe, expect, it } from 'vitest';
import type { JourneyEdge, JourneyFlow, JourneyGraph, JourneyNode } from '@ductus/schema';
import type { GraphSegment } from '../../src/contracts.js';
import { graphToMermaid, segmentToJourney, segmentToMermaid } from '../../src/output/mermaid.js';

const nodes: JourneyNode[] = [
  { id: 'login', type: 'screen', title: 'Anmeldung "Start"', source: 'annotation' },
  { id: 'auth-check', type: 'decision', title: 'Eingeloggt?', source: 'derived' },
  { id: 'do-login', type: 'action', label: 'Anmelden', source: 'annotation' },
];

const edges: JourneyEdge[] = [
  { id: 'e2', from: 'auth-check', to: 'do-login', label: 'Ja', condition: 'Sitzung aktiv', source: 'derived' },
  { id: 'e1', from: 'login', to: 'auth-check', trigger: 'submit', source: 'annotation' },
];

function makeSegment(overrides: Partial<GraphSegment> = {}): GraphSegment {
  return {
    id: 'auth',
    kind: 'flow',
    title: 'Anmeldung',
    order: 0,
    nodes,
    edges,
    exits: [
      {
        edge: { id: 'x1', from: 'do-login', to: 'dashboard', trigger: 'auto', source: 'derived' },
        toTitle: 'Dashboard',
      },
    ],
    ...overrides,
  };
}

describe('segmentToMermaid', () => {
  it('rendert Shapes je Node-Typ und beginnt mit flowchart TD', () => {
    const out = segmentToMermaid(makeSegment());
    const lines = out.split('\n');
    expect(lines[0]).toBe('flowchart TD');
    expect(out).toContain('login["Anmeldung #quot;Start#quot;"]'); // screen + Escaping
    expect(out).toContain('auth_check{"Eingeloggt?"}'); // decision
    expect(out).toContain('do_login(["Anmelden"])'); // action
  });

  it('beschriftet Kanten mit label bzw. trigger und hängt condition an', () => {
    const out = segmentToMermaid(makeSegment());
    expect(out).toContain('login -->|submit| auth_check'); // trigger als Fallback
    expect(out).toContain('auth_check -->|Ja / Sitzung aktiv| do_login'); // label + condition
  });

  it('rendert exits als gestrichelte Kanten zum Ziel-Titel', () => {
    const out = segmentToMermaid(makeSegment());
    expect(out).toContain('do_login -.->|auto| dashboard["Dashboard"]');
  });

  it('rendert Kanten ohne label/trigger/condition ohne Beschriftung', () => {
    const segment = makeSegment({
      edges: [{ id: 'e3', from: 'login', to: 'auth-check', source: 'derived' }],
      exits: [],
    });
    expect(segmentToMermaid(segment)).toContain('login --> auth_check');
  });

  it('löst Kollisionen sanitisierter Ids deterministisch per Suffix auf', () => {
    const segment = makeSegment({
      nodes: [
        { id: 'a-b', type: 'screen', title: 'A', source: 'derived' },
        { id: 'a_b', type: 'screen', title: 'B', source: 'derived' },
      ],
      edges: [{ id: 'e1', from: 'a-b', to: 'a_b', trigger: 'tap', source: 'derived' }],
      exits: [],
    });
    const out = segmentToMermaid(segment);
    expect(out).toContain('a_b["A"]'); // 'a-b' kommt in Sortierung zuerst
    expect(out).toContain('a_b_2["B"]');
    expect(out).toContain('a_b -->|tap| a_b_2');
  });

  it('ist deterministisch unabhängig von der Eingabereihenfolge', () => {
    const a = segmentToMermaid(makeSegment());
    const b = segmentToMermaid(
      makeSegment({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }),
    );
    expect(a).toBe(b);
  });
});

describe('segmentToJourney', () => {
  function flowSegment(
    segNodes: JourneyNode[],
    segEdges: JourneyEdge[],
    flowOverride?: JourneyFlow,
  ): GraphSegment {
    const flow = flowOverride ?? { id: 'auth', title: 'Anmeldung', start: 'login' };
    return {
      id: flow.id,
      kind: 'flow',
      title: flow.title,
      order: 1,
      flow,
      nodes: segNodes,
      edges: segEdges,
      exits: [],
    };
  }

  const linearNodes: JourneyNode[] = [
    { id: 'login', type: 'screen', title: 'Login', source: 'annotation' },
    { id: 'submit', type: 'action', label: 'Absenden', source: 'annotation' },
    { id: 'dashboard', type: 'screen', title: 'Dashboard', source: 'derived' },
  ];
  const linearEdges: JourneyEdge[] = [
    { id: 'e1', from: 'login', to: 'submit', trigger: 'submit', source: 'annotation' },
    { id: 'e2', from: 'submit', to: 'dashboard', trigger: 'auto', source: 'derived' },
  ];

  it('rendert einen linearen Pfad als journey mit title, section und Score 3', () => {
    const out = segmentToJourney(flowSegment(linearNodes, linearEdges));
    expect(out).toBe(
      [
        'journey',
        '  title Anmeldung',
        '  section Hauptpfad',
        '    Login: 3',
        '    Absenden: 3',
        '    Dashboard: 3',
      ].join('\n'),
    );
  });

  it('wählt an einer decision die Kante ohne condition vor der mit condition', () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'check', type: 'decision', title: 'Eingeloggt?', source: 'derived' },
      { id: 'happy', type: 'screen', title: 'Happy', source: 'derived' },
      { id: 'sad', type: 'screen', title: 'Sad', source: 'derived' },
    ];
    // 'a0' hätte die kleinste id, trägt aber eine condition — 'z9' gewinnt (Regel 2 vor 3).
    const edges: JourneyEdge[] = [
      { id: 'e1', from: 'login', to: 'check', trigger: 'submit', source: 'derived' },
      { id: 'a0', from: 'check', to: 'sad', condition: 'Fehler', source: 'derived' },
      { id: 'z9', from: 'check', to: 'happy', source: 'derived' },
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('Happy: 3');
    expect(out).not.toContain('Sad: 3');
  });

  it('wählt bei sonst gleicher Priorität die Kante mit der kleinsten id', () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'a', type: 'screen', title: 'A', source: 'derived' },
      { id: 'b', type: 'screen', title: 'B', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [
      { id: 'e2', from: 'login', to: 'b', source: 'derived' },
      { id: 'e1', from: 'login', to: 'a', source: 'derived' },
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('A: 3');
    expect(out).not.toContain('B: 3');
  });

  it('meidet back-Kanten, solange eine andere Kante existiert (Regel 1 vor 2 und 3)', () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'zurueck', type: 'screen', title: 'Zurück', source: 'derived' },
      { id: 'vor', type: 'screen', title: 'Vorwärts', source: 'derived' },
    ];
    // back-Kante mit kleinster id und ohne condition — trotzdem gewinnt die Nicht-back-Kante.
    const edges: JourneyEdge[] = [
      { id: 'a0', from: 'login', to: 'zurueck', trigger: 'back', source: 'derived' },
      { id: 'z9', from: 'login', to: 'vor', condition: 'nur wenn', source: 'derived' },
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('Vorwärts: 3');
    expect(out).not.toContain('Zurück: 3');
  });

  it('terminiert bei Zyklen — besuchte Knoten werden nie wiederholt', () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'a', type: 'screen', title: 'A', source: 'derived' },
      { id: 'b', type: 'screen', title: 'B', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [
      { id: 'e1', from: 'login', to: 'a', source: 'derived' },
      { id: 'e2', from: 'a', to: 'b', source: 'derived' },
      { id: 'e3', from: 'b', to: 'login', source: 'derived' }, // Zyklus zurück zum Start
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out?.split('\n').filter((line) => line.endsWith(': 3'))).toEqual([
      '    Login: 3',
      '    A: 3',
      '    B: 3',
    ]);
  });

  it("escapet '#', ':' und ';' als Entities und ersetzt Zeilenumbrüche durch ein Leerzeichen", () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Start: #1', source: 'derived' },
      { id: 'next', type: 'screen', title: 'A;B\nC', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [{ id: 'e1', from: 'login', to: 'next', source: 'derived' }];
    const out = segmentToJourney(
      flowSegment(nodes, edges, { id: 'auth', title: 'Fluss: Anmeldung #2', start: 'login' }),
    );
    expect(out).toContain('  title Fluss#58; Anmeldung #35;2');
    expect(out).toContain('    Start#58; #35;1: 3');
    expect(out).toContain('    A#59;B C: 3');
  });

  it("entschärft Task-Labels, die mit 'journey', 'section' oder 'title' beginnen, per Entity fürs erste Zeichen", () => {
    // Am Zeilenanfang würde Mermaids Lexer diese Wörter als Statement lesen:
    // 'journey'/'section ' → Parse-Fehler, 'title ' überschreibt still den Diagramm-Titel.
    const nodes: JourneyNode[] = [
      { id: 'n1', type: 'screen', title: 'Journey starten', source: 'derived' },
      { id: 'n2', type: 'screen', title: 'section öffnen', source: 'derived' },
      { id: 'n3', type: 'screen', title: 'Title prüfen', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [
      { id: 'e1', from: 'n1', to: 'n2', source: 'derived' },
      { id: 'e2', from: 'n2', to: 'n3', source: 'derived' },
    ];
    const out = segmentToJourney(
      flowSegment(nodes, edges, { id: 'auth', title: 'Anmeldung', start: 'n1' }),
    );
    expect(out).toContain('    #74;ourney starten: 3');
    expect(out).toContain('    #115;ection öffnen: 3');
    expect(out).toContain('    #84;itle prüfen: 3');
  });

  it("entschärft Task-Labels, die mit '%%' (Mermaid-Kommentar) beginnen", () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'n2', type: 'screen', title: '%% Hinweis', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [{ id: 'e1', from: 'login', to: 'n2', source: 'derived' }];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('    #37;% Hinweis: 3');
  });

  it('fällt bei leerem oder nur aus Whitespace bestehendem Titel auf die Node-id zurück', () => {
    // title: '' erfüllt das Schema (V4 fordert nur Präsenz) — '    : 3' wäre aber invalide.
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'leer', type: 'screen', title: '', source: 'derived' },
      { id: 'blank', type: 'action', label: '   ', source: 'derived' },
    ];
    const edges: JourneyEdge[] = [
      { id: 'e1', from: 'login', to: 'leer', source: 'derived' },
      { id: 'e2', from: 'leer', to: 'blank', source: 'derived' },
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('    leer: 3');
    expect(out).toContain('    blank: 3');
    expect(out).not.toContain('    : 3');
  });

  it("behandelt condition: '' wie keine condition (konsistent zu edgeText und V5c)", () => {
    const nodes: JourneyNode[] = [
      { id: 'login', type: 'screen', title: 'Login', source: 'derived' },
      { id: 'check', type: 'decision', title: 'Eingeloggt?', source: 'derived' },
      { id: 'happy', type: 'screen', title: 'Happy', source: 'derived' },
      { id: 'sad', type: 'screen', title: 'Sad', source: 'derived' },
    ];
    // 'a0' hat die kleinste id, aber eine echte condition — 'z9' mit condition ''
    // ist effektiv bedingungslos und gewinnt (Regel 2 vor 3).
    const edges: JourneyEdge[] = [
      { id: 'e1', from: 'login', to: 'check', trigger: 'submit', source: 'derived' },
      { id: 'a0', from: 'check', to: 'sad', condition: 'nur im Fehlerfall', source: 'derived' },
      { id: 'z9', from: 'check', to: 'happy', condition: '', source: 'derived' },
    ];
    const out = segmentToJourney(flowSegment(nodes, edges));
    expect(out).toContain('Happy: 3');
    expect(out).not.toContain('Sad: 3');
  });

  it('liefert für screen- und misc-Segmente undefined', () => {
    const base = flowSegment(linearNodes, linearEdges);
    const screenSegment: GraphSegment = { ...base, kind: 'screen' };
    const { flow: _flow, ...withoutFlow } = base;
    const miscSegment: GraphSegment = { ...withoutFlow, kind: 'misc' };
    expect(segmentToJourney(screenSegment)).toBeUndefined();
    expect(segmentToJourney(miscSegment)).toBeUndefined();
  });

  it('liefert undefined, wenn der Hauptpfad weniger als 2 Knoten hat', () => {
    // Einzige ausgehende Kante zeigt aus dem Segment hinaus → Pfad = nur der Start.
    const segment = flowSegment(
      [{ id: 'login', type: 'screen', title: 'Login', source: 'derived' }],
      [{ id: 'e1', from: 'login', to: 'outside', source: 'derived' }],
    );
    expect(segmentToJourney(segment)).toBeUndefined();
  });

  it('ist bei Doppellauf byte-identisch und unabhängig von der Eingabereihenfolge (NFR2)', () => {
    const a = segmentToJourney(flowSegment(linearNodes, linearEdges));
    const b = segmentToJourney(
      flowSegment([...linearNodes].reverse(), [...linearEdges].reverse()),
    );
    expect(a).toBe(b);
    expect(segmentToJourney(flowSegment(linearNodes, linearEdges))).toBe(a);
  });
});

describe('graphToMermaid', () => {
  const graph: JourneyGraph = {
    schemaVersion: '1.0',
    flows: [],
    nodes,
    edges,
  };

  it('rendert alle Nodes und Edges sortiert', () => {
    const out = graphToMermaid(graph);
    const lines = out.split('\n');
    expect(lines).toEqual([
      'flowchart TD',
      '  auth_check{"Eingeloggt?"}',
      '  do_login(["Anmelden"])',
      '  login["Anmeldung #quot;Start#quot;"]',
      '  login -->|submit| auth_check',
      '  auth_check -->|Ja / Sitzung aktiv| do_login',
    ]);
  });

  it('ist deterministisch unabhängig von der Eingabereihenfolge', () => {
    const shuffled: JourneyGraph = {
      ...graph,
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
    };
    expect(graphToMermaid(shuffled)).toBe(graphToMermaid(graph));
  });
});
