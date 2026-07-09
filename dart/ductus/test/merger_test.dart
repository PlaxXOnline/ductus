import 'package:ductus/adapter.dart';
import 'package:test/test.dart';

SourceRef ref(String file, int line) => SourceRef(file: file, line: line);

GraphNode screen(
  String id, {
  String? title,
  String? description,
  String source = SourceKind.annotation,
  SourceRef? at,
}) =>
    GraphNode(
      id: id,
      type: 'screen',
      title: title,
      description: description,
      source: source,
      sourceRef: at ?? ref('lib/a.dart', 1),
    );

void main() {
  group('mergeGraph — Nodes', () {
    test('annotation überschreibt derived feldweise', () {
      final result = mergeGraph(
        nodes: [
          screen('login',
              title: 'Login',
              description: 'Abgeleitet.',
              source: SourceKind.derived,
              at: ref('lib/router.dart', 3)),
          screen('login', title: 'Anmeldung', at: ref('lib/screens.dart', 10)),
        ],
        edges: [],
        flows: [],
      );

      final node = result.nodes.single;
      expect(node.title, 'Anmeldung'); // manuell gewinnt
      expect(node.description, 'Abgeleitet.'); // derived füllt Lücke
      expect(node.source, 'annotation');
      expect(node.sourceRef.file, 'lib/screens.dart');
    });

    test('zwei manuelle Quellen mit gleichem Wert sind ok', () {
      final result = mergeGraph(
        nodes: [
          screen('login', title: 'Anmeldung', at: ref('lib/a.dart', 1)),
          screen('login', title: 'Anmeldung', at: ref('lib/b.dart', 2)),
        ],
        edges: [],
        flows: [],
      );
      expect(result.nodes, hasLength(1));
    });

    test('zwei manuelle Quellen mit verschiedenen Werten sind ein Fehler '
        'mit beiden Quellen', () {
      expect(
        () => mergeGraph(
          nodes: [
            screen('login', title: 'A', at: ref('lib/a.dart', 2)),
            screen('login', title: 'B', at: ref('lib/b.dart', 5)),
          ],
          edges: [],
          flows: [],
        ),
        throwsA(isA<AdapterException>().having(
          (e) => e.messages.single,
          'message',
          allOf(contains('lib/a.dart:2'), contains('lib/b.dart:5'),
              contains('title')),
        )),
      );
    });
  });

  group('mergeGraph — Flows', () {
    test('manueller Flow überschreibt abgeleiteten feldweise', () {
      final result = mergeGraph(
        nodes: [],
        edges: [],
        flows: [
          GraphFlow(
              id: 'auth',
              title: 'Shell 0',
              start: 'home',
              source: SourceKind.derived,
              sourceRef: ref('lib/router.dart', 1)),
          GraphFlow(
              id: 'auth',
              title: 'Anmeldung',
              source: SourceKind.annotation,
              sourceRef: ref('lib/screens.dart', 1)),
        ],
      );

      final flow = result.flows.single;
      expect(flow.title, 'Anmeldung');
      expect(flow.start, 'home');
    });
  });

  group('mergeGraph — Edges', () {
    GraphEdge edge(
      String from,
      String to, {
      String? id,
      String? label,
      String? trigger,
      String source = SourceKind.annotation,
      SourceRef? at,
    }) =>
        GraphEdge(
          id: id,
          from: from,
          to: to,
          label: label,
          trigger: trigger,
          source: source,
          sourceRef: at ?? ref('lib/a.dart', 1),
        );

    test('generierte Ids e_<from>_<to> mit Kollisions-Suffix in '
        '(Datei, Zeile)-Reihenfolge', () {
      final result = mergeGraph(
        nodes: [],
        flows: [],
        edges: [
          edge('a', 'b', label: 'Zwei', at: ref('lib/b.dart', 1)),
          edge('a', 'b', label: 'Eins', at: ref('lib/a.dart', 1)),
          edge('a', 'b', label: 'Drei', at: ref('lib/b.dart', 9)),
        ],
      );

      String? idOf(String label) =>
          result.edges.firstWhere((e) => e.label == label).id;
      expect(idOf('Eins'), 'e_a_b');
      expect(idOf('Zwei'), 'e_a_b_2');
      expect(idOf('Drei'), 'e_a_b_3');
    });

    test('derived-Edge mit gleichem (from, to): manuelle gewinnt feldweise',
        () {
      final result = mergeGraph(
        nodes: [],
        flows: [],
        edges: [
          edge('login', 'dashboard',
              label: 'Anmelden', at: ref('lib/screens.dart', 4)),
          edge('login', 'dashboard',
              trigger: 'tap',
              source: SourceKind.derived,
              at: ref('lib/router.dart', 8)),
        ],
      );

      final merged = result.edges.single;
      expect(merged.label, 'Anmelden');
      expect(merged.trigger, 'tap'); // derived füllt fehlendes Feld
      expect(merged.source, 'annotation');
    });

    test('zwei manuelle Edges mit gleichem (from, to) bleiben beide', () {
      final result = mergeGraph(
        nodes: [],
        flows: [],
        edges: [
          edge('a', 'b', label: 'X', at: ref('lib/a.dart', 1)),
          edge('a', 'b', label: 'Y', at: ref('lib/a.dart', 5)),
        ],
      );
      expect(result.edges, hasLength(2));
    });

    test('gleiche explizite Id mit verschiedenen Werten ist ein Fehler', () {
      expect(
        () => mergeGraph(
          nodes: [],
          flows: [],
          edges: [
            edge('a', 'b', id: 'e1', label: 'X', at: ref('lib/a.dart', 1)),
            edge('a', 'c', id: 'e1', label: 'X', at: ref('lib/b.dart', 7)),
          ],
        ),
        throwsA(isA<AdapterException>().having(
          (e) => e.messages.single,
          'message',
          allOf(contains('lib/a.dart:1'), contains('lib/b.dart:7')),
        )),
      );
    });

    test('exakt gleiche derived-Edges werden dedupliziert', () {
      final result = mergeGraph(
        nodes: [],
        flows: [],
        edges: [
          edge('a', 'b',
              trigger: 'tap',
              source: SourceKind.derived,
              at: ref('lib/x.dart', 1)),
          edge('a', 'b',
              trigger: 'tap',
              source: SourceKind.derived,
              at: ref('lib/x.dart', 9)),
        ],
      );
      expect(result.edges, hasLength(1));
    });

    test('generierte Id weicht bestehender expliziter Id aus', () {
      final result = mergeGraph(
        nodes: [],
        flows: [],
        edges: [
          edge('a', 'b', id: 'e_a_b', label: 'X', at: ref('lib/a.dart', 1)),
          edge('a', 'b', label: 'Y', at: ref('lib/a.dart', 5)),
        ],
      );

      final generated = result.edges.firstWhere((e) => e.label == 'Y');
      expect(generated.id, 'e_a_b_2');
    });
  });
}
