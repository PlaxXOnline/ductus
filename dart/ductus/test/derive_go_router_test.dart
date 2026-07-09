import 'package:ductus/adapter.dart';
import 'package:test/test.dart';

import 'test_util.dart';

void main() {
  group('slugFromPath', () {
    test('nach DD §G', () {
      expect(slugFromPath('/'), 'root');
      expect(slugFromPath(''), 'root');
      expect(slugFromPath('/login'), 'login');
      expect(slugFromPath('/users/:id/edit'), 'users-edit');
      expect(slugFromPath('settings/:tab'), 'settings');
    });
  });

  group('humanize', () {
    test('erster Buchstabe groß, Bindestriche zu Leerzeichen', () {
      expect(humanize('user-profile'), 'User profile');
      expect(humanize('root'), 'Root');
    });
  });

  group('deriveGoRouter', () {
    test('verschachtelte Routen, name vs. Pfad-Slug', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/login', name: 'login'),
  GoRoute(path: '/users/:id', routes: [
    GoRoute(path: 'edit'),
  ]),
]);
''');
      final result = deriveGoRouter([file], WarnLog().call);

      // Verschachtelte Routen ohne name: erhalten den Slug des Vollpfads.
      expect(result.nodes.map((n) => n.id), ['login', 'users', 'users-edit']);
      final users = result.nodes.firstWhere((n) => n.id == 'users');
      expect(users.title, 'Users');
      expect(users.type, 'screen');
      expect(users.source, 'derived');
      // Verschachtelte Pfade werden absolut aufgelöst.
      expect(result.pathToScreen['/users/:id/edit'], 'users-edit');
    });

    test('gleiche relative Segmente unter verschiedenen Eltern kollabieren '
        'nicht (Regression)', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/user', routes: [
    GoRoute(path: 'detail', builder: (c, s) => UserDetailScreen()),
  ]),
  GoRoute(path: '/admin', routes: [
    GoRoute(path: 'detail', builder: (c, s) => AdminDetailScreen()),
  ]),
]);

class UserDetailScreen {
  void open(dynamic context) {
    context.go('/admin/detail');
  }
}
''');
      final result = deriveGoRouter([file], WarnLog().call);

      expect(result.nodes.map((n) => n.id),
          ['user', 'user-detail', 'admin', 'admin-detail']);
      expect(result.pathToScreen['/user/detail'], 'user-detail');
      expect(result.pathToScreen['/admin/detail'], 'admin-detail');

      // Navigation zwischen den beiden Detail-Screens bleibt unterscheidbar.
      final edge = result.edges.single;
      expect(edge.from, 'user-detail');
      expect(edge.to, 'admin-detail');
    });

    test('ShellRoute wird zum Flow, Kind-Screens erhalten ihn', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  ShellRoute(routes: [
    GoRoute(path: '/home', name: 'home'),
    GoRoute(path: '/profile'),
  ]),
]);
''');
      final result = deriveGoRouter([file], WarnLog().call);

      final flow = result.flows.single;
      expect(flow.id, 'shell-0');
      expect(flow.title, 'Shell 0');
      expect(flow.start, 'home');
      expect(result.nodes.map((n) => n.flow), everyElement('shell-0'));
    });

    test('redirect erzeugt Decision-Node und Kanten', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/login', name: 'login'),
  GoRoute(
    path: '/dashboard',
    redirect: (context, state) => loggedIn ? null : '/login',
  ),
]);
''');
      final result = deriveGoRouter([file], WarnLog().call);

      final decision = result.nodes.firstWhere((n) => n.type == 'decision');
      expect(decision.id, 'dashboard_redirect');
      expect(decision.title, 'Weiterleitung: Dashboard');

      final autoEdge = result.edges.firstWhere(
          (e) => e.to == 'dashboard' && e.from == 'dashboard_redirect');
      expect(autoEdge.trigger, 'auto');
      expect(autoEdge.condition, isNull);

      final redirectEdge = result.edges.firstWhere((e) => e.to == 'login');
      expect(redirectEdge.from, 'dashboard_redirect');
      expect(redirectEdge.condition, 'redirect');
    });

    test('context.go-Kanten über builder-Zuordnung', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/home', name: 'home'),
  GoRoute(path: '/profile', builder: (context, state) => ProfileScreen()),
]);

class ProfileScreen {
  void open(dynamic context) {
    context.go('/home');
  }
}
''');
      final result = deriveGoRouter([file], WarnLog().call);

      expect(result.builderClassToScreen['ProfileScreen'], 'profile');
      final edge = result.edges.single;
      expect(edge.from, 'profile');
      expect(edge.to, 'home');
      expect(edge.trigger, 'tap');
      expect(edge.source, 'derived');
    });

    test('pageBuilder mit child: wird zugeordnet', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(
    path: '/home',
    pageBuilder: (context, state) => MaterialPage(child: HomeScreen()),
  ),
]);
''');
      final result = deriveGoRouter([file], WarnLog().call);

      expect(result.builderClassToScreen['HomeScreen'], 'home');
    });

    test('goNamed nutzt die Namens-Tabelle', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/a', name: 'alpha', builder: (c, s) => AScreen()),
  GoRoute(path: '/b', name: 'beta'),
]);

class AScreen {
  void open(dynamic context) {
    context.goNamed('beta');
  }
}
''');
      final result = deriveGoRouter([file], WarnLog().call);

      final edge = result.edges.single;
      expect(edge.from, 'alpha');
      expect(edge.to, 'beta');
    });

    test('manuell annotierte Klasse liefert das from', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/home', name: 'home'),
]);

class LoginScreen {
  void open(dynamic context) {
    context.push('/home');
  }
}
''');
      final result = deriveGoRouter(
        [file],
        WarnLog().call,
        manualScreenClasses: {'LoginScreen': 'login'},
      );

      final edge = result.edges.single;
      expect(edge.from, 'login');
      expect(edge.to, 'home');
    });

    test('nicht zuordenbare Navigations-Aufrufe werden verworfen', () {
      final file = scanSource('''
final router = GoRouter(routes: [
  GoRoute(path: '/home', name: 'home'),
]);

class UnbekannteKlasse {
  void open(dynamic context) {
    context.go('/home');
    context.go('/nirgendwo');
  }
}
''');
      final warn = WarnLog();
      final result = deriveGoRouter([file], warn.call);

      expect(result.edges, isEmpty);
      expect(warn.messages, hasLength(2));
      expect(warn.messages[0], contains('verworfen'));
      expect(warn.messages[1], contains('/nirgendwo'));
    });
  });

  group('deriveAutoRoute', () {
    test('@RoutePage-Klassen werden zu Screens', () {
      final file = scanSource('''
@RoutePage()
class UserProfileScreen {}

@RoutePage()
class SettingsPage {}
''');
      final result = deriveAutoRoute([file], WarnLog().call);

      expect(result.nodes.map((n) => n.id), ['user-profile', 'settings']);
      final node = result.nodes.first;
      expect(node.title, 'User profile');
      expect(node.source, 'derived');
      expect(node.sourceRef.symbol, 'UserProfileScreen');
      expect(result.classToScreen['UserProfileScreen'], 'user-profile');
    });

    test('AutoRoute-Einträge liefern die Pfad-Zuordnung', () {
      final file = scanSource('''
@RoutePage()
class LoginScreen {}

final routes = [
  AutoRoute(page: LoginRoute.page, path: '/login'),
  AutoRoute(page: UnbekannteRoute.page, path: '/x'),
];
''');
      final result = deriveAutoRoute([file], WarnLog().call);

      expect(result.pathToScreen, {'/login': 'login'});
    });
  });
}
