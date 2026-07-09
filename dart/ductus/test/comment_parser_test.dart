import 'package:ductus/adapter.dart';
import 'package:test/test.dart';

import 'test_util.dart';

void main() {
  group('parseComments', () {
    test('parst einen Screen-Block mit Escapes im Wert', () {
      final file = scanSource(r'''
// @journey:screen id="login" title="Sag \"Hallo\"" tags="auth, entry"
class LoginScreen {}
''');
      final warn = WarnLog();
      final errors = <String>[];
      final result = parseComments(file, warn.call, errors);

      expect(errors, isEmpty);
      expect(result.nodes, hasLength(1));
      final node = result.nodes.single;
      expect(node.id, 'login');
      expect(node.title, 'Sag "Hallo"');
      expect(node.tags, ['auth', 'entry']);
      expect(node.type, 'screen');
      expect(node.source, 'annotation');
      expect(node.sourceRef.file, 'lib/main.dart');
      expect(node.sourceRef.line, 1);
      expect(node.sourceRef.symbol, 'LoginScreen');
      expect(result.screenClassNames, {'LoginScreen': 'login'});
    });

    test('mehrzeilige Blöcke: Fortsetzung in Folge-Kommentarzeilen', () {
      final file = scanSource('''
// @journey:screen id="dashboard" title="Übersicht"
//   description="Zentrale Übersicht nach der Anmeldung."
//   flow="main"
class DashboardScreen {}
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      final node = result.nodes.single;
      expect(node.description, 'Zentrale Übersicht nach der Anmeldung.');
      expect(node.flow, 'main');
    });

    test('Block endet an Nicht-Kommentar-Zeile', () {
      final file = scanSource('''
// @journey:screen id="a" title="A"
var x = 1;
// description="gehört nicht mehr zum Block"
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.nodes.single.description, isNull);
    });

    test('Block endet an neuem @journey:-Block', () {
      final file = scanSource('''
// @journey:screen id="a" title="A"
// @journey:screen id="b" title="B"
class Foo {}
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.nodes.map((n) => n.id), ['a', 'b']);
    });

    test('unbekannte Keys: Warnung, Wert wird ignoriert', () {
      final file = scanSource('''
// @journey:screen id="a" title="A" farbe="blau"
class Foo {}
''');
      final warn = WarnLog();
      final errors = <String>[];
      final result = parseComments(file, warn.call, errors);

      expect(errors, isEmpty);
      expect(result.nodes.single.id, 'a');
      expect(warn.messages, hasLength(1));
      expect(warn.messages.single, contains('farbe'));
      expect(warn.messages.single, contains('lib/main.dart:1'));
    });

    test('fehlendes Pflichtfeld ist ein Fehler', () {
      final file = scanSource('''
// @journey:screen id="a"
class Foo {}
''');
      final errors = <String>[];
      parseComments(file, WarnLog().call, errors);

      expect(errors, hasLength(1));
      expect(errors.single, contains('title'));
      expect(errors.single, contains('lib/main.dart:1'));
    });

    test('flow-Block mit allen Pflichtfeldern', () {
      final file = scanSource('''
// @journey:flow id="auth" title="Anmeldung" start="login"
//   description="Alles rund um die Anmeldung."
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      final flow = result.flows.single;
      expect(flow.id, 'auth');
      expect(flow.start, 'login');
      expect(flow.description, 'Alles rund um die Anmeldung.');
    });

    test('action ohne from merkt sich die umschließende Klasse', () {
      final file = scanSource('''
// @journey:screen id="login" title="Anmeldung"
class LoginScreen {
  // @journey:action label="Anmelden" to="dashboard" trigger="submit"
  void onSubmit() {}
}
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      final action = result.actions.single;
      expect(action.from, isNull);
      expect(action.enclosingClassName, 'LoginScreen');
      expect(action.trigger, 'submit');
    });

    test('action ohne from und ohne umschließende Klasse ist ein Fehler', () {
      final file = scanSource('''
// @journey:action label="Anmelden" to="dashboard"
void onSubmit() {}
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(result.actions, isEmpty);
      expect(errors, hasLength(1));
      expect(errors.single, contains('lib/main.dart:1'));
      expect(errors.single, contains('from'));
    });

    test('from-Inferenz Ende-zu-Ende über runAdapter-Bausteine', () {
      // Kommentar-Screen oberhalb der Klasse + Action in der Klasse:
      // die Klasse ist als Screen bekannt, deren id wird zum from.
      final file = scanSource('''
// @journey:screen id="login" title="Anmeldung"
class LoginScreen {
  // @journey:action label="Anmelden" to="dashboard"
  void onSubmit() {}
}
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      final screenId =
          result.screenClassNames[result.actions.single.enclosingClassName];
      expect(screenId, 'login');
    });

    test('unbekannter Trigger: Warnung und Default tap', () {
      final file = scanSource('''
class LoginScreen {
  // @journey:action label="Anmelden" to="dashboard" trigger="wisch"
  void onSubmit() {}
}
''');
      final warn = WarnLog();
      final errors = <String>[];
      final result = parseComments(file, warn.call, errors);

      expect(errors, isEmpty);
      expect(result.actions.single.trigger, 'tap');
      expect(warn.messages.single, contains('wisch'));
    });

    test('unbekannter @journey-Typ: Warnung, Block ignoriert', () {
      final file = scanSource('''
// @journey:seite id="a" title="A"
class Foo {}
''');
      final warn = WarnLog();
      final errors = <String>[];
      final result = parseComments(file, warn.call, errors);

      expect(errors, isEmpty);
      expect(result.nodes, isEmpty);
      expect(warn.messages.single, contains('seite'));
    });
  });
}
