import 'package:ductus/adapter.dart';
import 'package:test/test.dart';

import 'test_util.dart';

void main() {
  group('extractAnnotations', () {
    test('reads all four annotations', () {
      final file = scanSource('''
@JourneyFlow(id: 'auth', title: 'Anmeldung', start: 'login')
@JourneyScreen(id: 'login', title: 'Anmeldung', flow: 'auth')
class LoginScreen {
  @JourneyAction(label: 'Anmelden', to: 'dashboard')
  void onSubmit() {}
}

@JourneyDecision(id: 'auth_check', title: 'Eingeloggt?', tags: ['auth'])
class AuthCheck {}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.flows, hasLength(1));
      expect(result.nodes, hasLength(2));
      expect(result.actions, hasLength(1));

      final flow = result.flows.single;
      expect(flow.id, 'auth');
      expect(flow.start, 'login');

      final screen = result.nodes.firstWhere((n) => n.type == 'screen');
      expect(screen.id, 'login');
      expect(screen.title, 'Anmeldung');
      expect(screen.flow, 'auth');

      final decision = result.nodes.firstWhere((n) => n.type == 'decision');
      expect(decision.id, 'auth_check');
      expect(decision.tags, ['auth']);
    });

    test('trigger enum is read literally', () {
      final file = scanSource('''
class LoginScreen {
  @JourneyAction(label: 'Senden', to: 'x', trigger: JourneyTrigger.deeplink)
  void go() {}
}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.actions.single.trigger, 'deeplink');
    });

    test('tags list is read literally', () {
      final file = scanSource('''
@JourneyScreen(id: 'a', title: 'A', tags: ['x', 'y'])
class A {}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(result.nodes.single.tags, ['x', 'y']);
    });

    test('from default: enclosing class is recorded', () {
      final file = scanSource('''
@JourneyScreen(id: 'login', title: 'Anmeldung')
class LoginScreen {
  @JourneyAction(label: 'Anmelden', to: 'dashboard')
  void onSubmit() {}
}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      final action = result.actions.single;
      expect(action.from, isNull);
      expect(action.enclosingClassName, 'LoginScreen');
      expect(result.screenClassNames['LoginScreen'], 'login');
    });

    test('explicit from is preserved', () {
      final file = scanSource('''
class Foo {
  @JourneyAction(label: 'Weiter', from: 'a', to: 'b')
  void next() {}
}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.actions.single.from, 'a');
    });

    test('action on a field: sourceRef points to the field', () {
      final file = scanSource('''
class LoginScreen {
  @JourneyAction(label: 'Hilfe', from: 'login', to: 'help')
  final helpButton = null;
}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(errors, isEmpty);
      expect(result.actions.single.sourceRef.symbol, 'helpButton');
    });

    test('non-literal from is an error instead of silent inference '
        '(regression)', () {
      final file = scanSource('''
const kSettings = 'settings';

@JourneyScreen(id: 'dash', title: 'Dashboard')
class DashboardScreen {
  @JourneyAction(label: 'Save', to: 'login', from: kSettings)
  void save() {}
}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      // No action — otherwise the from inference would silently insert
      // 'dash' instead of the intended 'settings'.
      expect(result.actions, isEmpty);
      expect(errors, hasLength(1));
      expect(errors.single, contains('"from"'));
      expect(errors.single, contains('not readable as a literal'));
    });

    test('non-literal optional fields are dropped with a warning '
        '(regression)', () {
      final file = scanSource('''
const kFlow = 'auth';

@JourneyScreen(id: 'login', title: 'Anmeldung', flow: kFlow, tags: ['x', kFlow])
class LoginScreen {
  @JourneyAction(label: 'Weiter', to: 'dash', condition: kFlow)
  void next() {}
}
''');
      final errors = <String>[];
      final warn = WarnLog();
      final result = extractAnnotations(file, warn.call, errors);

      expect(errors, isEmpty);
      final node = result.nodes.single;
      expect(node.flow, isNull);
      expect(node.tags, ['x']);
      expect(result.actions.single.condition, isNull);

      expect(warn.messages, hasLength(3));
      expect(warn.messages[0], contains('"flow"'));
      expect(warn.messages[1], contains('"tags" element'));
      expect(warn.messages[2], contains('"condition"'));
      expect(warn.messages, everyElement(contains('not readable as a literal')));
    });

    test('non-literal required fields produce a specific error',
        () {
      final file = scanSource('''
const kId = 'login';

@JourneyScreen(id: kId, title: 'Anmeldung')
class LoginScreen {}
''');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      expect(result.nodes, isEmpty);
      expect(errors, hasLength(1));
      expect(errors.single, contains('"id"'));
      expect(errors.single, contains('not readable as a literal'));
    });

    test('action without from on a top-level function is an error', () {
      final file = scanSource('''
@JourneyAction(label: 'Weiter', to: 'b')
void next() {}
''');
      final errors = <String>[];
      extractAnnotations(file, WarnLog().call, errors);

      expect(errors, hasLength(1));
      expect(errors.single, contains('from'));
    });

    test('sourceRef contains file, line, and symbol', () {
      final file = scanSource('''
class Platzhalter {}

@JourneyScreen(id: 'login', title: 'Anmeldung')
class LoginScreen {}
''', path: 'lib/screens/login.dart');
      final errors = <String>[];
      final result = extractAnnotations(file, WarnLog().call, errors);

      final ref = result.nodes.single.sourceRef;
      expect(ref.file, 'lib/screens/login.dart');
      expect(ref.line, 3);
      expect(ref.symbol, 'LoginScreen');
    });
  });
}
