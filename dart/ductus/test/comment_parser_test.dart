import 'package:ductus/adapter.dart';
import 'package:test/test.dart';

import 'test_util.dart';

void main() {
  group('parseComments', () {
    test('parses a screen block with escapes in the value', () {
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

    test('multi-line blocks: continuation in subsequent comment lines', () {
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

    test('block ends at a non-comment line', () {
      final file = scanSource('''
// @journey:screen id="a" title="A"
var x = 1;
// description="no longer part of the block"
''');
      final errors = <String>[];
      final result = parseComments(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.nodes.single.description, isNull);
    });

    test('block ends at a new @journey: block', () {
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

    test('unknown keys: warning, value is ignored', () {
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

    test('missing required field is an error', () {
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

    test('flow block with all required fields', () {
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

    test('action without from records the enclosing class', () {
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

    test('action without from and without an enclosing class is an error', () {
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

    test('from inference end-to-end via runAdapter building blocks', () {
      // Comment screen above the class + action inside the class:
      // the class is known as a screen, its id becomes the from.
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

    test('unknown trigger: warning and default tap', () {
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

    test('unknown @journey type: warning, block ignored', () {
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
